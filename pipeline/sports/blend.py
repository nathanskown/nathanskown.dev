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


PUCK = {"nhl", "ncaah"}          # hockey "spreads" are the +/-1.5 puck line, not an expected margin
TOL_MIN = 180                   # odds feeds and ESPN list start times a few minutes apart (NBA/NHL ~10 min)


def market(lg, model=None):
    """{(home, away): [(start ISO, market home margin, no-vig home win chance)]} for games on the odds file
    (internal; never published). Matched to a game with lookup(), which allows for start times that differ."""
    odds = (read(f"odds/{lg}.json") or {}).get("games", {})
    out = {}
    sg = (model or {}).get("sigma") or 13.0
    for g in odds.values():
        p = g.get("p")
        if g.get("sp") is not None and lg not in PUCK:
            mk = -float(g["sp"])                      # home spread -3 = home favored by 3
        elif p is not None:
            mk = sg * _norm_inv(p)
        else:
            continue
        if p is None:
            p = M.phi(mk / sg)
        out.setdefault((g["h"], g["a"]), []).append((g["c"], mk, p))
    return out


def lookup(idx, h, a, start, tol_min=TOL_MIN):
    """(margin, win chance) of the market entry for home h vs away a nearest `start`, within tol_min minutes; else None."""
    from datetime import datetime
    t = lambda s: datetime.fromisoformat(s[:16])
    best = None
    for c, mk, p in idx.get((h, a), []):
        gap = abs((t(c) - t(start)).total_seconds()) / 60
        if gap <= tol_min and (best is None or gap < best[0]):
            best = (gap, mk, p)
    return None if best is None else best[1:]


def closing(lg, model=None):
    """{ESPN event id: (closing home margin, no-vig home win chance, closing total)} from this season's lab file
    (ESPN pickcenter, collected daily). Used only to grade picks against the close; never fed into a forecast."""
    year = (model or {}).get("season")
    rows = ((read(f"lab/{lg}_{year}.json") or {}).get("g") or {}) if year else {}
    sg = (model or {}).get("sigma") or 13.0
    out = {}
    for eid, r in rows.items():
        p = _novig_us(r.get("ml"))
        mk = float(r["sp"]) if r.get("sp") is not None and lg not in PUCK else (sg * _norm_inv(p) if p is not None else None)
        if mk is None:
            continue
        out[eid] = (mk, p if p is not None else M.phi(mk / sg), r.get("tot"))
    return out


def _novig_us(ml):
    """No-vig home win chance from American moneylines [home, away]."""
    try:
        h, a = (float(x) for x in ml)
    except (TypeError, ValueError):
        return None
    imp = lambda o: 100 / (o + 100) if o > 0 else -o / (-o + 100)
    ph, pa = imp(h), imp(a)
    return ph / (ph + pa) if ph + pa > 0 else None
