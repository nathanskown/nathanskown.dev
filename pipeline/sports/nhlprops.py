"""NHL player shots on goal (the "board"), from the NHL's own free box scores. Walk-forward like the NFL board: every
game is projected only from games before it.

  shots = (player's shots per minute, recency weighted, pulled toward his position's league rate)
        x (expected ice time, recency weighted, pulled toward the position's average)
        x (opponent's shots allowed relative to the league, shrunk) x a small home/away factor

The chance of each shot count is not a formula: it is how often players with projections of that size actually
finished with 0, 1, 2 ... shots in the previous three seasons (twelve projection bands). On held-out seasons that
beat a plain Poisson and negative binomial, and the "1+ ... 5+" chances matched results within a point.

  data/sports/props/nhl.json   (history/nhl_skaters_{year}.json holds the box scores)"""
import collections
import time
from datetime import datetime, timedelta, timezone

import numpy as np

from .common import get, now_iso, read, write

HL_R, HL_T = 30.0, 8.0          # half-lives in games: shot rate, ice time
KM, KT, K_OPP = 300.0, 4.0, 8.0
K = 10                          # shot counts above this are pooled ("10+")
QS = [.08, .16, .25, .33, .42, .5, .58, .67, .75, .83, .9, .94, .97, .985, .995]   # band edges as quantiles of projected shots; finer at the top, where the stars are
NBANDS = len(QS) + 1
ESPN2NHL = {"TB": "TBL", "NJ": "NJD", "SJ": "SJS", "LA": "LAK", "UTAH": "UTA"}
OUT_STATUS = {"Out", "Injured Reserve", "Doubtful", "Suspension"}


def _toi(s):
    p = str(s or "0:00").split(":")
    return int(p[0]) * 60 + int(p[1]) if len(p) == 2 and p[0].isdigit() else 0


def collect_current(cur, budget=240):
    """Add any newly finished games of the current season to history/nhl_skaters_{cur}.json (a handful per day)."""
    name = f"history/nhl_skaters_{cur}.json"
    store = read(name) or {"year": cur, "g": {}}
    t0, added, idle = time.time(), 0, 0
    n = max([int(g[-4:]) for g in store["g"]] + [0]) + 1
    while time.time() - t0 < budget and idle < 12 and n < 1500:
        gid = f"{cur - 1}02{n:04d}"
        n += 1
        if gid in store["g"]:
            continue
        try:
            b = get(f"https://api-web.nhle.com/v1/gamecenter/{gid}/boxscore", timeout=30)
        except Exception:
            idle += 1
            continue
        if b.get("gameState") not in ("OFF", "FINAL"):
            idle += 1
            continue
        idle = 0
        pg = b.get("playerByGameStats") or {}

        def sk(side):
            return [[x.get("playerId"), (x.get("name") or {}).get("default"), x.get("position"), _toi(x.get("toi")), x.get("sog") or 0,
                     x.get("goals") or 0, x.get("assists") or 0] for grp in ("forwards", "defense") for x in ((pg.get(side) or {}).get(grp) or [])]
        store["g"][gid] = [b.get("gameDate"), (b.get("homeTeam") or {}).get("abbrev"), (b.get("awayTeam") or {}).get("abbrev"), sk("homeTeam"), sk("awayTeam")]
        added += 1
    if added:
        write(name, store)
    return added


class State:
    def __init__(self):
        self.P = collections.defaultdict(lambda: {"sog": 0.0, "min": 0.0, "toi": 0.0, "n": 0.0, "gp": 0, "team": None, "name": None, "pos": "F"})
        self.TA = collections.defaultdict(lambda: [0.0, 0.0])
        self.lgp = {"F": [0.0, 0.0], "D": [0.0, 0.0]}
        self.lgt = {"F": [0.0, 0.0], "D": [0.0, 0.0]}
        self.tl = [0.0, 0.0]
        self.recent = collections.defaultdict(lambda: collections.deque(maxlen=3))   # team -> last 3 games' player sets
        self.fR, self.fT = 0.5 ** (1 / HL_R), 0.5 ** (1 / HL_T)

    def mu(self, pid, p, opp, home):
        st = self.P[pid]
        tav = (self.tl[0] / self.tl[1]) if self.tl[1] > 0 else 30.0
        ta = self.TA[opp]
        of = ((ta[0] + K_OPP * tav) / (ta[1] + K_OPP)) / tav
        r0 = self.lgp[p][0] / self.lgp[p][1] if self.lgp[p][1] > 0 else (0.07 if p == "D" else 0.11)
        t0 = self.lgt[p][0] / self.lgt[p][1] if self.lgt[p][1] > 0 else (21.0 if p == "D" else 15.0)
        rate = (st["sog"] + KM * r0) / (st["min"] + KM)
        toi = (st["toi"] + KT * t0) / (st["n"] + KT)
        return rate * toi * of * (1.03 if home else 0.97), toi

    def update(self, h, a, hs, as_):
        for sk, team, opp in ((hs, h, a), (as_, a, h)):
            ts = sum(x[4] for x in sk)
            seen = set()
            for pid, name, pos, sec, sog, g_, a_ in sk:
                if sec <= 0:
                    continue
                p = "D" if pos == "D" else "F"
                st = self.P[pid]
                st["sog"] = st["sog"] * self.fR + sog
                st["min"] = st["min"] * self.fR + sec / 60.0
                st["toi"] = st["toi"] * self.fT + sec / 60.0
                st["n"] = st["n"] * self.fT + 1.0
                st["gp"] += 1; st["team"] = team; st["name"] = name; st["pos"] = p
                self.lgp[p][0] += sog; self.lgp[p][1] += sec / 60.0
                self.lgt[p][0] += sec / 60.0; self.lgt[p][1] += 1
                seen.add(pid)
            self.recent[team].append(seen)
            ta = self.TA[opp]
            ta[0] = ta[0] * self.fR + ts; ta[1] = ta[1] * self.fR + 1
            self.tl[0] += ts; self.tl[1] += 1


def _tables(rows, years):
    mu = np.array([r[1] for r in rows if r[0] in years]); a = np.minimum(np.array([r[2] for r in rows if r[0] in years]), K).astype(int)
    edges = np.quantile(mu, QS)
    pmf = []
    for b in range(NBANDS):
        lo = -np.inf if b == 0 else edges[b - 1]; hi = np.inf if b == NBANDS - 1 else edges[b]
        k = (mu >= lo) & (mu < hi)
        c = np.bincount(a[k], minlength=K + 1) + 0.5
        pmf.append(c / c.sum())
    return edges, pmf


def _rps(p, a):
    c = np.cumsum(p)
    return float(np.sum((c - (np.arange(K + 1) >= min(a, K))) ** 2))


def _score(items, pos_toi=None):
    """items = [(pmf, actual)] -> ranked probability score (like CRPS for counts) and how the 1+..5+ chances compare with results."""
    if not items:
        return None
    r = sum(_rps(p, a) for p, a in items) / len(items)
    lad = []
    for k in range(1, 6):
        pr = np.mean([np.cumsum(p[::-1])[::-1][k] for p, a in items]); ac = np.mean([a >= k for p, a in items])
        lad.append({"k": k, "pred": round(float(pr), 3), "act": round(float(ac), 3)})
    return {"n": len(items), "rps": round(r, 4), "ladder": lad}


def _et_day(start_utc):
    """The NHL files games under the local (Eastern) date; ESPN's start time is UTC."""
    from zoneinfo import ZoneInfo
    return datetime.fromisoformat(start_utc).replace(tzinfo=timezone.utc).astimezone(ZoneInfo("America/New_York")).date().isoformat()


def _log_and_grade(cur, props, games, pmf):
    """Keep each pre-game projection (the last made before the game starts wins) and grade it from the box score once the
    game is final. This is the real, un-back-filled record: data/sports/track/_props_nhl.json."""
    store = read("track/_props_nhl.json") or {}
    if store.get("season") != cur:
        store = {"season": cur, "log": {}}
    log = store["log"]
    for r in props:
        if r.get("locked"):
            continue
        k = f"{r['espn']}|{r['pid']}"
        if "act" not in log.get(k, {}):
            log[k] = {"d": _et_day(r["start"]), "t": r["team"], "o": r["opp"], "b": r["band"], "m": r["mean"], "pid": r["pid"]}
    byday = collections.defaultdict(list)
    for dt, y, gid, h, a, hs, as_ in games:
        if y == cur:
            byday[dt].append((h, a, hs, as_))
    shots = {}
    for dt, items in byday.items():
        for h, a, hs, as_ in items:
            for sk, team in ((hs, h), (as_, a)):
                for x in sk:
                    shots[(dt, ESPN2NHL.get(team, team), x[0])] = x[4]
    for k, e in log.items():
        if "act" in e:
            continue
        v = shots.get((e["d"], ESPN2NHL.get(e["t"], e["t"]), e["pid"]))
        if v is not None:
            e["act"] = v
    write("track/_props_nhl.json", store)
    g = [(pmf[e["b"]], e["act"]) for e in log.values() if e.get("act") is not None]
    out = _score(g)
    if out:
        out["pending"] = sum(1 for e in log.values() if "act" not in e)
    return out


def job_props():
    cur = (read("model/nhl.json") or {}).get("season")
    if not cur:
        raise RuntimeError("no NHL season in model/nhl.json")
    added = collect_current(cur)
    games = []
    for y in range(cur - 3, cur + 1):
        d = (read(f"history/nhl_skaters_{y}.json") or {}).get("g") or {}
        games += [(v[0], y, gid, v[1], v[2], v[3], v[4]) for gid, v in d.items()]
    games.sort()
    S = State()
    rows = []
    for dt, y, gid, h, a, hs, as_ in games:
        for sk, opp, home in ((hs, a, 1), (as_, h, 0)):
            for pid, name, pos, sec, sog, g_, a_ in sk:
                if sec <= 0:
                    continue
                st = S.P[pid]
                if st["gp"] < 5:
                    continue
                mu, toi = S.mu(pid, "D" if pos == "D" else "F", opp, home)
                rows.append((y, mu, sog, "D" if pos == "D" else "F", toi))
        S.update(h, a, hs, as_)
    years = {y for y in range(cur - 3, cur)}
    edges, pmf = _tables(rows, years | {cur})
    band = lambda m: int(np.searchsorted(edges, m, side="right"))
    # held-out check: each of the last two completed seasons scored with tables from the seasons before it
    back = {}
    for ty in (cur - 2, cur - 1):
        e2, p2 = _tables(rows, {y for y in range(cur - 3, cur + 1) if y < ty} or {ty})
        te = [(p2[int(np.searchsorted(e2, r[1], side="right"))], r[2]) for r in rows if r[0] == ty]
        # baseline: position and ice-time band only
        tr = [r for r in rows if r[0] < ty]
        base = collections.defaultdict(lambda: np.full(K + 1, 0.5))
        for r in tr:
            base[(r[3], int(r[4] // 3))][min(r[2], K)] += 1
        bs = [_rps(base[(r[3], int(r[4] // 3))] / base[(r[3], int(r[4] // 3))].sum(), r[2]) for r in rows if r[0] == ty and (r[3], int(r[4] // 3)) in base]
        s = _score(te)
        if s:
            s["baselineRps"] = round(float(np.mean(bs)), 4) if bs else None
            back[str(ty)] = s
    # this season so far, scored with the tables above (which already include it, so this is the in-sample view; the backtest is the fair test)
    live = _score([(pmf[band(r[1])], r[2]) for r in rows if r[0] == cur])
    # upcoming games
    ev = (read("model/_games_nhl.json") or {}).get("events", {})
    teams = {t["id"]: t["abbr"] for t in ((read("teams.json") or {}).get("leagues") or {}).get("nhl", [])}
    inj = (read("injuries/nhl.json") or {}).get("teams", {})
    norm = lambda s: "".join(c for c in (s or "").lower() if c.isalpha())
    key = lambda full: (norm(full.split()[-1]), norm(full.split()[0])[:1]) if full else None
    now16 = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")
    horizon = (datetime.now(timezone.utc) + timedelta(hours=40)).strftime("%Y-%m-%dT%H:%M")
    out_by_team = {teams.get(t, t): {key(r["name"]) for r in rs if r.get("status") in OUT_STATUS and r.get("pos") != "G"} for t, rs in inj.items()}
    props = []
    for eid, e in sorted(ev.items(), key=lambda kv: kv[1]["d"]):
        if e.get("done") or not (now16 <= e["d"] <= horizon):
            continue
        ha, aa = teams.get(e["h"]), teams.get(e["a"])
        if not ha or not aa:
            continue
        for team_e, opp_e, home in ((ha, aa, 1), (aa, ha, 0)):
            team, opp = ESPN2NHL.get(team_e, team_e), ESPN2NHL.get(opp_e, opp_e)
            pool = set().union(*S.recent[team]) if S.recent[team] else set()
            for pid in pool:
                st = S.P[pid]
                if st["team"] != team or st["gp"] < 5:
                    continue
                nm = st["name"] or ""
                parts = nm.replace(".", ". ").split()
                if parts and (norm(parts[-1]), norm(parts[0])[:1]) in out_by_team.get(team_e, set()):
                    continue
                mu, toi = S.mu(pid, st["pos"], opp, home)
                if toi < 8.0:
                    continue
                props.append({"pid": pid, "player": nm, "pos": st["pos"], "team": team_e, "opp": opp_e, "home": bool(home), "espn": eid, "mean": round(float(mu), 2),
                              "band": band(mu), "toi": round(float(toi), 1), "start": e["d"]})
    livelog = _log_and_grade(cur, props, games, pmf)
    # keep numbers of games that have started for four days so their pages still show them
    prev = read("props/nhl.json") or {}
    since = (datetime.now(timezone.utc) - timedelta(days=4)).strftime("%Y-%m-%dT%H:%M")
    fresh = {r["espn"] for r in props}
    props += [dict(r, locked=True) for r in prev.get("props") or [] if r["espn"] not in fresh and since <= (ev.get(r["espn"]) or {}).get("d", "") <= now16]
    props.sort(key=lambda r: (r["espn"], -r["mean"]))
    write("props/nhl.json", {"season": cur, "updated": now_iso(), "props": props, "pmf": [[round(float(x), 4) for x in p] for p in pmf], "kmax": K,
                             "live": live, "liveLog": livelog, "backtest": back, "source": "NHL box scores (api-web.nhle.com)"})
    return {"added": added, "rows": len(rows), "props": len(props), "back": back, "live": live}
