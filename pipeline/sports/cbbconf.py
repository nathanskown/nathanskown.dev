"""College basketball conference strength in the preseason rating.

Early in the season the house rating is last season's rating plus roster turnover (cbbret.py), and a few games say
little. Teams in strong conferences start better than their own rating alone suggests (and low-major teams worse):
recruiting, coaching and schedules all follow the conference. So the preseason rating also moves by
CM x (mean of last season's ratings across the team's conference), in points.

A team's conference for a past season is found from that season's January and February games (conference play), so
realignment is followed; the current season uses ESPN's standings groups. CM is fitted walk-forward by job_fit
(model/cbbconf.json) with the live settings, roster turnover included, and goes live only if it beats the model
without it on held-out seasons.

First check (Nov 2026, 2015-26 held out, COVID season skipped): better in every season at CM 0.3 (log loss -0.0001 to
-0.002); best 0.4-0.5, with less to gain since 2024, when box-score roster turnover entered the prior."""
import collections
import math

import numpy as np

from .common import now_iso, read, write

LG = "ncaab"
CMS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7]
MIN_TEAMS = 4
_cache = {}


def param():
    r = read("model/cbbconf.json") or {}
    return r.get("cm") if r.get("adopt") else None


def labels(L, y, current):
    """{team index: conference label} for season y of a tune.League: start from today's conferences, then let each team
    take the most common label among its January-February opponents until nothing changes."""
    if ("lab", y) in _cache:
        return _cache[("lab", y)]
    S = L.seasons[y]
    nb = collections.defaultdict(list)
    for d, h, a in zip(S.d, S.h, S.a):
        if d[5:7] in ("01", "02") and h != L.pool and a != L.pool:
            nb[h].append(a)
            nb[a].append(h)
    lab = {i: current.get(t) or f"_{i}" for t, i in L.ix.items()}
    for _ in range(8):
        new = {i: (collections.Counter(lab[j] for j in nb[i]).most_common(1)[0][0] if nb.get(i) else lab[i]) for i in lab}
        if new == lab:
            break
        lab = new
    _cache[("lab", y)] = lab
    return lab


def conf_means(rating, group):
    """{label: mean rating} over conferences with at least MIN_TEAMS rated teams."""
    g = collections.defaultdict(list)
    for t, r in rating.items():
        if group.get(t):
            g[group[t]].append(r)
    return {k: float(np.mean(v)) for k, v in g.items() if len(v) >= MIN_TEAMS}


def tune_feature(L, y, R1, seen):
    """Array over the League's teams: mean of last season's ratings (R1) across each team's conference in season y."""
    from . import model as M
    smap = M._standings_map(LG)
    cur = {t: smap.get(t, {}).get("group") for t in L.ix}
    lab = labels(L, y, cur)
    cm = conf_means({i: R1[i] for i in range(L.n) if seen[i] and i != L.pool}, lab)
    out = np.array([cm.get(lab[i], 0.0) for i in range(L.n)])
    out[L.pool] = 0.0
    return out


def live_feature(R1, members, smap):
    """{team: mean of last season's ratings across its current conference} for the live season prior."""
    group = {t: smap.get(t, {}).get("group") for t in members}
    cm = conf_means({t: r for t, r in R1.items() if t in members}, group)
    return {t: cm[group[t]] for t in members if group.get(t) in cm}


def job_fit():
    """Walk-forward check of CM on every stored season, with the live settings."""
    from . import tune as T
    from . import model as M
    live = M.get_params(LG)
    p = {k: v for k, v in live.items() if k in ("hfa", "k", "cap", "carry", "soft", "hl", "pv", "newp", "rest", "ps", "c2", "c3", "ret")}
    L = T.League(LG)
    cur = (read(f"model/{LG}.json") or {}).get("season") or 9999
    years = [y for y in L.years if (y - 1) in L.seasons and y < cur and y not in T.COVID.get(LG, set())]
    if len(years) < 4 or not p.get("carry"):
        out = {"adopt": False, "reason": f"needs 4 seasons and a carried prior (have {years})", "updated": now_iso()}
        write("model/cbbconf.json", out)
        return out
    runs = {}
    for c in CMS:
        q = dict(p, cm=c)
        runs[c] = {y: T.replay(L, L.seasons[y], q, T.prior_for(L, y, q)) + (L.seasons[y].m,) for y in years}

    def ll(c, ys, s0=None):
        P = np.concatenate([runs[c][y][0] for y in ys]); U = np.concatenate([runs[c][y][1] for y in ys])
        A = np.concatenate([runs[c][y][2] for y in ys])
        s0 = s0 or T.fit_sigma(P, U, A, p.get("pv"), p.get("ps"))
        return T.score(P, U, A, s0, p.get("pv"))["ll"], s0

    def early(c, y):
        S = L.seasons[y]
        P, A = runs[c][y][0], runs[c][y][2]
        k = np.array([d <= S.d[0][:4] + "-12-15" for d in S.d])
        return float(np.abs(A[k] - P[k]).mean())
    folds, diffs = [], []
    for ty in years[2:]:
        tr = [y for y in years if y < ty]
        best = min(CMS, key=lambda c: ll(c, tr)[0].mean())
        b = ll(0.0, [ty], ll(0.0, tr)[1])[0]
        n = ll(best, [ty], ll(best, tr)[1])[0]
        diffs.append(b - n)
        folds.append({"holdout": ty, "cm": best, "gain": round(float((b - n).mean()), 5),
                      "earlyMae": [round(early(0.0, ty), 3), round(early(best, ty), 3)]})
    d = np.concatenate(diffs)
    gain = float(d.mean()); z = float(gain / (d.std(ddof=1) / math.sqrt(len(d)))) if d.std() > 0 else 0.0
    cm = min(CMS, key=lambda c: ll(c, years)[0].mean())
    better = sum(1 for f in folds if f["gain"] > 0)
    adopt = cm > 0 and gain >= 0.001 and z >= 1.5 and better >= len(folds) - 1
    out = {"adopt": bool(adopt), "cm": cm, "gain": round(gain, 5), "z": round(z, 2), "folds": folds,
           "foldsImproved": f"{better}/{len(folds)}", "seasons": [years[0], years[-1]],
           "inSample": {str(c): round(float(ll(c, years)[0].mean()), 5) for c in CMS}, "updated": now_iso()}
    write("model/cbbconf.json", out)
    return {k: out[k] for k in ("adopt", "cm", "gain", "z", "foldsImproved")}
