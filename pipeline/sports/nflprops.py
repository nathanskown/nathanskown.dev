"""NFL player props and game totals (the "board"), from free nflverse data. Everything is walk-forward: each week is
projected only from earlier games, and the ranges come from how projections of the same size turned out in past seasons.

Player props (volume x efficiency):
  receiving : targets = target share x team pass attempts;  yards = targets x yards per target;  catches = targets x catch rate
  rushing   : carries = carry share x team rush attempts;    yards = carries x yards per carry
  passing   : yards = QB's share of team pass attempts x team pass attempts x yards per attempt
Shares and rates are weighted toward recent games (half-life HL games), shrunk toward position averages, and carried
into the next season at half weight. Each projection is adjusted for the opponent's yards allowed per target, carry
or attempt, shrunk toward league average. The median and middle 50% are the projection times the quantiles of
actual / projected from earlier seasons, by projection size, so they say how often players with that kind of
projection really cleared a number. Tested 2019-25 (each season from earlier data only).

Game totals: offense and defense point ratings for every team (ridge, recency weighted, carried over between seasons)
plus a wind adjustment for outdoor games. Tested 2019-25 against closing totals.

  data/sports/props/nfl.json"""
import collections
import csv
import io
import math
from datetime import datetime, timedelta, timezone

import numpy as np

from .common import SESSION, UA, now_iso, read, write

NV = "https://github.com/nflverse/nflverse-data/releases/download/"
GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
HL, TEAM_HL, SEASON_CARRY = 8.0, 12.0, 0.5
K_SHARE, K_YPT, K_YPC, K_YPA, K_OPP = 1.0, 30.0, 60.0, 150.0, 150.0
REDIST_T, REDIST_C, REDIST_Q = 1.0, 0.5, 1.0     # share of a missing regular's targets / carries passed to the teammates who play (fitted below)
MARKETS = {"rec_yds": ("tg", 3.5, "yd"), "receptions": ("tg", 3.5, "rec"), "rush_yds": ("car", 8.0, "ryd"), "pass_yds": ("pa", 24.0, "pyd")}
LABEL = {"rec_yds": "Receiving yards", "receptions": "Receptions", "rush_yds": "Rushing yards", "pass_yds": "Passing yards"}
OUT_STATUS = {"Out", "Injured Reserve", "Doubtful", "Suspension", "Physically Unable to Perform"}
T_K, T_HL, T_CARRY, T_HOME, T_WIND = 12.0, 8.0, 0.6, 1.5, 0.3
ALIAS = {"OAK": "LV", "SD": "LAC", "STL": "LA"}


def _csv(url):
    r = SESSION.get(url, headers={"User-Agent": UA}, timeout=180)
    if r.status_code != 200:
        raise RuntimeError(f"{url.rsplit('/', 1)[-1]}: HTTP {r.status_code}")
    return list(csv.DictReader(io.StringIO(r.text)))


def _season_rows(y):
    name = f"stats_player/stats_player_week_{y}" if y >= 2025 else f"player_stats/player_stats_{y}"
    out = []
    for r in _csv(NV + name + ".csv"):
        if r.get("season_type") != "REG":
            continue
        g = lambda k: float(r.get(k) or 0)
        out.append(dict(pid=r["player_id"], name=r.get("player_display_name") or r.get("player_name"), pos=r.get("position"),
                        team=ALIAS.get(r.get("recent_team") or r.get("team"), r.get("recent_team") or r.get("team")),
                        opp=ALIAS.get(r["opponent_team"], r["opponent_team"]), wk=int(r["week"]),
                        att=g("attempts"), pyd=g("passing_yards"), car=g("carries"), ryd=g("rushing_yards"),
                        tgt=g("targets"), rec=g("receptions"), yd=g("receiving_yards")))
    return out


class EW:
    __slots__ = ("s", "w")

    def __init__(self):
        self.s = 0.0; self.w = 0.0

    def add(self, x, f):
        self.s = self.s * f + x; self.w = self.w * f + 1.0

    def decay(self, f):
        self.s *= f; self.w *= f

    def mean(self, prior, k):
        return (self.s + prior * k) / (self.w + k)


class Walker:
    """Player, team and defense state, advanced one week at a time."""

    def __init__(self):
        self.f, self.ft = 0.5 ** (1 / HL), 0.5 ** (1 / TEAM_HL)
        self.P = collections.defaultdict(lambda: {k: EW() for k in ("tsh", "csh", "qsh", "tg", "ty", "tr", "cr", "cy", "pa", "py", "gp")})
        self.TEAM = collections.defaultdict(lambda: {"pa": EW(), "ra": EW()})
        self.DEF = collections.defaultdict(lambda: {k: EW() for k in ("tg", "ty", "cr", "cy", "pa", "py")})
        self.LG = {"ypt": 7.6, "ypc": 4.3, "ypa": 6.7, "cr": 0.65, "pa": 34.0, "ra": 26.0}
        self.meta = {}
        self.lgacc = collections.defaultdict(float)
        self.recent = collections.defaultdict(list)      # team -> list of (season, week, set of pids)

    def new_season(self):
        for st in self.P.values():
            for e in st.values():
                e.decay(SEASON_CARRY)
        for st in self.TEAM.values():
            for e in st.values():
                e.decay(SEASON_CARRY)
        for st in self.DEF.values():
            for e in st.values():
                e.decay(SEASON_CARRY * 0.5)
        self.lgacc = collections.defaultdict(float)

    def missing(self, season, team, active):
        """(target share, carry share) of this season's regulars on `team` (seen in its last 3 games) not in `active`,
        and the same totals for those who are."""
        recent = [x for x in self.recent[team] if x[0] == season][-3:]
        pids = set().union(*[x[2] for x in recent]) if recent else set()
        mt = mc = at = ac = mq = aq = 0.0
        for q in pids:
            if self.meta.get(q, (None, None, None))[2] != team:
                continue
            t, c, qs = self.P[q]["tsh"].mean(0.0, K_SHARE), self.P[q]["csh"].mean(0.0, K_SHARE), self.P[q]["qsh"].mean(0.0, 0.5)
            if q in active:
                at += t; ac += c; aq += qs
            else:
                mt += t if t >= 0.05 else 0.0; mc += c if c >= 0.05 else 0.0; mq += qs if qs >= 0.3 else 0.0
        return mt, mc, at, ac, mq, aq

    def project(self, pid, pos, team, opp, boost=(1.0, 1.0, 1.0)):
        st, tm, df, LG = self.P[pid], self.TEAM[team], self.DEF[opp], self.LG
        pa, ra = tm["pa"].mean(LG["pa"], 2.0), tm["ra"].mean(LG["ra"], 2.0)
        adj_t = (df["ty"].s + LG["ypt"] * K_OPP) / (df["tg"].s + K_OPP) / LG["ypt"]
        adj_c = (df["cy"].s + LG["ypc"] * K_OPP) / (df["cr"].s + K_OPP) / LG["ypc"]
        adj_p = (df["py"].s + LG["ypa"] * K_OPP * 2) / (df["pa"].s + K_OPP * 2) / LG["ypa"]
        tsh = st["tsh"].mean({"WR": 0.14, "TE": 0.10, "RB": 0.07}.get(pos, 0.03), K_SHARE) * boost[0]
        csh = st["csh"].mean({"RB": 0.35, "QB": 0.08}.get(pos, 0.01), K_SHARE) * boost[1]
        qsh = min(1.0, st["qsh"].mean(0.0, 0.5) * boost[2])
        ypt = (st["ty"].s + LG["ypt"] * K_YPT) / (st["tg"].s + K_YPT)
        crt = (st["tr"].s + LG["cr"] * K_YPT) / (st["tg"].s + K_YPT)
        ypc = (st["cy"].s + LG["ypc"] * K_YPC) / (st["cr"].s + K_YPC)
        ypa = (st["py"].s + LG["ypa"] * K_YPA) / (st["pa"].s + K_YPA)
        return dict(tg=tsh * pa, yd=tsh * pa * ypt * adj_t, rec=tsh * pa * crt, car=csh * ra, ryd=csh * ra * ypc * adj_c,
                    pa=qsh * pa, pyd=qsh * pa * ypa * adj_p), st["gp"].w

    def update(self, season, wk, wrows):
        f, ft = self.f, self.ft
        team_tot = collections.defaultdict(lambda: collections.defaultdict(float))
        for r in wrows:
            t = team_tot[r["team"]]
            t["pa"] += r["att"]; t["ra"] += r["car"]; t["tg"] += r["tgt"]
        for r in wrows:
            t, st = team_tot[r["team"]], self.P[r["pid"]]
            self.meta[r["pid"]] = (r["name"], r["pos"], r["team"])
            if t["tg"] > 0: st["tsh"].add(r["tgt"] / t["tg"], f)
            if t["ra"] > 0: st["csh"].add(r["car"] / t["ra"], f)
            if t["pa"] > 0 and r["pos"] == "QB": st["qsh"].add(r["att"] / t["pa"], f)
            st["tg"].add(r["tgt"], f); st["ty"].add(r["yd"], f); st["tr"].add(r["rec"], f)
            st["cr"].add(r["car"], f); st["cy"].add(r["ryd"], f)
            if r["att"] >= 10 and r["pos"] == "QB":
                st["pa"].add(r["att"], f); st["py"].add(r["pyd"], f)
            st["gp"].add(1, f)
            df = self.DEF[r["opp"]]
            df["tg"].add(r["tgt"], ft); df["ty"].add(r["yd"], ft); df["cr"].add(r["car"], ft); df["cy"].add(r["ryd"], ft)
            if r["pos"] == "QB":
                df["pa"].add(r["att"], ft); df["py"].add(r["pyd"], ft)
        for tm, t in team_tot.items():
            self.TEAM[tm]["pa"].add(t["pa"], ft); self.TEAM[tm]["ra"].add(t["ra"], ft)
            self.recent[tm].append((season, wk, {r["pid"] for r in wrows if r["team"] == tm}))
        acc = self.lgacc
        for r in wrows:
            acc["tg"] += r["tgt"]; acc["ty"] += r["yd"]; acc["cr"] += r["car"]; acc["cy"] += r["ryd"]
            if r["pos"] == "QB":
                acc["pa"] += r["att"]; acc["py"] += r["pyd"]
        if acc["tg"] > 2000:
            self.LG["ypt"] = acc["ty"] / acc["tg"]; self.LG["ypc"] = acc["cy"] / max(acc["cr"], 1); self.LG["ypa"] = acc["py"] / max(acc["pa"], 1)


def _eligible(market, pos, proj, gp):
    vk, th, _ = MARKETS[market]
    if proj[vk] < th or gp < 2:
        return False
    if market == "pass_yds":
        return pos == "QB"
    if market in ("rec_yds", "receptions"):
        return pos in ("WR", "TE", "RB")
    return pos in ("RB", "QB")


def _boost(W, season, team, active):
    mt, mc, at, ac, mq, aq = W.missing(season, team, active)
    return (1.0 + REDIST_T * mt / at if at > 0.2 else 1.0, 1.0 + REDIST_C * mc / ac if ac > 0.2 else 1.0,
            1.0 + REDIST_Q * mq / aq if aq > 0.02 else 1.0)


def _walk(seasons_rows, collect_from, keys=None):
    """Run every season in order; collect (season, market, projection, actual) for seasons >= collect_from."""
    W = Walker()
    hist = []
    for y in sorted(seasons_rows):
        W.new_season()
        byweek = collections.defaultdict(list)
        for r in seasons_rows[y]:
            byweek[r["wk"]].append(r)
        for wk in sorted(byweek):
            if y >= collect_from:
                act_by = collections.defaultdict(set)
                for r in byweek[wk]:
                    act_by[r["team"]].add(r["pid"])
                boosts = {t: _boost(W, y, t, a) for t, a in act_by.items()}
                for r in byweek[wk]:
                    proj, gp = W.project(r["pid"], r["pos"], r["team"], r["opp"], boosts.get(r["team"], (1.0, 1.0, 1.0)))
                    for mk, (_, _, ak) in MARKETS.items():
                        if _eligible(mk, r["pos"], proj, gp):
                            act = {"yd": r["yd"], "rec": r["rec"], "ryd": r["ryd"], "pyd": r["pyd"]}[ak]
                            hist.append((y, mk, proj[ak], act))
                            if keys is not None:
                                keys[(y, wk, _norm(r["name"]), r["team"], mk)] = (proj[ak], act)
            W.update(y, wk, byweek[wk])
    return W, hist


def _tables(hist, years):
    """Per market: projection-size edges and quantiles 1..99 of actual / projected, from the given seasons."""
    out = {}
    for mk in MARKETS:
        rows = [(p, a) for y, m, p, a in hist if m == mk and y in years and p > 0]
        if len(rows) < 200:
            continue
        p = np.array([r[0] for r in rows]); a = np.array([r[1] for r in rows])
        edges = np.quantile(p, [0.25, 0.5, 0.75]).tolist()
        qs = []
        for b in range(4):
            lo = -np.inf if b == 0 else edges[b - 1]; hi = np.inf if b == 3 else edges[b]
            k = (p >= lo) & (p < hi)
            qs.append([round(float(x), 4) for x in np.quantile(a[k] / p[k], np.linspace(0.01, 0.99, 99))])
        out[mk] = {"edges": [round(e, 2) for e in edges], "ratio": qs}
    return out


def _band(tab, p):
    return int(np.searchsorted(tab["edges"], p, side="right"))


def _backtest(hist, years_test):
    """MAE of the median and coverage of the middle 50%, each season scored with tables from earlier seasons only."""
    res = collections.defaultdict(lambda: [0, 0.0, 0])
    for ty in years_test:
        tab = _tables(hist, {y for y in range(ty - 4, ty)})
        for y, mk, p, a in hist:
            if y != ty or mk not in tab:
                continue
            q = tab[mk]["ratio"][_band(tab[mk], p)]
            med, q25, q75 = p * q[49], p * q[24], p * q[74]
            r = res[mk]; r[0] += 1; r[1] += abs(a - med); r[2] += q25 <= a <= q75
    return {mk: {"n": n, "mae": round(s / n, 2), "middle50": round(c / n, 3)} for mk, (n, s, c) in res.items() if n}


# ---------------------------------------------------------------- totals
def _totals(games, cur):
    teams = sorted({ALIAS.get(r[k], r[k]) for r in games for k in ("home_team", "away_team")})
    ix = {t: i for i, t in enumerate(teams)}; n = len(teams)
    f = 0.5 ** (1 / T_HL)
    A = np.zeros((2 * n, 2 * n)); b = np.zeros(2 * n); prior = np.zeros(2 * n); mu_s = mu_w = 0.0
    hist, upcoming = [], {}
    seasons = sorted({int(r["season"]) for r in games})
    for y in seasons:
        ys = sorted([r for r in games if int(r["season"]) == y], key=lambda r: (int(r["week"]), r["gameday"]))
        if mu_w:
            prior = T_CARRY * np.linalg.solve(A + T_K * np.eye(2 * n), b + T_K * prior)
        A[:] = 0; b[:] = 0
        for wk in sorted({int(r["week"]) for r in ys}):
            sol = np.linalg.solve(A + T_K * np.eye(2 * n), b + T_K * prior)
            mu = mu_s / mu_w if mu_w else 22.0
            wrows = [r for r in ys if int(r["week"]) == wk]
            for r in wrows:
                h, a = ix[ALIAS.get(r["home_team"], r["home_team"])], ix[ALIAS.get(r["away_team"], r["away_team"])]
                neutral = r.get("location") == "Neutral"
                ph = mu + sol[h] - sol[n + a] + (0 if neutral else T_HOME / 2)
                pa = mu + sol[a] - sol[n + h] - (0 if neutral else T_HOME / 2)
                tot = ph + pa
                try:
                    if r.get("wind") not in ("", None) and r.get("roof") in ("outdoors", "open"):
                        tot -= T_WIND * max(0.0, float(r["wind"]) - 10)
                except ValueError:
                    pass
                if r["home_score"] in ("", None):
                    if y == cur:
                        upcoming[r.get("espn") or r["game_id"]] = {"total": round(tot, 1), "home": round(ph, 1), "away": round(pa, 1), "game": r["game_id"]}
                else:
                    hist.append((y, tot, float(r["home_score"]) + float(r["away_score"]), float(r["total_line"]) if r.get("total_line") else None))
            done = [r for r in wrows if r["home_score"] not in ("", None)]
            if not done:
                break
            A *= f; b *= f
            for r in done:
                h, a = ix[ALIAS.get(r["home_team"], r["home_team"])], ix[ALIAS.get(r["away_team"], r["away_team"])]
                neutral = r.get("location") == "Neutral"
                hs, as_ = float(r["home_score"]), float(r["away_score"])
                mu_s += hs + as_; mu_w += 2
                mu = mu_s / mu_w
                for off, de, pts, sign in ((h, a, hs, 1), (a, h, as_, -1)):
                    x = np.zeros(2 * n); x[off] = 1; x[n + de] = -1
                    A += np.outer(x, x); b += x * (pts - mu - (0 if neutral else sign * T_HOME / 2))
    return upcoming, hist


def _totals_backtest(hist, lo, hi):
    h = [x for x in hist if lo <= x[0] <= hi and x[3] is not None]
    if not h:
        return None
    m = np.array([x[1] for x in h]); a = np.array([x[2] for x in h]); l = np.array([x[3] for x in h])
    d = m - l; r = a - l
    w = int(((np.sign(d) == np.sign(r)) & (r != 0) & (d != 0)).sum()); lo_ = int(((np.sign(d) != np.sign(r)) & (r != 0) & (d != 0)).sum())
    return {"games": len(h), "mae": round(float(np.abs(a - m).mean()), 2), "lineMae": round(float(np.abs(a - l).mean()), 2), "ou": [w, lo_]}


def _norm(s):
    import re
    return re.sub(r"[^a-z]", "", (s or "").lower().replace(" jr", "").replace(" iii", "").replace(" ii", ""))


def _book_grade(cur, keys, tables, games):
    """Walk-forward projections for this season's finished games against SportsGameOdds closing lines
    (track/_sgo_nfl_{season}.json, from sgo.py). Fits how far the board's over/under chances must be pulled toward
    50% to match how often players actually went over, and keeps a record of picks against those lines. Grading only:
    the lines never move a projection and are never published."""
    from datetime import timedelta as _td
    ev = (read(f"track/_sgo_nfl_{cur}.json") or {}).get("events") or {}
    if not ev:
        return None
    wk = {}
    for g in games:
        if int(g["season"]) == cur and g["game_type"] == "REG":
            for t in (g["home_team"], g["away_team"]):
                wk[(ALIAS.get(t, t), g["gameday"])] = int(g["week"])
    imp = lambda o: (100 / (o + 100) if o > 0 else -o / (-o + 100)) if o else None
    pay = lambda o: o / 100 if o > 0 else 100 / -o
    R = []
    for e in ev.values():
        if not e.get("d"):
            continue
        day = (datetime.fromisoformat(e["d"]) - _td(hours=6)).date().isoformat()
        for name, team, mk, line, oo, ou, _res, *_open in e["props"]:
            w = wk.get((team, day))
            hit = keys.get((cur, w, _norm(name), team, mk)) if w else None
            if hit is None or mk not in tables or hit[1] == line or not (oo and ou):
                continue
            pr, act = hit
            qs = tables[mk]["ratio"][_band(tables[mk], pr)]
            po = sum(1 for q in qs if pr * q > line) / len(qs)
            io, iu = imp(oo), imp(ou)
            R.append((mk, po, io / (io + iu), act > line, oo, ou))
    if len(R) < 300:
        return {"graded": len(R)}
    po = np.array([r[1] for r in R]); pm = np.array([r[2] for r in R]); y = np.array([r[3] for r in R], float)
    best = min(np.arange(0.05, 1.001, 0.05), key=lambda k: float(np.mean((0.5 + (po - 0.5) * k - y) ** 2)))
    pc = 0.5 + (po - 0.5) * best
    rec = {}
    for th in (0.05, 0.10):
        w = n = 0; prof = 0.0
        for r, p in zip(R, pc):
            e = p - r[2]
            if abs(e) < th:
                continue
            over = e > 0
            won = bool(r[3]) == over
            n += 1; w += int(won); prof += float(pay(r[4] if over else r[5])) if won else -1.0
        rec[str(th)] = {"won": w, "lost": n - w, "units": round(prof, 1), "roi": round(prof / n, 3) if n else None}
    return {"graded": len(R), "shrink": round(float(best), 2), "brierRaw": round(float(np.mean((po - y) ** 2)), 4),
            "brierCalibrated": round(float(np.mean((pc - y) ** 2)), 4), "brierMarket": round(float(np.mean((pm - y) ** 2)), 4),
            "overRate": round(float(y.mean()), 3), "record": rec, "note": "calibrated chance vs no-vig closing price; units at the closing price"}


def _log_and_grade(cur, week, rows, cur_rows):
    """Keep every projection made before kickoff (the last one wins), then grade it from nflverse once the week's
    stats are published. data/sports/track/_props_nfl.json; the summary goes on the board."""
    store = read("track/_props_nfl.json") or {}
    if store.get("season") != cur:
        store = {"season": cur, "log": {}}
    log = store["log"]
    for r in rows:
        k = f"{week}|{r['player']}|{r['team']}|{r['market']}"
        if "act" not in log.get(k, {}):
            log[k] = {"wk": week, "m": r["median"], "lo": r["p25"], "hi": r["p75"]}
    played = {(x["wk"], x["name"], x["team"]): x for x in cur_rows}
    weeks_done = {x["wk"] for x in cur_rows}
    for k, e in log.items():
        if "act" in e or e["wk"] not in weeks_done:
            continue
        wk, name, team, mk = k.split("|")
        x = played.get((int(wk), name, team))
        if x is None:
            e["act"] = None                      # did not play: void, not graded
            continue
        e["act"] = {"rec_yds": x["yd"], "receptions": x["rec"], "rush_yds": x["ryd"], "pass_yds": x["pyd"]}[mk]
    write("track/_props_nfl.json", store)
    summ = {}
    for mk in MARKETS:
        g = [e for k, e in log.items() if k.endswith("|" + mk) and e.get("act") is not None]
        if g:
            summ[mk] = {"n": len(g), "mae": round(sum(abs(e["act"] - e["m"]) for e in g) / len(g), 2),
                        "middle50": round(sum(e["lo"] <= e["act"] <= e["hi"] for e in g) / len(g), 3),
                        "overMedian": round(sum(e["act"] > e["m"] for e in g) / len(g), 3)}
    return summ


def job_props():
    cur = (read("model/nfl.json") or {}).get("season")
    if not cur:
        raise RuntimeError("no NFL season in model/nfl.json")
    from .nflqb import AB2ID
    seasons = {y: _season_rows(y) for y in range(cur - 6, cur + 1)}
    keys = {}
    W, hist = _walk(seasons, cur - 6, keys)
    tables = _tables(hist, {y for y in range(cur - 4, cur)})
    back = _backtest(hist, list(range(cur - 3, cur)))
    games = [r for r in _csv(GAMES_URL) if r["game_type"] == "REG" and int(r["season"]) >= cur - 7]
    cache = (read("model/_games_nfl.json") or {}).get("events", {})
    now16 = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")
    started = lambda r: (cache.get(r.get("espn") or "") or {}).get("d", "9999") <= now16      # kicked off already (ESPN start, UTC)
    left = sorted({int(r["week"]) for r in games if r["season"] == str(cur) and r["home_score"] in ("", None) and not started(r)})
    week = left[0] if left else None
    up = [r for r in games if r["season"] == str(cur) and week is not None and int(r["week"]) == week and r["home_score"] in ("", None) and not started(r)]
    inj = (read("injuries/nfl.json") or {}).get("teams", {})
    out_names = {(t, _norm(r.get("name"))) for t, rows in inj.items() for r in rows if r.get("status") in OUT_STATUS}
    rows = []
    for g in up:
        for side, team, opp in (("a", g["away_team"], g["home_team"]), ("h", g["home_team"], g["away_team"])):
            team, opp = ALIAS.get(team, team), ALIAS.get(opp, opp)
            recent = [x for x in W.recent[team] if x[0] == cur][-3:]
            pids = set().union(*[x[2] for x in recent]) if recent else set()
            active = {q for q in pids if (AB2ID.get(team), _norm(W.meta.get(q, ("",))[0])) not in out_names}
            boost = _boost(W, cur, team, active)       # ruled-out regulars' targets, carries and attempts go to those who play
            def _matters(q):
                st = W.P[q]
                return st["tsh"].mean(0.0, K_SHARE) >= 0.05 or st["csh"].mean(0.0, K_SHARE) >= 0.05 or st["qsh"].mean(0.0, 0.5) >= 0.3
            missing = sorted({W.meta[q][0] for q in pids - active if W.meta.get(q, (None, None, None))[2] == team and _matters(q)})
            for pid in pids:
                name, pos, tm = W.meta.get(pid, (None, None, None))
                if tm != team or pid not in active:
                    continue
                proj, gp = W.project(pid, pos, team, opp, boost)
                for mk, (vk, _, ak) in MARKETS.items():
                    if mk not in tables or not _eligible(mk, pos, proj, gp):
                        continue
                    q = tables[mk]["ratio"][_band(tables[mk], proj[ak])]
                    rows.append({"player": name, "pos": pos, "team": team, "opp": opp, "home": side == "h", "market": mk,
                                 "mean": round(proj[ak], 1), "median": round(proj[ak] * q[49], 1), "p25": round(proj[ak] * q[24], 1),
                                 "p75": round(proj[ak] * q[74], 1), "band": _band(tables[mk], proj[ak]),
                                 "vol": round(proj[vk], 1), "volLabel": {"tg": "targets", "car": "carries", "pa": "attempts"}[vk],
                                 "espn": g.get("espn"), "kick": f"{g['gameday']} {g['gametime']} ET",
                                 "without": missing[:4] if (mk in ("rec_yds", "receptions") and boost[0] > 1.02) or (mk == "rush_yds" and boost[1] > 1.02) or (mk == "pass_yds" and boost[2] > 1.02) else []})
    rows.sort(key=lambda r: (r["market"], -r["median"]))
    up_tot, thist = _totals(games, cur)
    totals = []
    for g in up:
        t = up_tot.get(g.get("espn") or g["game_id"])
        if not t:
            continue
        ev = cache.get(g.get("espn") or "", {})
        totals.append(dict(t, away=ALIAS.get(g["away_team"], g["away_team"]), home=ALIAS.get(g["home_team"], g["home_team"]),
                           awayId=AB2ID.get(g["away_team"]), homeId=AB2ID.get(g["home_team"]), espn=g.get("espn"),
                           start=ev.get("d"), kick=f"{g['gameday']} {g['gametime']} ET", wind=g.get("wind") or None, roof=g.get("roof"),
                           awayPts=t["away"], homePts=t["home"]))
    live = _log_and_grade(cur, week, rows, seasons[cur])
    from . import kalshi
    kedges, krec = kalshi.attach(rows, tables, week, cur)
    # games that have kicked off keep their last pre-game numbers for four days, so their game pages still show them
    prev = read("props/nfl.json") or {}
    since = (datetime.now(timezone.utc) - timedelta(days=4)).strftime("%Y-%m-%dT%H:%M")
    keep = lambda e: bool(e) and since <= (cache.get(e) or {}).get("d", "") <= now16
    fresh = {r.get("espn") for r in rows}
    rows += [dict(r, locked=True) for r in prev.get("props") or [] if r.get("espn") not in fresh and keep(r.get("espn"))]
    fresh_t = {t.get("espn") for t in totals}
    totals += [dict(t, locked=True) for t in prev.get("totals") or [] if t.get("espn") not in fresh_t and keep(t.get("espn"))]
    book = _book_grade(cur, keys, tables, games)
    out = {"season": cur, "week": week, "updated": now_iso(), "calib": {"shrink": (book or {}).get("shrink", 1.0)} if (book or {}).get("shrink") else None, "book": book, "props": rows, "tables": tables, "totals": totals, "live": live, "kalshiEdges": kedges, "kalshiRecord": krec,
           "backtest": {"props": back, "seasons": [cur - 3, cur - 1], "totals": _totals_backtest(thist, cur - 7, cur - 1)},
           "source": "nflverse (CC-BY 4.0) weekly player stats and schedules; ESPN injury report"}
    write("props/nfl.json", out)
    return {"week": week, "props": len(rows), "totals": len(totals), "book": book, "kalshiMatched": sum(1 for r in rows if r.get("kalshi")),
            "kalshiEdges": len(kedges), "kalshiRecord": krec, "backtest": back}
