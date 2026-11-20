"""NBA three-pointers made: a projection and a full range of outcomes for every rotation player in upcoming games.

Built the same way as the NHL shots projections (nhlprops.py), from ESPN box scores kept in data/sports/lab/nba_{year}.json:
  expected 3PM = expected minutes x his three-point attempts per minute x how many threes the opponent allows x his make rate
  - minutes: recent minutes (half-life 6 games), then scaled so the players expected to play add up to 240 team minutes
    (in the backtest the players who actually dressed; live, the recent rotation minus anyone ruled out)
  - attempts per minute: his own rate, decayed (half-life 30 games) and pulled toward the league rate with 150 pseudo-minutes
  - opponent: threes attempted against them per game vs the league (half-life 15 games, 10 pseudo-games of average)
  - make rate: decayed (half-life 300 attempts), pulled toward the league rate with 250 pseudo-attempts
The chance of each count (0 to 10+) comes from how players with similar projections actually finished in earlier seasons
(projection bands), not from a formula. Held-out seasons are scored against a Poisson count around the same projection.

Writes props/nba.json and track/_props_nba.json (pre-game projections graded from box scores; nothing back-filled).
"""
import collections
import math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np

from .common import now_iso, read, write

K = 10
QS = [.1, .2, .3, .4, .5, .6, .7, .8, .88, .94, .97, .99]
HL_MIN, HL_RATE, HL_PCT, HL_OPP = 6, 30, 300, 15
KM, KP, K_OPP = 150.0, 250.0, 10.0
OUT_STATUS = {"Out", "Doubtful", "Suspension"}
ET = ZoneInfo("America/New_York")


def load_games(years):
    """[(utc date16, season, gid, home id, away id, {team id: [(pid, name, min, 3pa, 3pm, starter)]})] in time order."""
    out = []
    for y in years:
        store = read(f"lab/nba_{y}.json") or {}
        for gid, g in (store.get("g") or {}).items():
            pl = g.get("pl") or {}
            if not g.get("d") or len(pl) != 2:
                continue
            sides = {}
            ok = True
            for tid, rows in pl.items():
                rs = []
                for r in rows:
                    if len(r) < 19:
                        ok = False
                        break
                    if (r[2] or 0) > 0:
                        rs.append((str(r[0]), r[1], float(r[2]), float(r[18] or 0), float(r[17] or 0), int(r[5] or 0)))
                sides[str(tid)] = rs
            if ok:
                out.append((g["d"], y, gid, str(g.get("h")), str(g.get("a")), sides))
    out.sort()
    return out


class State:
    def __init__(self):
        self.P = collections.defaultdict(lambda: {"m": 0.0, "mw": 0.0, "A": 0.0, "M": 0.0, "pm": 0.0, "pa": 0.0, "name": None, "team": None, "gp": 0})
        self.opp = collections.defaultdict(lambda: [0.0, 0.0])       # decayed (3PA allowed, games)
        self.lg = [0.0, 0.0, 0.0, 0.0]                                 # decayed league (3PA, minutes, 3PM, 3PA-for-pct)
        self.recent = collections.defaultdict(lambda: collections.deque(maxlen=3))

    def lg_rate(self):
        return self.lg[0] / self.lg[1] if self.lg[1] else 0.08

    def lg_pct(self):
        return self.lg[2] / self.lg[3] if self.lg[3] else 0.36

    def lg_opp(self):
        v = [a / g for a, g in self.opp.values() if g > 0]
        return float(np.mean(v)) if v else 35.0

    def min_raw(self, pid):
        p = self.P[pid]
        return p["m"] / p["mw"] if p["mw"] else 0.0

    def mu(self, pid, opp, minutes):
        p = self.P[pid]
        rate = (p["A"] + KM * self.lg_rate()) / (p["M"] + KM)
        pct = (p["pm"] + KP * self.lg_pct()) / (p["pa"] + KP)
        a, g = self.opp[opp]
        lo = self.lg_opp()
        of = ((a + K_OPP * lo) / (g + K_OPP)) / lo if lo else 1.0
        self.parts = (rate, pct, of)
        return minutes * rate * of * pct, minutes * rate * of

    def update(self, sides, home, away):
        dm, dr, dp, do = 0.5 ** (1 / HL_MIN), 0.5 ** (1 / HL_RATE), None, 0.5 ** (1 / HL_OPP)
        for tid, rows in sides.items():
            opp = away if tid == home else home
            att = sum(r[3] for r in rows)
            o = self.opp[opp]
            o[0] = o[0] * do + att; o[1] = o[1] * do + 1
            self.recent[tid].append({r[0] for r in rows})
            for pid, name, mn, a3, m3, st in rows:
                p = self.P[pid]
                p["m"] = p["m"] * dm + mn; p["mw"] = p["mw"] * dm + 1
                p["A"] = p["A"] * dr + a3; p["M"] = p["M"] * dr + mn
                f = 0.5 ** (a3 / HL_PCT) if a3 else 1.0
                p["pm"] = p["pm"] * f + m3; p["pa"] = p["pa"] * f + a3
                p["name"], p["team"] = name, tid
                p["gp"] += 1
                self.lg[0] = self.lg[0] * 0.9995 + a3; self.lg[1] = self.lg[1] * 0.9995 + mn
                self.lg[2] = self.lg[2] * 0.9995 + m3; self.lg[3] = self.lg[3] * 0.9995 + a3


def _minutes(S, pids, total=240.0):
    raw = {p: max(S.min_raw(p), 1.0) for p in pids}
    s = sum(raw.values())
    return {p: v * total / s for p, v in raw.items()} if s else raw


def _tables(rows, years):
    mus = np.array([r[1] for r in rows if r[0] in years])
    edges = np.quantile(mus, QS) if len(mus) else np.array([])
    pm = np.full((len(QS) + 1, K + 1), 0.05)
    for r in rows:
        if r[0] in years:
            pm[int(np.searchsorted(edges, r[1], side="right")), min(int(r[2]), K)] += 1
    return edges, pm / pm.sum(axis=1, keepdims=True)


def _rps(p, a):
    return float(np.sum((np.cumsum(p) - (np.arange(K + 1) >= min(a, K))) ** 2))


def _poisson(mu):
    k = np.arange(K + 1)
    p = np.exp(k * np.log(max(mu, 1e-6)) - mu - np.array([math.lgamma(i + 1) for i in k]))
    p[K] += max(0.0, 1 - p.sum())
    return p


def _score(items):
    if not items:
        return None
    lad = []
    for k in (1, 2, 3, 4, 5):
        pr = [float(p[k:].sum()) for p, a in items]
        lad.append({"k": k, "pred": round(float(np.mean(pr)), 3), "act": round(float(np.mean([a >= k for p, a in items])), 3)})
    return {"n": len(items), "rps": round(float(np.mean([_rps(p, a) for p, a in items])), 4), "ladder": lad}


def _calib(items, k):
    """Bucketed calibration of P(3PM >= k)."""
    pr = np.array([float(p[k:].sum()) for p, a in items]); y = np.array([a >= k for p, a in items], float)
    out = []
    for lo, hi in ((0, .1), (.1, .2), (.2, .3), (.3, .4), (.4, .5), (.5, .6), (.6, .7), (.7, 1.01)):
        m = (pr >= lo) & (pr < hi)
        if m.sum() >= 30:
            out.append({"lo": lo, "hi": min(hi, 1.0), "n": int(m.sum()), "exp": round(float(pr[m].mean()), 3), "act": round(float(y[m].mean()), 3)})
    return out


def _et_day(d16):
    return datetime.fromisoformat(d16).replace(tzinfo=timezone.utc).astimezone(ET).date().isoformat()


def job_props():
    cur = (read("model/nba.json") or {}).get("season")
    if not cur:
        return {"skipped": "no NBA season"}
    cur = int(cur)
    years = [y for y in range(cur - 5, cur + 1)]
    games = load_games(years)
    if len(games) < 2000:
        return {"skipped": f"only {len(games)} NBA games with three-point columns yet"}
    S = State()
    rows = []          # (season, projected 3PM, actual 3PM, projected 3PA, actual 3PA, minutes projected, minutes)
    for d16, y, gid, h, a, sides in games:
        for tid, rs in sides.items():
            opp = a if tid == h else h
            mins = _minutes(S, [r[0] for r in rs])
            for pid, name, mn, a3, m3, st in rs:
                if S.P[pid]["gp"] < 5:
                    continue
                mu, mu_a = S.mu(pid, opp, mins[pid])
                rows.append((y, mu, int(m3), mu_a, a3, mins[pid], mn))
        S.update(sides, h, a)
    done_years = sorted({r[0] for r in rows if r[0] < cur})
    back = {}
    for ty in done_years[-2:]:
        prior = {y for y in done_years if y < ty}
        if not prior:
            continue
        e2, p2 = _tables(rows, prior)
        te = [r for r in rows if r[0] == ty]
        items = [(p2[int(np.searchsorted(e2, r[1], side="right"))], r[2]) for r in te]
        s = _score(items)
        s["poissonRps"] = round(float(np.mean([_rps(_poisson(r[1]), r[2]) for r in te])), 4)
        lgp = np.bincount([min(r[2], K) for r in rows if r[0] in prior], minlength=K + 1) + 0.05; lgp = lgp / lgp.sum()
        s["baselineRps"] = round(float(np.mean([_rps(lgp, r[2]) for r in te])), 4)
        s["calib"] = {str(k): _calib(items, k) for k in (1, 2, 3)}
        s["mae"] = round(float(np.mean([abs(r[2] - r[1]) for r in te])), 3)
        s["bias"] = round(float(np.mean([r[2] - r[1] for r in te])), 3)
        s["maeA"] = round(float(np.mean([abs(r[4] - r[3]) for r in te])), 3)
        s["maeMin"] = round(float(np.mean([abs(r[6] - r[5]) for r in te])), 2)
        back[str(ty)] = s
    edges, pmf = _tables(rows, set(done_years))
    band = lambda m: int(np.searchsorted(edges, m, side="right"))
    # upcoming games (next 40 hours)
    ev = (read("model/_games_nba.json") or {}).get("events", {})
    teams = {t["id"]: t["abbr"] for t in ((read("teams.json") or {}).get("leagues") or {}).get("nba", [])}
    inj = (read("injuries/nba.json") or {}).get("teams", {})
    norm = lambda s: "".join(c for c in (s or "").lower() if c.isalpha())
    out_by_team = {str(t): {norm(r["name"]) for r in rs if r.get("status") in OUT_STATUS} for t, rs in inj.items()}
    q_by_team = {str(t): {norm(r["name"]): r.get("status") for r in rs if r.get("status") not in OUT_STATUS} for t, rs in inj.items()}
    now16 = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")
    horizon = (datetime.now(timezone.utc) + timedelta(hours=40)).strftime("%Y-%m-%dT%H:%M")
    props = []
    for eid, e in sorted(ev.items(), key=lambda kv: kv[1]["d"]):
        if e.get("done") or not (now16 <= e["d"] <= horizon):
            continue
        for tid, opp in ((str(e["h"]), str(e["a"])), (str(e["a"]), str(e["h"]))):
            pool = set().union(*S.recent[tid]) if S.recent[tid] else set()
            pool = [p for p in pool if S.P[p]["team"] == tid and S.P[p]["gp"] >= 5 and norm(S.P[p]["name"]) not in out_by_team.get(tid, set())]
            if not pool:
                continue
            mins = _minutes(S, pool)
            for pid in pool:
                if mins[pid] < 10:
                    continue
                mu, mu_a = S.mu(pid, opp, mins[pid])
                st = q_by_team.get(tid, {}).get(norm(S.P[pid]["name"]))
                props.append({"pid": pid, "player": S.P[pid]["name"], "team": teams.get(tid, tid), "opp": teams.get(opp, opp), "home": tid == str(e["h"]),
                              "espn": eid, "start": e["d"], "min": round(mins[pid], 1), "a3": round(mu_a, 2), "mean": round(mu, 2), "band": band(mu),
                              "pct": round(S.parts[1], 3), "of": round(S.parts[2], 3), **({"status": st} if st else {})})
    # publish projections only once the held-out test beats the league-wide baseline; until then the record still builds
    lb = back[max(back)] if back else None
    held = not lb or lb["rps"] >= lb["baselineRps"]
    if held:
        props = []
    live = _log_and_grade(cur, props, games, pmf)
    write("props/nba.json", {"season": cur, "updated": now_iso(), "kmax": K, "edges": [round(float(x), 3) for x in edges],
                             "pmf": [[round(float(x), 4) for x in row] for row in pmf], "props": props, "held": held, "backtest": back, "liveLog": live,
                             "source": "ESPN box scores; house model"})
    return {"props": len(props), "rows": len(rows), "backtest": {k: (v["rps"], v["poissonRps"]) for k, v in back.items()}}


def _log_and_grade(cur, props, games, pmf):
    store = read("track/_props_nba.json") or {"season": cur, "log": {}}
    if store.get("season") != cur:
        store = {"season": cur, "log": {}}
    log = store["log"]
    now16 = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")
    for r in props:
        if r["start"] > now16:
            log[f"{r['espn']}|{r['pid']}"] = {"d": _et_day(r["start"]), "e": r["espn"], "t": r["team"], "o": r["opp"], "b": r["band"], "m": r["mean"], "pid": r["pid"], "n": r["player"]}
    made = {}
    for d16, y, gid, h, a, sides in games:
        if y == cur:
            for tid, rs in sides.items():
                for r in rs:
                    made[(gid, r[0])] = int(r[4])
    today = datetime.now(ET).date()
    for k, e in list(log.items()):
        if "act" not in e and (e["e"], e["pid"]) in made:
            e["act"] = made[(e["e"], e["pid"])]
        elif "act" not in e and (today - datetime.fromisoformat(e["d"]).date()).days > 3:
            del log[k]          # did not play (or no box score): excluded, as a player who sits has no result to grade
    write("track/_props_nba.json", store)
    graded = [e for e in log.values() if e.get("act") is not None]
    s = _score([(np.array(pmf[e["b"]]), e["act"]) for e in graded])
    if s:
        s["pending"] = sum(1 for e in log.values() if "act" not in e)
        s["calib"] = {str(k): _calib([(np.array(pmf[e["b"]]), e["act"]) for e in graded], k) for k in (1, 2, 3)}
    return s or {"n": 0, "pending": len(log)}
