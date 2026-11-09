"""College football roster talent: the 247Sports team talent composite (recruiting rankings of every player on the
roster), from CollegeFootballData (history/cfbd_talent.json, collected by market.cfbd_talent).

Last season's rating and returning production (cfbret.py) say how good a team was and how much of it is back; talent
says how good the replacements are likely to be, which is why preseason betting lines lean on it. The preseason
rating moves by TAL x (team talent - that season's average) / that season's spread, in points per standard deviation.
TAL is fitted walk-forward by job_fit (model/cfbtalent.json) with the live settings, returning production included,
and goes live only if it beats the model without it on held-out seasons. Teams without a talent number (FCS) get 0.

First check (Nov 2026, held out 2017-25): it helped every season through 2023 (log loss -0.003 to -0.007, about 0.2
points less margin miss), but not 2024 or 2025, the transfer-portal seasons where returning production already counts
who moved; 6 of 8 seasons better is short of the bar, so it is not live. Re-tested with every tune run."""
import math

import numpy as np

from .common import now_iso, read, write

LG = "ncaaf"
TALS = [0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0]
_cache = {}


def feature(year):
    """{team: standardised talent} for a season (before TAL); {} when the season has no talent numbers."""
    if year in _cache:
        return _cache[year]
    raw = (read("history/cfbd_talent.json") or {}).get(str(year))
    out = {}
    if isinstance(raw, dict) and len(raw) > 20:
        v = np.array([float(x) for x in raw.values()])
        mu, sd = float(v.mean()), float(v.std()) or 1.0
        out = {t: (float(x) - mu) / sd for t, x in raw.items()}
    _cache[year] = out
    return out


def param():
    r = read("model/cfbtalent.json") or {}
    return r.get("tal") if r.get("adopt") else None


def job_fit():
    """Walk-forward check of TAL on every season with talent numbers, with the live settings."""
    from . import tune as T
    from . import model as M
    live = M.get_params(LG)
    p = {k: v for k, v in live.items() if k in ("hfa", "k", "cap", "carry", "soft", "hl", "pv", "newp", "rest", "ps", "av", "c2", "c3", "rp")}
    L = T.League(LG)
    cur = (read(f"model/{LG}.json") or {}).get("season") or 9999
    years = [y for y in L.years if (y - 1) in L.seasons and feature(y) and y < cur and y not in T.COVID.get(LG, set())]
    if len(years) < 4:
        out = {"adopt": False, "reason": f"needs 4 seasons with talent numbers (have {years})", "updated": now_iso()}
        write("model/cfbtalent.json", out)
        return out
    runs = {}
    for tl in TALS:
        q = dict(p, tal=tl)
        runs[tl] = {y: T.replay(L, L.seasons[y], q, T.prior_for(L, y, q)) + (L.seasons[y].m,) for y in years}

    def ll(tl, ys, s0=None):
        P = np.concatenate([runs[tl][y][0] for y in ys]); U = np.concatenate([runs[tl][y][1] for y in ys])
        A = np.concatenate([runs[tl][y][2] for y in ys])
        s0 = s0 or T.fit_sigma(P, U, A, p.get("pv"), p.get("ps"))
        return T.score(P, U, A, s0, p.get("pv"))["ll"], s0

    def mae(tl, ys):
        P = np.concatenate([runs[tl][y][0] for y in ys]); A = np.concatenate([runs[tl][y][2] for y in ys])
        return float(np.abs(A - P).mean())
    folds, diffs = [], []
    for ty in years[2:]:
        tr = [y for y in years if y < ty]
        best = min(TALS, key=lambda t: ll(t, tr)[0].mean())
        b = ll(0.0, [ty], ll(0.0, tr)[1])[0]
        n = ll(best, [ty], ll(best, tr)[1])[0]
        diffs.append(b - n)
        folds.append({"holdout": ty, "tal": best, "gain": round(float((b - n).mean()), 5),
                      "mae": [round(mae(0.0, [ty]), 3), round(mae(best, [ty]), 3)]})
    d = np.concatenate(diffs)
    gain = float(d.mean()); z = float(gain / (d.std(ddof=1) / math.sqrt(len(d)))) if d.std() > 0 else 0.0
    tl = min(TALS, key=lambda t: ll(t, years)[0].mean())
    better = sum(1 for f in folds if f["gain"] > 0)
    adopt = tl > 0 and gain >= 0.001 and z >= 1.5 and better >= len(folds) - 1
    out = {"adopt": bool(adopt), "tal": tl, "gain": round(gain, 5), "z": round(z, 2), "folds": folds,
           "foldsImproved": f"{better}/{len(folds)}", "seasons": [years[0], years[-1]],
           "inSample": {str(t): round(float(ll(t, years)[0].mean()), 5) for t in TALS}, "updated": now_iso()}
    write("model/cfbtalent.json", out)
    return {k: out[k] for k in ("adopt", "tal", "gain", "z", "foldsImproved")}
