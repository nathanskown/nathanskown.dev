"""A FiveThirtyEight-style Elo rating run beside the house ratings, and blended into win probabilities.

Elo updates after every game: each team's rating moves by K x a margin-of-victory multiplier x (result - expected),
with the multiplier ln(|margin| + 1) x 2.2 / (0.001 x |Elo gap| + 2.2) in the point-scored sports (which damps runaway
favourites) and max(1, 1.5 ln(|margin| + 1)) in hockey. Ratings regress toward 1500 by REV between seasons.

Elo reacts to the latest results differently from the ridge ratings, so the two make different mistakes, and an
average of their win probabilities beats either. The blend weight w is fitted walk-forward on past seasons against
the live house model (job_fit, model/elo.json) and goes live only if it clears the gate:
    P(home) = (1 - w) x P_house + w x 1 / (1 + 10^(-(Elo_home - Elo_away + HFA) / 400))"""
import math

import numpy as np

from .common import now_iso, read, write

CONF = {"nfl": dict(K=20, hfa=48, rev=1 / 3, mov="log"), "nba": dict(K=20, hfa=100, rev=0.25, mov="log"),
        "nhl": dict(K=6, hfa=30, rev=0.3, mov="hockey"), "ncaab": dict(K=38, hfa=110, rev=0.4, mov="log"),
        "ncaaf": dict(K=30, hfa=80, rev=0.4, mov="log")}
WEIGHTS = [0.0, 0.1, 0.15, 0.2, 0.25, 0.3]
GATE = {"gain": 0.0005, "z": 2.0}


def _mult(c, margin, gap):
    if c["mov"] == "hockey":
        return max(1.0, 1.5 * math.log(abs(margin) + 1))
    return math.log(abs(margin) + 1) * 2.2 / (abs(gap) * 0.001 + 2.2)


def step(elo, c, h, a, margin, neutral):
    """Expected home win probability before the game, and update `elo` (a dict or array) in place."""
    gap = elo[h] - elo[a] + (0 if neutral else c["hfa"])
    p = 1.0 / (1.0 + 10 ** (-gap / 400))
    r = 1.0 if margin > 0 else 0.0 if margin < 0 else 0.5
    d = c["K"] * _mult(c, margin, gap) * (r - p)
    elo[h] += d
    elo[a] -= d
    return p


def prob(c, eh, ea, neutral):
    return 1.0 / (1.0 + 10 ** (-((eh - ea) + (0 if neutral else c["hfa"])) / 400))


def params(lg):
    e = (read("model/elo.json") or {}).get(lg) or {}
    return e.get("w") if e.get("adopt") else None


def current(lg, played, norm_id):
    """Elo for every team now: all stored past seasons in order, then this season's finished games."""
    from . import history, model as M
    c = CONF[lg]
    elo = {}
    get = lambda t: elo.setdefault(t, 1500.0)
    for y, games in sorted(history.load(lg).items()):
        for t in elo:
            elo[t] = 1500 + (elo[t] - 1500) * (1 - c["rev"])
        for g in sorted(games, key=lambda g: g["d"]):
            h, a = norm_id(M.alias(lg, g["h"])), norm_id(M.alias(lg, g["a"]))
            if h == a:
                continue
            get(h); get(a)
            step(elo, c, h, a, g["hs"] - g["as"], bool(g["n"]))
    for t in elo:
        elo[t] = 1500 + (elo[t] - 1500) * (1 - c["rev"])
    for g in sorted(played, key=lambda g: g["d"]):
        h, a = norm_id(g["h"]), norm_id(g["a"])
        if h == a:
            continue
        get(h); get(a)
        step(elo, c, h, a, g["hs"] - g["as"], bool(g["n"]))
    return {t: round(v, 1) for t, v in elo.items()}


def job_fit():
    """Walk-forward weight for each league, scored against the live house model on the newest ten seasons."""
    from . import tune as T
    from . import model as M
    out = {}
    for lg, c in CONF.items():
        P = M.get_params(lg)
        p = {k: v for k, v in P.items() if k in ("hfa", "divHfa", "k", "cap", "carry", "soft", "hl", "pv", "newp", "rest",
                                                    "xg", "sp", "ps", "av", "ret", "rp", "c2", "c3")}
        L = T.League(lg)
        covid = T.COVID.get(lg, set())
        cur = (read(f"model/{lg}.json") or {}).get("season") or 9999
        yrs = [y for y in L.years if (y - 1) in L.seasons and y not in covid and y < cur][-10:]
        elo = np.full(L.n, 1500.0)
        recs = {}
        for y in L.years:
            S = L.seasons[y]
            elo = 1500 + (elo - 1500) * (1 - c["rev"])
            pe = np.array([step(elo, c, S.h[i], S.a[i], S.m[i], S.n[i]) for i in range(len(S.m))])
            if y in yrs:
                pr, u = T.replay(L, S, p, T.prior_for(L, y, p))
                ph = T.probs(pr, u, P["sigma"], p.get("pv"))
                recs[y] = (ph, pe, np.where(S.m > 0, 1.0, np.where(S.m < 0, 0.0, 0.5)))

        def ll(w, ys):
            q = np.concatenate([(1 - w) * recs[y][0] + w * recs[y][1] for y in ys])
            r = np.concatenate([recs[y][2] for y in ys])
            q = np.clip(q, 1e-4, 1 - 1e-4)
            return -(r * np.log(q) + (1 - r) * np.log(1 - q))
        folds, diffs = [], []
        for ty in yrs[2:]:
            tr = [y for y in yrs if y < ty]
            w = min(WEIGHTS, key=lambda w: ll(w, tr).mean())
            d = ll(0.0, [ty]) - ll(w, [ty])
            diffs.append(d)
            folds.append({"holdout": ty, "w": w, "gain": round(float(d.mean()), 5)})
        d = np.concatenate(diffs)
        gain = float(d.mean()); z = float(gain / (d.std(ddof=1) / math.sqrt(len(d)))) if d.std() > 0 else 0.0
        w = min(WEIGHTS, key=lambda w: ll(w, yrs).mean())
        better = sum(1 for f in folds if f["gain"] > 0)
        # z >= 2 with all but one season better, z >= 1 with 80% better, or z >= 3 with 70% better
        adopt = w > 0 and gain >= GATE["gain"] and (z >= GATE["z"] and better >= len(folds) - 1 or z >= 1.0 and better >= 0.8 * len(folds)
                                                     or z >= 3.0 and better >= 0.7 * len(folds))
        out[lg] = {"adopt": bool(adopt), "w": w, "gain": round(gain, 5), "z": round(z, 2), "folds": folds,
                   "foldsImproved": f"{better}/{len(folds)}", "seasons": [yrs[0], yrs[-1]], "conf": c, "updated": now_iso()}
    write("model/elo.json", out)
    return {lg: {k: v[k] for k in ("adopt", "w", "gain", "z", "foldsImproved")} for lg, v in out.items()}
