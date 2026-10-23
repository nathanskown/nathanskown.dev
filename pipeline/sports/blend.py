"""Watch the betting market without using it.

The house forecast never takes a number from the market. This module only reads the odds files (which are
kept off the site) so track.py can log, next to each pick, what the market had on the game. After the games
are graded the track record shows house and market side by side, and the gap between them is where the
model's missing information shows up (see data/sports/track/summary.json -> watch, and the diagnostics in the
pull request that introduced this). On 2,895 NFL games (2014-2025) the market beat the house ratings (log loss
0.614 vs 0.635); the gap is mostly information that scores cannot carry, e.g. quarterback changes (+/-1.5 to
1.9 points)."""
import math

from .common import read
from . import model as M


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
