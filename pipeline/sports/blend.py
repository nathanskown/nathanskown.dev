"""Game forecasts that lean on the betting market without publishing it.

The house ratings come only from past scores, so they cannot see quarterback changes, injuries or rest
decisions. The betting consensus can, and on 2,895 NFL games (2014-2025) the market's closing line beat the
house model (log loss 0.614 vs 0.635); when the two disagreed, the market was right (the model-minus-market
gap had no correlation with the result). So for a game that has a consensus line, the forecast is

    margin = w x house + (1 - w) x market          (home margin; w = weight on the house model)

How it reaches the site: only the *adjustment* is written, as `mkEdges` in data/sports/model/{lg}.json, keyed
"start|home|away" exactly like the MLB pitcher edges, and the page code adds it to the house margin. No line
or price is written to anything under the site; the odds files stay excluded from it. (The blended number sits
close to the line, so a reader could infer roughly where it is; the site never states or labels it.)

Weight w: NFL 0.15, from the history above (log loss rose steadily with w; 0.15 keeps a little house
signal). Leagues without a long line history start at 0.30 and are re-fitted on this site's own logged picks
once 200 graded games carry both a house and a market number (see weight())."""
import math
from datetime import datetime, timedelta, timezone

from .common import read, write
from . import model as M

DEFAULT_W = 0.30
FIXED_W = {"nfl": 0.15}
MIN_FIT = 200
MARK = " Game forecasts lean on the betting-market consensus where one exists; the house ratings adjust it."


def _norm_inv(p):
    p = min(max(p, 1e-4), 1 - 1e-4)
    lo, hi = -6.0, 6.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if M.phi(mid) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def market(lg, model=None):
    """{"start16|home|away": market home margin} for games on the odds file (internal; never published)."""
    odds = (read(f"odds/{lg}.json") or {}).get("games", {})
    out = {}
    sg = (model or {}).get("sigma") or 13.0
    for g in odds.values():
        if g.get("sp") is not None:
            mk = -float(g["sp"])                      # home spread -3 = home favored by 3
        elif g.get("p") is not None:
            mk = sg * _norm_inv(g["p"])
        else:
            continue
        out[f"{g['c'][:16]}|{g['h']}|{g['a']}"] = mk
    return out


def weight(lg):
    if lg in FIXED_W:
        return FIXED_W[lg]
    rows = [p for p in ((read(f"track/_picks_{lg}.json") or {}).get("picks", {})).values()
            if "hs" in p and "mk" in p and "hm" in p]
    if len(rows) < MIN_FIT:
        return DEFAULT_W
    sg = (read(f"model/{lg}.json") or {}).get("sigma") or 13.0
    best, bw = None, DEFAULT_W
    for w in [i / 20 for i in range(0, 21)]:
        ll = 0.0
        for p in rows:
            m = w * p["hm"] + (1 - w) * p["mk"]
            q = min(max(M.phi(m / sg), 1e-4), 1 - 1e-4)
            r = 1.0 if p["hs"] > p["as"] else (0.0 if p["hs"] < p["as"] else 0.5)
            ll -= r * math.log(q) + (1 - r) * math.log(1 - q)
        if best is None or ll < best:
            best, bw = ll, w
    return bw


def apply(lg):
    """Write mkEdges into the league's model file from the current odds file."""
    from . import track
    model = read(f"model/{lg}.json")
    if not model or not model.get("teams"):
        return None
    base = (model.get("basis") or "").replace(MARK, "")
    model["basis"] = base
    model.pop("mkEdges", None)
    model.pop("mkW", None)
    mk = market(lg, model)
    if not mk:
        write(f"model/{lg}.json", model)
        return {"edges": 0}
    cache = (read(f"model/_games_{lg}.json") or {}).get("events", {})
    neutral = {f"{g['d'][:16]}|{M.alias(lg, g['h'])}|{M.alias(lg, g['a'])}": g.get("n") for g in cache.values()}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M")
    w, edges = weight(lg), {}
    for key, m_mk in mk.items():
        start, h, a = key.split("|")
        if start < cutoff:
            continue
        pr = track.project(model, h, a, bool(neutral.get(key)), start)
        if pr is None:
            continue
        edges[key] = round((1 - w) * (m_mk - pr[0]), 2)
    if edges:
        model["mkEdges"], model["mkW"] = edges, w
        model["basis"] = base + MARK
    write(f"model/{lg}.json", model)
    return {"edges": len(edges), "w": w}


def job_blend():
    out = {}
    for lg in ("nfl", "ncaaf", "nba", "ncaab", "nhl"):
        try:
            out[lg] = apply(lg)
        except Exception as e:
            out[lg] = f"error: {e}"[:120]
    return out
