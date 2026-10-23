"""Fit the house model's settings on past seasons instead of guessing them.

For every league with stored history (history.py) the model is replayed week by week over each past
season: a week's games are projected using only games from earlier weeks, plus a preseason prior of
carry x last season's rating. Settings are chosen to minimise log loss (how well the stated win
probabilities fit what happened).

  searched   k        how many games of weight each team's starting point gets
             carry    how much of last season's rating is kept as that starting point
             hfa      home edge (not for the NFL, see below)
             cap/soft margin of victory limits: a hard cap, or a soft one (c x tanh(margin / c)) so a
                      blowout still counts a little more than a comfortable win (football, college basketball)
             hl       recency: a game's weight halves every hl weeks (None = all games equal)
             pv       1 = widen each win probability by how unsure the two ratings still are (early season,
                      thin schedules), 0 = one spread for every game
             newp     college only: a program new to the division starts at last season's level of the
                      pooled outsiders instead of at the division average
             rest     points (goals, runs) per day of rest advantage, rest = days since the team's previous
                      game this season, capped per league (REST_CAP) so only the part that matters counts
                      (NFL byes and short weeks, NBA/NHL back-to-backs); a team's first game counts as rested
             xg       NHL: share of each game's rating input taken from expected-goals margin (MoneyPuck); NFL: from EPA margin (nflverse)
                      instead of actual goal margin (0 = goals only); projections still predict real results
             sp       MLB only: weight on the starting-pitcher edge (runs the two starters should differ by over a
                      typical start, from extra.mlb_sp_edges; 1 = take it at face value)
             ps       college only: 1 = fit the spread used for win probabilities to wins and losses (log
                      loss) instead of to margins; blowouts inflate the margin spread and flatten the
                      probabilities (college football favorites won more often than the margin spread implied)
  not searched   sigma, the spread of projection errors (fit directly), and the NFL home edge, which is
             taken from the market: the average closing line on non-neutral games over the last five
             non-pandemic seasons (history/market_nfl.json). Game outcomes are too noisy to pin the home
             edge down (about +/-0.4 points over five seasons) and the edge has fallen since the 2000s;
             closing lines measure it with far less noise and show no division-game discount since 2021.

Honesty check (rolling origin): for each of the newest four seasons (fewer when history is short) the
settings are fit on the seasons before it, then scored on that season, which they never saw, using the
spread measured on the training seasons. They are adopted only if they beat the league's preset settings
across those held-out seasons: pooled log loss better by at least MIN_GAIN, a paired game-by-game z of at
least MIN_Z (or MIN_Z_CONSISTENT when most folds improved), and no held-out season clearly worse.
Pandemic seasons (no or few fans, odd schedules) are left out of fitting and scoring; they still serve as
"last season" for the year after. Only the newest WINDOW seasons are used, so a long-gone era does not
set today's numbers. model/tuned.json records every fold, the calibration of the held-out projections
and, for the NFL, how the model compares with closing lines over the same seasons."""
import json
import math

import numpy as np

from . import history
from . import model as M
from .common import now_iso, read, write

LEAGUES = ["nfl", "ncaaf", "nhl", "nba", "ncaab", "ncaah", "mlb"]
WINDOW = 16          # newest seasons used; older ones count less (SEASON_HL), so a long window adds data without dragging in old eras
SEASON_HL = 6.0      # half-life, in seasons, of a training season's weight in the settings search (None = equal weights)
NFOLDS = 4
MIN_GAIN = 0.0005
MIN_Z = 1.5
MIN_Z_CONSISTENT = 1.0
WORST_FOLD = -0.004        # no held-out season may get worse by more than this
COVID = {"nfl": {2020}, "ncaaf": {2020}, "nba": {2020, 2021}, "nhl": {2020, 2021}, "ncaab": {2021}, "ncaah": {2021}, "mlb": {2020}}
GRID = {
    "k": [0.5, 0.7, 1.0, 1.4, 2.0, 2.8, 4.0, 5.6],                # multiples of the preset k
    "carry": [0.0, 0.3, 0.45, 0.6, 0.7, 0.8, 0.9, 1.0],
    "hfa": [0.6, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0],   # multiples of the preset home edge
    "hl": [None, 4, 8, 12, 20, 30],
    "pv": [0, 1],
    "cap": {"ncaaf": [21, 28, 35, 45, None], "ncaab": [25, 30, 40, 60, None]},
    "soft": {"nfl": [None, 14, 20, 28], "ncaaf": [None, 15, 25, 35], "ncaab": [None, 15, 25, 35]},
    "newp": {"ncaaf": ["zero", "pool"], "ncaab": ["zero", "pool"]},
    "ps": {"ncaaf": [0, 1], "ncaab": [0, 1]},
    "sp": {"mlb": [0, 0.5, 0.75, 1.0, 1.25, 1.5]},
    "xg": {"nhl": [0, 0.15, 0.25, 0.35, 0.5, 0.75, 1.0], "nfl": [0, 0.2, 0.4, 0.6, 0.8]},
    "rest": {"nfl": [0, 0.1, 0.2, 0.3], "nba": [0, 0.5, 1.0, 1.5, 2.0], "nhl": [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3],
             "mlb": [0, 0.05, 0.1], "ncaab": [0, 0.25, 0.5, 1.0], "ncaaf": [0, 0.1, 0.2, 0.3], "ncaah": [0, 0.05, 0.1]},
}
REST_CAP = M.REST_CAP           # shared with the live model so a fitted rest edge means the same thing in both


# ---------------------------------------------------------------- data
class League:
    """Stored seasons as arrays over one shared team list (current members plus the pooled outsider)."""

    def __init__(self, lg):
        self.lg = lg
        smap = M._standings_map(lg)
        members = set(M._members(lg))
        group = {t: smap.get(t, {}).get("group") for t in members}
        div = M.PARAMS[lg].get("divHfa") is not None
        ids = sorted(members | {M.POOL})
        self.ix = {t: i for i, t in enumerate(ids)}
        self.n = len(ids)
        self.pool = self.ix[M.POOL]
        self.seasons = {}
        self.dropped = 0
        for y, games in history.load(lg).items():
            rows = []
            for g in games:
                h, a = M.alias(lg, g["h"]), M.alias(lg, g["a"])
                if lg in M.PRO_ONLY and (h not in members or a not in members):
                    self.dropped += 1                 # all-star games, international exhibitions
                    continue
                hn, an = (h if h in members else M.POOL), (a if a in members else M.POOL)
                if hn == an:
                    continue
                same = div and bool(group.get(h)) and group.get(h) == group.get(a)
                rows.append((g["d"], self.ix[hn], self.ix[an], g["hs"] - g["as"], bool(g["n"]), same, g.get("wk"), g.get("sp"), (g["hs"], g["as"])))
            if not rows:
                continue
            rows.sort(key=lambda r: r[0])
            S = Season()
            S.d = [r[0] for r in rows]
            S.h = np.array([r[1] for r in rows]); S.a = np.array([r[2] for r in rows])
            S.m = np.array([r[3] for r in rows], float); S.n = np.array([r[4] for r in rows], bool)
            S.same = np.array([r[5] for r in rows], bool)
            S.rd = rest_diff([r[0] for r in rows], [r[1] for r in rows], [r[2] for r in rows], REST_CAP.get(lg, 7))
            S.sp = np.zeros(len(rows))
            S.xgm = S.m.copy()
            if lg == "nhl":
                S.xgm, S.xgCover = xg_margins(y, rows, {i: t for t, i in self.ix.items()})
            if lg == "nfl":
                from . import nflqb
                lk = nflqb.epa_lookup(y)
                inv = {i: t for t, i in self.ix.items()}
                S.xgm = np.array([lk.get((inv[r[1]], inv[r[2]]), float(r[3])) for r in rows], float)
            if lg == "mlb":
                S.sp, S.spCover = sp_edges(y, rows, {i: t for t, i in self.ix.items()})
            from . import ctx
            S.av, S.avCover = ctx.season_edges(lg, y, rows, {i: t for t, i in self.ix.items()})
            S.avp = ctx.season_proj_edges(lg, y, rows, {i: t for t, i in self.ix.items()})
            if all(r[6] is not None for r in rows):
                S.week = np.array([r[6] for r in rows], int)
            else:
                d0 = _ord(rows[0][0])
                S.week = np.array([(_ord(r[0]) - d0) // 7 for r in rows], int)
            self.seasons[y] = S
        self.years = sorted(self.seasons)


class Season:
    pass


def xg_margins(year, rows, inv):
    """NHL expected-goals margin (home minus away) for each stored game, matched to MoneyPuck by date and goals;
    falls back to the real goal margin where MoneyPuck has no row."""
    from . import extra
    xg = extra.nhl_xg_lookup(year)
    out, hit = [], 0
    for r in rows:
        v = xg.get((r[0][:10], inv[r[1]], inv[r[2]])) if xg else None
        out.append(v if v is not None else float(r[3]))
        hit += v is not None
    return np.array(out, float), hit / max(1, len(rows))


def sp_edges(year, rows, inv):
    """MLB starting-pitcher edge (runs, home perspective) for each stored game, matched on start time and score,
    falling back to the calendar day; 0 where the starters are unknown."""
    from datetime import date, timedelta
    from . import extra
    e = extra.mlb_sp_edges(year)
    out, hit = [], 0
    for r in rows:
        h, a, hs, as_ = inv[r[1]], inv[r[2]], None, None
        g = r[8] if len(r) > 8 else None
        v = e.get((r[0][:16], h, a) + (g or ())) if g else None
        if v is None:
            for dd in (0, -1):
                k = ("day", (date.fromisoformat(r[0][:10]) + timedelta(days=dd)).isoformat(), h, a) + (g or ())
                v = e.get(k)
                if v is not None:
                    break
        out.append(v if v is not None else 0.0)
        hit += v is not None
    return np.array(out, float), hit / max(1, len(rows))


def rest_diff(dates, homes, aways, cap):
    """home rest minus away rest in days (each capped at `cap`); a team's first game counts as fully rested."""
    last, out = {}, []
    for d, h, a in zip(dates, homes, aways):
        o = _ord(d)
        rh = min(cap, o - last[h]) if h in last else cap
        ra = min(cap, o - last[a]) if a in last else cap
        out.append(rh - ra)
        last[h] = last[a] = o
    return np.array(out, float)


def _ord(d):
    from datetime import date
    return date(int(d[:4]), int(d[5:7]), int(d[8:10])).toordinal()


# ---------------------------------------------------------------- replay
def _y(S, p):
    m = S.m
    if p.get("xg"):
        m = (1 - p["xg"]) * m + p["xg"] * S.xgm
    if p.get("soft"):
        m = p["soft"] * np.tanh(m / p["soft"])
    elif p.get("cap"):
        m = np.clip(m, -p["cap"], p["cap"])
    hv = np.full(len(m), float(p["hfa"]))
    if p.get("divHfa") is not None:
        hv[S.same] = p["divHfa"]
    hv[S.n] = 0.0
    if p.get("rest"):
        hv = hv + p["rest"] * S.rd          # rest edge travels with the home edge: removed from results, added to projections
    if p.get("sp"):
        hv = hv + p["sp"] * S.sp            # same for the starting-pitcher edge (MLB)
    if p.get("av"):
        hv = hv + p["av"] * S.av            # and for who is playing (ctx.py: NBA player availability)
    return m - hv, hv


def _lam(L, k):
    lam = np.full(L.n, float(k))
    lam[L.pool] = max(k, 50)
    return lam


def _decay(p):
    return 0.5 ** (1.0 / p["hl"]) if p.get("hl") else 1.0


def final(L, S, p):
    """End-of-season ratings (same recency weighting) and which teams played."""
    y, _ = _y(S, p)
    n, f = L.n, _decay(p)
    deg = np.zeros(n); b = np.zeros(n); adj = np.zeros((n, n)); last = None
    for wk in np.unique(S.week):
        if last is not None and f != 1.0:
            dec = f ** (wk - last); deg *= dec; b *= dec; adj *= dec
        last = wk
        idx = np.nonzero(S.week == wk)[0]
        h, a, yy = S.h[idx], S.a[idx], y[idx]
        deg += np.bincount(h, minlength=n) + np.bincount(a, minlength=n)
        b += np.bincount(h, yy, n) - np.bincount(a, yy, n)
        np.add.at(adj, (h, a), -1.0); np.add.at(adj, (a, h), -1.0)
    A = adj.copy()
    A[np.diag_indices_from(A)] += deg + _lam(L, p["k"])
    return np.linalg.solve(A, b), deg > 0


def prior_for(L, y, p):
    pr = np.zeros(L.n)
    if not p.get("carry") or (y - 1) not in L.seasons:
        return pr
    R, seen = final(L, L.seasons[y - 1], p)
    pr = np.where(seen, p["carry"] * R, 0.0)
    if p.get("newp") == "pool" and seen[L.pool]:
        pr = np.where(seen, pr, p["carry"] * R[L.pool])
    return pr


def replay(L, S, p, prior):
    """Walk forward week by week: (projected home margin, rating-uncertainty term) for every game."""
    y, hv = _y(S, p)
    n, f, lam = L.n, _decay(p), _lam(L, p["k"])
    deg = np.zeros(n); b = np.zeros(n); adj = np.zeros((n, n))
    proj = np.zeros(len(S.m)); u = np.zeros(len(S.m)); last = None
    for wk in np.unique(S.week):
        if last is not None and f != 1.0:
            dec = f ** (wk - last); deg *= dec; b *= dec; adj *= dec
        last = wk
        idx = np.nonzero(S.week == wk)[0]
        A = adj.copy()
        A[np.diag_indices_from(A)] += deg + lam
        R = np.linalg.solve(A, b + lam * prior)
        h, a = S.h[idx], S.a[idx]
        proj[idx] = R[h] - R[a] + hv[idx]
        u[idx] = 1.0 / (deg[h] + lam[h]) + 1.0 / (deg[a] + lam[a])
        yy = y[idx]
        deg += np.bincount(h, minlength=n) + np.bincount(a, minlength=n)
        b += np.bincount(h, yy, n) - np.bincount(a, yy, n)
        np.add.at(adj, (h, a), -1.0); np.add.at(adj, (a, h), -1.0)
    if p.get("av") and getattr(S, "avp", None) is not None:
        proj = proj + p["av"] * (S.avp - S.av)    # projections only know what was knowable before the game
    return proj, u


def run(L, years, p):
    P, U, A = [], [], []
    for y in years:
        pr, uu = replay(L, L.seasons[y], p, prior_for(L, y, p))
        P.append(pr); U.append(uu); A.append(L.seasons[y].m)
    return np.concatenate(P), np.concatenate(U), np.concatenate(A)


def fit_sigma(P, U, A, pv, ps=0):
    """Spread of projection errors. ps=1: the spread that best fits wins and losses instead (log loss)."""
    err = A - P
    s = float(math.sqrt(np.mean(err ** 2 / (1 + U)))) if pv else float(math.sqrt(np.mean(err ** 2)))
    if not ps:
        return s
    res = np.where(A > 0, 1.0, np.where(A < 0, 0.0, 0.5))
    best, bs = None, s
    for f in np.arange(0.80, 1.101, 0.01):
        p = probs(P, U, s * f, pv)
        ll = float(-(res * np.log(p) + (1 - res) * np.log(1 - p)).mean())
        if best is None or ll < best:
            best, bs = ll, s * f
    return float(bs)


def margin_sigma(P, U, A, pv):
    return fit_sigma(P, U, A, pv, 0)


_erf = np.vectorize(math.erf)


def probs(P, U, s0, pv):
    sig = s0 * np.sqrt(1 + U) if pv else s0
    return np.clip(0.5 * (1 + _erf(P / sig / math.sqrt(2))), 1e-4, 1 - 1e-4)


def score(P, U, A, s0, pv):
    p = probs(P, U, s0, pv)
    res = np.where(A > 0, 1.0, np.where(A < 0, 0.0, 0.5))
    ll = -(res * np.log(p) + (1 - res) * np.log(1 - p))
    dec = A != 0
    return {"ll": ll, "p": p, "res": res, "n": int(len(A)), "sigma": round(s0, 3), "logloss": float(ll.mean()),
            "brier": float(((p - res) ** 2).mean()), "acc": float(((p >= 0.5) == (res == 1.0))[dec].mean()) if dec.any() else None,
            "homeBrier": float(((res.mean() - res) ** 2).mean()), "mae": float(np.abs(A - P).mean())}


def train_ll(L, years, p):
    P, U, A, W = [], [], [], []
    for y in years:
        pr, uu = replay(L, L.seasons[y], p, prior_for(L, y, p))
        P.append(pr); U.append(uu); A.append(L.seasons[y].m)
        W.append(np.full(len(pr), 0.5 ** ((years[-1] - y) / SEASON_HL) if SEASON_HL else 1.0))
    P, U, A, W = map(np.concatenate, (P, U, A, W))
    sc = score(P, U, A, fit_sigma(P, U, A, p.get("pv"), p.get("ps")), p.get("pv"))
    return float((sc["ll"] * W).sum() / W.sum())


def holdout(L, train, test, p):
    Pt, Ut, At = run(L, train, p)
    s0 = fit_sigma(Pt, Ut, At, p.get("pv"), p.get("ps"))
    P, U, A = run(L, test, p)
    return score(P, U, A, s0, p.get("pv"))


def calibration(p, res, bins=(0.0, 0.2, 0.35, 0.45, 0.55, 0.65, 0.8, 1.0001)):
    out = []
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = (p >= lo) & (p < hi)
        if m.sum():
            out.append({"lo": lo, "hi": min(hi, 1.0), "n": int(m.sum()), "exp": round(float(p[m].mean()), 3), "act": round(float(res[m].mean()), 3)})
    return out


# ---------------------------------------------------------------- search
def _grid(lg, preset, fixed):
    out = [("k", sorted({round(preset["k"] * f, 3) for f in GRID["k"]})), ("carry", GRID["carry"])]
    if "hfa" not in fixed:
        out.append(("hfa", sorted({round(preset["hfa"] * f, 3) for f in GRID["hfa"]})))
    for key in ("cap", "soft", "newp", "ps", "rest", "sp", "xg"):
        if lg in GRID[key]:
            out.append((key, GRID[key][lg]))
    out += [("hl", GRID["hl"]), ("pv", GRID["pv"])]
    return out


def search(L, years, start, preset, fixed):
    p = dict(start)
    best = train_ll(L, years, p)
    grid = _grid(L.lg, preset, fixed)
    for _ in range(3):
        moved = False
        for name, vals in grid:
            for v in vals:
                q = dict(p)
                q[name] = v
                if name == "hfa" and preset.get("divHfa") is not None and "divHfa" not in fixed:
                    q["divHfa"] = round(preset["divHfa"] * v / preset["hfa"], 3)
                if name == "soft" and v:
                    q["cap"] = None
                if q == p:
                    continue
                ll = train_ll(L, years, q)
                if ll < best - 1e-7:
                    best, p, moved = ll, q, True
        if not moved:
            break
    return p, best


# every team plays about as many home games as away games. Not MLB: a home team that leads after 8 1/2
# innings never bats in the 9th, so run margin understates the home edge there; MLB's edge is fitted.
BALANCED = {"nba", "nhl"}


def fixed_hfa(L, years):
    """Home edge measured directly from the seasons in `years` (never from a held-out season), or None to fit it.

    NFL: mean closing line on non-neutral games over the last five of them (market_nfl.json).
    NBA, NHL: mean home margin on non-neutral games over the last three. With balanced home and away
    schedules team strength cancels out, so this is the home edge itself, measured on 3,700+ games
    (standard error about 0.2 points in the NBA) instead of inferred from win/loss log loss, and it tracks
    the drop since the late 2010s that a 12-season fit would average away."""
    if L.lg == "nfl":
        mh = market_hfa(L, years)
        return {"hfa": mh[0], "divHfa": mh[0], "how": f"mean closing line, {mh[1]} non-neutral games, {years[-5]}-{years[-1]}"} if mh else None
    if L.lg in BALANCED:
        recent = years[-3:]
        m = np.concatenate([L.seasons[y].m[~L.seasons[y].n] for y in recent])
        return {"hfa": round(float(m.mean()), 3), "how": f"mean home margin, {len(m)} non-neutral games, {recent[0]}-{recent[-1]}"}
    return None


def market_hfa(L, years):
    """NFL home edge from closing lines: mean home line on non-neutral games over the last five of `years`."""
    mk = (read("history/market_nfl.json") or {}).get("spread") or {}
    if not mk:
        return None
    vals = []
    hist = history.load(L.lg)
    for y in years[-5:]:
        for g in hist.get(y, []):
            if g["n"]:
                continue
            v = mk.get(f"{g['d'][:10]}|{g['h']}|{g['a']}")
            if v is None:
                from datetime import date, timedelta
                d = (date.fromisoformat(g["d"][:10]) - timedelta(days=1)).isoformat()
                v = mk.get(f"{d}|{g['h']}|{g['a']}")
            if v is not None:
                vals.append(v)
    return (round(float(np.mean(vals)), 2), len(vals)) if len(vals) > 500 else None


def market_check(L, years, p):
    """NFL only: the model's walk-forward projections next to the closing lines on the same games."""
    mk = (read("history/market_nfl.json") or {}).get("spread") or {}
    if not mk:
        return None
    inv = {i: t for t, i in L.ix.items()}
    from datetime import date, timedelta
    P, U, A = run(L, years, p)
    sp = []
    for y in years:
        S = L.seasons[y]
        for d, h, a in zip(S.d, S.h, S.a):
            v = None
            for dd in (0, -1):
                v = mk.get(f"{(date.fromisoformat(d[:10]) + timedelta(days=dd)).isoformat()}|{inv[h]}|{inv[a]}")
                if v is not None:
                    break
            sp.append(np.nan if v is None else v)
    sp = np.array(sp)
    ok = ~np.isnan(sp)
    if ok.sum() < 200:
        return None
    Pm, Um, Am, Sm = P[ok], U[ok], A[ok], sp[ok]
    s_mod = fit_sigma(Pm, Um, Am, p.get("pv"), p.get("ps"))
    s_mk = float(math.sqrt(np.mean((Am - Sm) ** 2)))
    m_mod = score(Pm, Um, Am, s_mod, p.get("pv"))
    m_mk = score(Sm, np.zeros_like(Sm), Am, s_mk, 0)
    return {"games": int(ok.sum()), "seasons": [min(years), max(years)],
            "model": {k: round(m_mod[k], 4) for k in ("logloss", "brier", "mae", "acc")},
            "market": {k: round(m_mk[k], 4) for k in ("logloss", "brier", "mae", "acc")},
            "gapMean": round(float((Pm - Sm).mean()), 2), "gapSd": round(float((Pm - Sm).std()), 2),
            "slope": round(float(np.polyfit(Pm, Sm, 1)[0]), 3)}


def tune(lg):
    preset = {k: v for k, v in M.PARAMS[lg].items() if k in ("hfa", "divHfa", "k", "cap", "carry", "soft", "hl", "pv", "newp", "rest")}
    preset.setdefault("carry", 0.0)
    preset.setdefault("cap", None)
    from . import ctx
    if ctx.params(lg):
        preset["av"] = ctx.params(lg)      # fitted separately (ctx.job_fit); held fixed here so both use the same results
    L = League(lg)
    covid = COVID.get(lg, set())
    usable = [y for y in L.years if (y - 1) in L.seasons and y not in covid][-WINDOW:]
    if len(usable) < 3:
        return {"adopt": False, "reason": f"needs at least 3 usable seasons with a season before them, have {usable}"}
    folds = usable[-NFOLDS:] if len(usable) >= 6 else usable[-2:]
    rec, diffs, held_p, held_r, hdiffs = [], [], [], [], []
    for hold in folds:
        train = [y for y in usable if y < hold]
        if len(train) < 2:
            continue
        fx = fixed_hfa(L, train) or {}
        fixed = {k: v for k, v in fx.items() if k in ("hfa", "divHfa")}
        fit, _ = search(L, train, dict(preset, **fixed), preset, fixed)
        d = holdout(L, train, [hold], preset)
        f = holdout(L, train, [hold], fit)
        if fixed:      # does the measured home edge alone beat the preset one on this held-out season?
            hdiffs.append(d["ll"] - holdout(L, train, [hold], dict(preset, **fixed))["ll"])
        diff = d["ll"] - f["ll"]
        diffs.append(diff)
        held_p.append(f["p"]); held_r.append(f["res"])
        rec.append({"holdout": hold, "train": [train[0], train[-1]], "fit": fit, "gain": round(float(diff.mean()), 5),
                    "preset": {k: round(d[k], 4) for k in ("logloss", "brier", "mae")}, "fitted": {k: round(f[k], 4) for k in ("logloss", "brier", "mae")}})
    pooled = np.concatenate(diffs)
    gain = float(pooled.mean())
    sd = float(pooled.std(ddof=1)) if len(pooled) > 2 else 0.0
    z = gain / (sd / math.sqrt(len(pooled))) if sd > 0 else 0.0
    pos = sum(1 for r in rec if r["gain"] > 0)
    worst = min(r["gain"] for r in rec)
    consistent = pos * 2 > len(rec)
    adopt = gain >= MIN_GAIN and (z >= MIN_Z or (consistent and z >= MIN_Z_CONSISTENT)) and worst > WORST_FOLD
    final_fit = None
    fx = fixed_hfa(L, usable) or {}
    fixed = {k: v for k, v in fx.items() if k in ("hfa", "divHfa")}
    hcheck = None
    if hdiffs:
        hd = np.concatenate(hdiffs)
        hsd = float(hd.std(ddof=1))
        hcheck = {"gain": round(float(hd.mean()), 5), "z": round(float(hd.mean()) / (hsd / math.sqrt(len(hd))), 2) if hsd > 0 else 0.0}
    # the measured home edge goes live with the preset settings unless it did worse than the preset edge held out
    fixed_live = fixed if (fixed and hcheck and hcheck["gain"] >= 0) else {}
    if adopt:
        final_fit, _ = search(L, usable, dict(rec[-1]["fit"], **fixed), preset, fixed)      # refit on every usable season
    params = final_fit or dict(preset, **fixed_live)
    P, U, A = run(L, usable, params)
    s0 = fit_sigma(P, U, A, params.get("pv"), params.get("ps"))
    sm = margin_sigma(P, U, A, params.get("pv"))
    allm = score(P, U, A, s0, params.get("pv"))
    out = {"adopt": bool(adopt), "params": dict(final_fit, sigma=round(s0, 3), sigmaMargin=round(sm, 3)) if adopt else None, "preset": preset,
           "fixed": (dict(fixed, **{"from": fx["how"], "heldOutVsPreset": hcheck}) if fx else None),
           "fixedLive": fixed_live or None,
           "sigma": round(s0, 3),     # measured spread for whichever settings are live (fitted or preset)
           "sigmaMargin": round(sm, 3),
           "seasons": [usable[0], usable[-1]], "covidExcluded": sorted(covid & set(L.years)), "droppedGames": L.dropped,
           "gain": round(gain, 5), "z": round(z, 2), "games": int(len(pooled)), "foldsImproved": f"{pos}/{len(rec)}",
           "folds": rec, "heldOutCalibration": calibration(np.concatenate(held_p), np.concatenate(held_r)),
           "all": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in allm.items() if k not in ("ll", "p", "res")}}
    if lg == "nfl":
        out["market"] = market_check(L, [y for y in usable if y >= usable[-1] - 9], params)
    if not adopt:
        out["reason"] = (f"held-out gain {gain:.4f} (z {z:.1f}, {pos}/{len(rec)} seasons better, worst {worst:+.4f}) did not clear the bar "
                         f"(gain {MIN_GAIN}, z {MIN_Z}, or z {MIN_Z_CONSISTENT} with most seasons better; no season worse than {WORST_FOLD})")
    return out


def job_tune():
    prev = read("model/tuned.json") or {}
    out = {"updated": now_iso(), "version": 2}
    brief = {}
    for lg in LEAGUES:
        try:
            out[lg] = tune(lg)
        except Exception as e:
            import traceback; traceback.print_exc()
            out[lg] = prev.get(lg) or {"adopt": False, "reason": f"error: {e}"[:160]}
        t = out[lg]
        brief[lg] = {"adopt": t.get("adopt"), "gain": t.get("gain"), "z": t.get("z"), "folds": t.get("foldsImproved"),
                     "params": t.get("params")} if "folds" in t else t.get("reason")
    write("model/tuned.json", out)
    return brief
