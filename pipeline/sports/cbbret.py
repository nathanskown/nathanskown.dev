"""College basketball roster turnover: who came back, who left, who transferred in.

Last season's rating says how good a team was; with the transfer portal, half of a college roster can be new.
Each player's value from last season is his total game score above a replacement level (R_REP per minute) per team
game, from the lab box scores (data/sports/lab/ncaab_{year}.json, ESPN). A team's turnover feature is

    value of this season's roster (wherever they played last season) - value its own roster produced last season

and the preseason rating moves by GAMMA x that (fitted walk-forward by job_fit, model/ret.json). This season's roster
is everyone who has played for the team so far, plus ESPN's roster page until the team has played MIN_GAMES games."""
import collections
import math

import numpy as np

from .common import ESPN, get, now_iso, read, write
from .leagues import path

LG = "ncaab"
R_REP = 0.15
MIN_GAMES = 3
GAMMAS = [0.0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4]
_cache = {}


def _stats(year):
    if ("s", year) in _cache:
        return _cache[("s", year)]
    pm = collections.defaultdict(lambda: [0.0, 0.0])
    tg = collections.Counter()
    for g in ((read(f"lab/{LG}_{year}.json") or {}).get("g") or {}).values():
        for t, rows in (g.get("pl") or {}).items():
            tg[t] += 1
            for r in rows:
                if len(r) < 17 or not r[2]:
                    continue
                pts = r[3] or 0.0
                fgm, fga, ftm, fta, orb, drb, ast, stl, blk, to, pf = [x or 0.0 for x in r[6:17]]
                gs = pts + 0.4 * fgm - 0.7 * fga - 0.4 * (fta - ftm) + 0.7 * orb + 0.3 * drb + stl + 0.7 * ast + 0.7 * blk - 0.4 * pf - to
                s = pm[(t, r[0])]
                s[0] += r[2]; s[1] += gs
    _cache[("s", year)] = (pm, tg)
    return pm, tg


def _values(year):
    pm, tg = _stats(year)
    val, team = collections.defaultdict(float), collections.defaultdict(float)
    for (t, p), (mn, gs) in pm.items():
        v = (gs - R_REP * mn) / max(tg[t], 1)
        val[p] += v
        team[t] += v
    return val, team


def _roster(year):
    pm, tg = _stats(year)
    ro = collections.defaultdict(set)
    for (t, p) in pm:
        ro[t].add(p)
    extra = read(f"history/{LG}_rosters.json") or {}
    if extra.get("year") == year:
        for t, ids in (extra.get("teams") or {}).items():
            if tg[t] < MIN_GAMES:
                ro[t].update(ids)
    return ro


def feature(year):
    """{team id: turnover value} for `year` (0 for teams without data); {} when last season's box scores are missing."""
    if ("f", year) in _cache:
        return _cache[("f", year)]
    if not (read(f"lab/{LG}_{year - 1}.json") or {}).get("g"):
        return {}
    val, team = _values(year - 1)
    ro = _roster(year)
    # only teams whose roster is known: an unknown roster must not read as everyone having left
    out = {t: sum(val.get(p, 0.0) for p in ro[t]) - team.get(t, 0.0) for t in ro if ro[t]}
    _cache[("f", year)] = out
    return out


def gamma():
    r = read("model/ret.json") or {}
    return r.get("gamma") if r.get("adopt") else None


def job_rosters():
    """ESPN roster pages for every Division I team that has not yet played MIN_GAMES games this season."""
    from . import model as M
    year = (read(f"model/{LG}.json") or {}).get("season")
    if not year:
        raise RuntimeError("no college basketball season in the model file")
    _, tg = _stats(year)
    store = read(f"history/{LG}_rosters.json") or {}
    if store.get("year") != year:
        store = {"year": year, "teams": {}}
    todo = [t for t in M._members(LG) if tg[t] < MIN_GAMES]
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
    return {"year": year, "fetched": got, "failed": fail, "teams": len(store["teams"])}


def job_fit():
    """Walk-forward check of GAMMA on every season with last season's box scores, with the live settings."""
    from . import tune as T
    from . import model as M
    live = M.get_params(LG)
    p = {k: v for k, v in live.items() if k in ("hfa", "k", "cap", "carry", "soft", "hl", "pv", "newp", "rest", "ps")}
    L = T.League(LG)
    cur = (read(f"model/{LG}.json") or {}).get("season") or 9999
    years = [y for y in L.years if (y - 1) in L.seasons and feature(y) and y < cur]
    if len(years) < 3:
        out = {"adopt": False, "reason": f"needs 3 seasons with box scores the season before (have {years})", "updated": now_iso()}
        write("model/ret.json", out)
        return out
    runs = {}
    for gm in GAMMAS:
        q = dict(p, ret=gm)
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
           "foldsImproved": f"{better}/{len(folds)}", "seasons": [years[0], years[-1]], "replacementPerMinute": R_REP,
           "inSample": {str(g): round(float(ll(g, years)[0].mean()), 5) for g in GAMMAS}, "updated": now_iso()}
    write("model/ret.json", out)
    return {k: out[k] for k in ("adopt", "gamma", "gain", "z", "foldsImproved")}
