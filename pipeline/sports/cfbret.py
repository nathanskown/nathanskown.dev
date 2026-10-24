"""College football returning production (the SP+ idea), from the lab box scores (data/sports/lab/ncaaf_{year}.json).

Each player's share of his team's production last season is counted in three groups: passing (yards + 20 x TD
- 45 x INT), rushing and receiving (yards + 20 x TD), and defense (tackles + 2 x sacks + tackles for loss + passes
defended + 3 x interceptions). A team's returning production in a group is the sum of those shares over this
season's roster, wherever the player was last season, so transfers count on both sides as in SP+. The preseason
rating moves by GAMMA x W . (returning - the league average), fitted walk-forward by job_fit (model/cfbret.json).

This season's roster: players who have appeared for the team in its first MIN_GAMES games, plus ESPN's roster page
until then."""
import collections
import math

import numpy as np

from .common import ESPN, get, now_iso, read, write
from .leagues import path

LG = "ncaaf"
W = np.array([2.0, 10.0, 3.0])          # points per unit share returning: passing, rushing+receiving, defense
MIN_GAMES = 4
GAMMAS = [0.0, 0.5, 0.75, 1.0, 1.25, 1.5]
_cache = {}


def _load(y):
    if ("g", y) not in _cache:
        _cache[("g", y)] = (read(f"lab/{LG}_{y}.json") or {}).get("g") or {}
    return _cache[("g", y)]


def _production(y):
    out = collections.defaultdict(lambda: np.zeros(3))
    team = collections.defaultdict(lambda: np.zeros(3))
    for g in _load(y).values():
        for t, rows in (g.get("pl") or {}).items():
            for r in rows:
                v = max((r[3] or 0) + 20 * (r[4] or 0) - 45 * (r[5] or 0), 0)
                out[(t, r[0])][0] += v; team[t][0] += v
        for t, rows in (g.get("px") or {}).items():
            for r in rows:
                if r[0] in ("R", "C"):
                    v = max((r[4] or 0) + 20 * (r[5] or 0), 0); k = 1
                elif r[0] == "D":
                    v = (r[3] or 0) + 2 * (r[4] or 0) + (r[5] or 0) + (r[6] or 0); k = 2
                elif r[0] == "I":
                    v = 3 * (r[3] or 0); k = 2
                else:
                    continue
                out[(t, r[1])][k] += v; team[t][k] += v
    return out, team


def _roster(y):
    ro = collections.defaultdict(set)
    cnt = collections.Counter()
    for g in sorted(_load(y).values(), key=lambda g: g["d"]):
        for t in set(g.get("pl") or {}) | set(g.get("px") or {}):
            cnt[t] += 1
            if cnt[t] > MIN_GAMES:
                continue
            ro[t].update(r[0] for r in (g.get("pl") or {}).get(t, []))
            ro[t].update(r[1] for r in (g.get("px") or {}).get(t, []))
    extra = read(f"history/{LG}_rosters.json") or {}
    if extra.get("year") == y:
        for t, ids in (extra.get("teams") or {}).items():
            if cnt[t] < MIN_GAMES:
                ro[t].update(ids)
    return ro, cnt


def shares(year):
    """{team: [passing, rushing+receiving, defense] share of last season's production on this season's roster}."""
    if ("f", year) in _cache:
        return _cache[("f", year)]
    prod, team = _production(year - 1)
    if not team or not any("px" in g for g in _load(year - 1).values()):
        return {}
    by = collections.defaultdict(lambda: np.zeros(3))
    for (t, pid), v in prod.items():
        by[pid] += np.where(team[t] > 0, v / np.maximum(team[t], 1.0), 0.0)
    ro, _ = _roster(year)
    out = {t: sum((by[p] for p in ids if p in by), np.zeros(3)) for t, ids in ro.items() if t in team and ids}
    _cache[("f", year)] = out
    return out


def feature(year):
    """{team: W . (returning share - average)} in points, before GAMMA."""
    s = shares(year)
    if not s:
        return {}
    mu = (read("model/cfbret.json") or {}).get("mean") or [0.61, 0.58, 0.36]
    return {t: float(np.dot(W, v - np.array(mu))) for t, v in s.items()}


def gamma():
    r = read("model/cfbret.json") or {}
    return r.get("gamma") if r.get("adopt") else None


def job_rosters():
    """ESPN roster pages for FBS teams that have not yet played MIN_GAMES games this season (the preseason)."""
    from . import model as M
    year = (read(f"model/{LG}.json") or {}).get("season")
    if not year:
        raise RuntimeError("no college football season in the model file")
    _, cnt = _roster(year)
    store = read(f"history/{LG}_rosters.json") or {}
    if store.get("year") != year:
        store = {"year": year, "teams": {}}
    todo = [t for t in M._members(LG) if cnt[t] < MIN_GAMES]
    got = fail = 0
    for t in todo:
        try:
            d = get(ESPN + path(LG) + f"/teams/{t}/roster")
        except Exception:
            fail += 1
            continue
        ath = d.get("athletes") or []
        if ath and isinstance(ath[0], dict) and "items" in ath[0]:
            ath = [a for grp in ath for a in grp.get("items", [])]
        ids = sorted({str(a.get("id")) for a in ath if a.get("id")})
        if ids:
            store["teams"][t] = ids
            got += 1
    store["updated"] = now_iso()
    write(f"history/{LG}_rosters.json", store)
    return {"year": year, "fetched": got, "failed": fail, "todo": len(todo)}


def job_fit():
    """Walk-forward check of GAMMA on every season with last season's full box scores, with the live settings."""
    from . import tune as T
    from . import model as M
    live = M.get_params(LG)
    p = {k: v for k, v in live.items() if k in ("hfa", "k", "cap", "carry", "soft", "hl", "pv", "newp", "rest", "ps", "av", "c2", "c3")}
    p.pop("rp", None)
    L = T.League(LG)
    cur = (read(f"model/{LG}.json") or {}).get("season") or 9999
    years = [y for y in L.years if (y - 1) in L.seasons and shares(y) and y < cur and y not in T.COVID.get(LG, set())]
    if len(years) < 3:
        out = {"adopt": False, "reason": f"needs 3 seasons with full box scores the season before (have {years})", "updated": now_iso()}
        write("model/cfbret.json", out)
        return out
    allv = np.array([v for y in years for v in shares(y).values()])
    mu = [round(float(x), 4) for x in allv.mean(0)]
    write("model/cfbret.json", dict(read("model/cfbret.json") or {}, mean=mu))      # feature() reads the mean
    runs = {}
    for gm in GAMMAS:
        q = dict(p, rp=gm)
        runs[gm] = {y: T.replay(L, L.seasons[y], q, T.prior_for(L, y, q)) + (L.seasons[y].m,) for y in years}

    def ll(gm, ys, s0=None):
        P = np.concatenate([runs[gm][y][0] for y in ys]); U = np.concatenate([runs[gm][y][1] for y in ys])
        A = np.concatenate([runs[gm][y][2] for y in ys])
        s0 = s0 or T.fit_sigma(P, U, A, p.get("pv"), p.get("ps"))
        return T.score(P, U, A, s0, p.get("pv"))["ll"], s0
    folds, diffs = [], []
    for ty in years[1:]:
        tr = [y for y in years if y < ty]
        best = min(GAMMAS, key=lambda g: ll(g, tr)[0].mean())
        b = ll(0.0, [ty], ll(0.0, tr)[1])[0]
        n = ll(best, [ty], ll(best, tr)[1])[0]
        diffs.append(b - n)
        folds.append({"holdout": ty, "gamma": best, "gain": round(float((b - n).mean()), 5)})
    d = np.concatenate(diffs)
    gain = float(d.mean()); z = float(gain / (d.std(ddof=1) / math.sqrt(len(d)))) if d.std() > 0 else 0.0
    gm = min(GAMMAS, key=lambda g: ll(g, years)[0].mean())
    better = sum(1 for f in folds if f["gain"] > 0)
    adopt = gm > 0 and gain >= 0.001 and better == len(folds) and z >= 1.0
    out = {"adopt": bool(adopt), "gamma": gm, "gain": round(gain, 5), "z": round(z, 2), "folds": folds,
           "foldsImproved": f"{better}/{len(folds)}", "seasons": [years[0], years[-1]], "mean": mu, "weights": W.tolist(),
           "inSample": {str(g): round(float(ll(g, years)[0].mean()), 5) for g in GAMMAS}, "updated": now_iso()}
    write("model/cfbret.json", out)
    return {k: out[k] for k in ("adopt", "gamma", "gain", "z", "foldsImproved")}
