"""Fit the house model's settings on past seasons instead of guessing them.

For every league with stored history (history.py) the model is replayed week by week over each past
season: a week's games are projected using only games from earlier weeks, plus a preseason prior of
carry x last season's rating. Settings are chosen to minimise log loss (how well the stated win
probabilities fit what happened).

  searched   k (how many games of average-team weight each rating starts with), carry (how much of last
             season's rating is kept), home edge, and for college the margin cap
  not searched   sigma, which is simply the spread of projection errors (the maximum-likelihood value)

Honesty check: for each of the newest seasons (four when there are eight or more stored, otherwise two) the settings are fit on the seasons before it, then scored on
that season, which they never saw. They are adopted only if they beat the current settings across both by a
clear margin (a paired test, game by game); otherwise the current settings stay. model/tuned.json records both sets of numbers.

The search is coordinate-wise (one setting at a time, two passes) on a coarse grid, so it cannot
overfit much, and every season's contribution is equal-weighted per game."""
import math

import numpy as np

from . import history
from . import model as M
from .common import now_iso, read, write

LEAGUES = ["nfl", "ncaaf", "nhl", "nba", "ncaab", "ncaah"]
MIN_GAIN = 0.0005          # log-loss improvement needed on the held-out season to adopt new settings...
MIN_Z = 1.5                # ...and it must be at least this many standard errors (paired, game by game)
GRID = {
    "k": [0.4, 0.7, 1.0, 1.6, 2.5, 4.0, 6.0, 10.0],  # multiples of the current k
    "carry": [0.0, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 1.0],
    "hfa": [0.5, 0.75, 1.0, 1.25, 1.5],             # multiples of the current home edge
    "cap": {"nfl": [14, 21, 28, None], "ncaaf": [21, 28, 35, 45, None], "ncaab": [25, 30, 40, 60, None]},
}


class Season:
    """One stored season turned into arrays, indexed over a shared team list."""

    def __init__(self, games, ix, norm, same_group):
        games = sorted(games, key=lambda g: g["d"])
        self.h = np.array([ix[norm(g["h"])] for g in games])
        self.a = np.array([ix[norm(g["a"])] for g in games])
        self.m = np.array([g["hs"] - g["as"] for g in games], float)
        self.n = np.array([g["n"] for g in games], bool)
        self.same = np.array([same_group(g["h"], g["a"]) for g in games], bool)
        d0 = datetime_ord(games[0]["d"])
        wk = [g.get("wk") for g in games]
        if all(w is not None for w in wk):
            self.week = np.array(wk, int)
        else:
            self.week = np.array([(datetime_ord(g["d"]) - d0) // 7 for g in games], int)
        keep = self.h != self.a
        for f in ("h", "a", "m", "n", "same", "week"):
            setattr(self, f, getattr(self, f)[keep])


def datetime_ord(d):
    from datetime import date
    return date(int(d[:4]), int(d[5:7]), int(d[8:10])).toordinal()


def _hfa_vec(S, hfa, div):
    h = np.full(len(S.m), float(hfa))
    if div is not None:
        h[S.same] = div
    h[S.n] = 0.0
    return h


def _solve(deg, adj, b, lam, prior):
    A = adj.copy()
    A[np.diag_indices_from(A)] += deg + lam
    return np.linalg.solve(A, b + lam * prior)


def _lam(n, k, pool):
    lam = np.full(n, float(k))
    if pool is not None:
        lam[pool] = max(k, 50)
    return lam


def final_rating(S, n, k, cap, hfa, div, pool):
    y = np.clip(S.m, -cap, cap) if cap else S.m
    y = y - _hfa_vec(S, hfa, div)
    deg = np.bincount(S.h, minlength=n) + np.bincount(S.a, minlength=n)
    b = np.bincount(S.h, y, n) - np.bincount(S.a, y, n)
    adj = np.zeros((n, n))
    np.add.at(adj, (S.h, S.a), -1.0)
    np.add.at(adj, (S.a, S.h), -1.0)
    seen = deg > 0
    R = _solve(deg.astype(float), adj, b, _lam(n, k, pool), np.zeros(n))
    return R, seen


def replay(S, n, p, prior, pool):
    """Walk-forward projections for one season. Returns (home margin projection, actual margin, neutral)."""
    k, cap, hfa, div = p["k"], p["cap"], p["hfa"], p.get("divHfa")
    y_all = np.clip(S.m, -cap, cap) if cap else S.m
    hv = _hfa_vec(S, hfa, div)
    y_all = y_all - hv
    lam = _lam(n, k, pool)
    deg = np.zeros(n); b = np.zeros(n); adj = np.zeros((n, n))
    proj = np.zeros(len(S.m))
    for wk in np.unique(S.week):
        idx = np.nonzero(S.week == wk)[0]
        R = _solve(deg, adj, b, lam, prior)
        proj[idx] = R[S.h[idx]] - R[S.a[idx]] + hv[idx]
        h, a, y = S.h[idx], S.a[idx], y_all[idx]
        deg += np.bincount(h, minlength=n) + np.bincount(a, minlength=n)
        b += np.bincount(h, y, n) - np.bincount(a, y, n)
        np.add.at(adj, (h, a), -1.0)
        np.add.at(adj, (a, h), -1.0)
    return proj


def metrics(proj, actual, sigma=None):
    """sigma defaults to the spread of these errors; pass a sigma fit elsewhere to score honestly out of sample."""
    err = actual - proj
    sigma = sigma or float(math.sqrt(np.mean(err ** 2)))
    p = 0.5 * (1 + np.vectorize(math.erf)(proj / sigma / math.sqrt(2)))
    p = np.clip(p, 1e-4, 1 - 1e-4)
    res = np.where(actual > 0, 1.0, np.where(actual < 0, 0.0, 0.5))
    ll = -(res * np.log(p) + (1 - res) * np.log(1 - p))
    dec = actual != 0
    hits = ((p >= 0.5) == (res == 1.0))[dec]
    home = res.mean()
    return {"ll": ll, "n": int(len(actual)), "sigma": round(sigma, 3), "logloss": float(ll.mean()),
            "brier": float(((p - res) ** 2).mean()), "acc": float(hits.mean()) if dec.any() else None,
            "homeBrier": float(((home - res) ** 2).mean()), "mae": float(np.abs(err).mean())}


def evaluate(seasons, years, n, p, pool, sigma=None):
    """Pooled metrics over `years`, each using last season's ratings as its prior."""
    projs, acts = [], []
    for y in years:
        prior = np.zeros(n)
        if p["carry"]:
            R, seen = final_rating(seasons[y - 1], n, p["k"], p["cap"], p["hfa"], p.get("divHfa"), pool)
            prior = np.where(seen, p["carry"] * R, 0.0)
        projs.append(replay(seasons[y], n, p, prior, pool))
        acts.append(seasons[y].m)
    return metrics(np.concatenate(projs), np.concatenate(acts), sigma)


def search(seasons, years, n, start, ref_params, pool, lg):
    """Coordinate search from `start`; grids are always multiples of the league's original settings."""
    p = dict(start)
    best = evaluate(seasons, years, n, p, pool)["logloss"]
    ref = {"k": ref_params["k"], "hfa": ref_params["hfa"], "divHfa": ref_params.get("divHfa")}
    for _ in range(2):
        moved = False
        cands = [("k", [ref["k"] * f for f in GRID["k"]]), ("carry", GRID["carry"]),
                 ("hfa", [ref["hfa"] * f for f in GRID["hfa"]])]
        if lg in GRID["cap"]:
            cands.append(("cap", GRID["cap"][lg]))
        for name, vals in cands:
            for v in vals:
                q = dict(p)
                q[name] = round(v, 3) if isinstance(v, float) else v
                if name == "hfa" and ref["divHfa"] is not None:
                    q["divHfa"] = round(ref["divHfa"] * v / ref["hfa"], 3)
                if q == p:
                    continue
                ll = evaluate(seasons, years, n, q, pool)["logloss"]
                if ll < best - 1e-6:
                    best, p, moved = ll, q, True
        if not moved:
            break
    return p, best


def tune(lg):
    base = {k: v for k, v in M.PARAMS[lg].items() if k in ("hfa", "divHfa", "k", "cap", "carry")}
    base.setdefault("carry", 0.0)
    hist = history.load(lg)
    years = sorted(hist)
    # seasons must be consecutive so "last season" really is the season before
    years = [y for y in years if y - 1 in hist]
    if len(years) < 2:
        return {"adopt": False, "reason": f"needs at least 3 consecutive stored seasons, have {sorted(hist)}"}
    smap = M._standings_map(lg)
    members = set(M._members(lg))
    group, _, norm = M.context(lg, smap, members)
    ids = sorted(members | {M.POOL})
    ix = {t: i for i, t in enumerate(ids)}
    pool = ix[M.POOL]
    same = (lambda h, a: bool(group.get(h)) and group.get(h) == group.get(a)) if base.get("divHfa") is not None else (lambda h, a: False)
    seasons = {y: Season(g, ix, norm, same) for y, g in hist.items()}
    n = len(ids)
    default = dict(base)
    # Rolling check: for each of the newest two seasons, fit on the seasons before it and score it. The
    # sigma used on the held-out season is the one measured on the training seasons, as it would be live.
    # more history means more folds, which is what lets a small effect show up in a league with few games
    folds = years[-4:] if len(years) >= 8 else years[-2:] if len(years) >= 4 else years[-1:]
    diffs, rec = [], []
    for hold in folds:
        train = [y for y in years if y < hold]
        fit, _ = search(seasons, train, n, default, default, pool, lg)
        d_train = evaluate(seasons, train, n, default, pool)
        f_train = evaluate(seasons, train, n, fit, pool)
        d_hold = evaluate(seasons, [hold], n, default, pool, d_train["sigma"])
        f_hold = evaluate(seasons, [hold], n, fit, pool, f_train["sigma"])
        diff = d_hold["ll"] - f_hold["ll"]
        diffs.append(diff)
        for m in (d_train, f_train, d_hold, f_hold):
            m.pop("ll", None)
        rec.append({"holdout": hold, "train": train, "fit": fit, "gain": round(float(diff.mean()), 5),
                    "default_train": d_train, "fit_train": f_train, "default_holdout": d_hold, "fit_holdout": f_hold})
    pooled = np.concatenate(diffs)
    gain = float(pooled.mean())
    sd = float(pooled.std(ddof=1)) if len(pooled) > 2 else 0.0
    z = gain / (sd / math.sqrt(len(pooled))) if sd > 0 else 0.0
    last = rec[-1]
    fit = last["fit"]
    adopt = gain >= MIN_GAIN and z >= MIN_Z and rec[-1]["gain"] > 0 and fit != default
    params = dict(fit)
    if adopt:
        # refit on every season now that the check passed
        params, _ = search(seasons, years, n, fit, default, pool, lg)
    allm = evaluate(seasons, years, n, params, pool)
    sigma = allm["sigma"]
    allm.pop("ll", None)
    out = {"adopt": bool(adopt), "params": dict(params, sigma=sigma) if adopt else None, "default": default, "fit": fit,
           "holdout": last["holdout"], "train": last["train"], "gain": round(gain, 5), "z": round(z, 2), "games": int(len(pooled)),
           "folds": [{"holdout": r["holdout"], "gain": r["gain"], "fit": r["fit"]} for r in rec],
           "metrics": {"default_train": last["default_train"], "fit_train": last["fit_train"], "default_holdout": last["default_holdout"],
                       "fit_holdout": last["fit_holdout"], "final_all": allm}}
    if not adopt:
        out["reason"] = (f"the best fit did not beat the current settings clearly enough on held-out seasons (gain {gain:.4f}, z {z:.1f} "
                         f"over {len(pooled)} games; needs {MIN_GAIN} and z {MIN_Z})" if fit != default else "current settings were already the best on the grid")
    return out


def job_tune():
    prev = read("model/tuned.json") or {}
    out = {"updated": now_iso()}
    brief = {}
    for lg in LEAGUES:
        try:
            out[lg] = tune(lg)
        except Exception as e:
            import traceback; traceback.print_exc()
            out[lg] = prev.get(lg) or {"adopt": False, "reason": f"error: {e}"[:160]}
        t = out[lg]
        m = t.get("metrics", {})
        brief[lg] = ({"adopt": t["adopt"], "gain": t.get("gain"), "z": t.get("z"), "fit": t.get("fit"),
                      "holdout_ll": [round(m["default_holdout"]["logloss"], 4), round(m["fit_holdout"]["logloss"], 4)]}
                     if m else t.get("reason"))
    write("model/tuned.json", out)
    return brief
