"""Closing lines for NBA, NHL, college basketball and college football, gathered from the lab files (ESPN summaries'
pickcenter, filled in from ESPN's core odds endpoint where the summaries had none) into history/market_{lg}.json, in the
same shape as the NFL's nflverse file. Used only to grade the house model against the market; never shown on the site
and never fed into a forecast.

  {"spread": {"date|home|away": home margin the market expects}, "total": {...}, "p": {...: no-vig home win chance}}
"""
from .common import now_iso, read, write
from .lab import SEASONS

LGS = ("nba", "nhl", "ncaab", "ncaaf")


def _novig(ml):
    try:
        h, a = (float(x) for x in ml)
    except (TypeError, ValueError):
        return None
    imp = lambda o: 100 / (o + 100) if o > 0 else -o / (-o + 100)
    ph, pa = imp(h), imp(a)
    return round(ph / (ph + pa), 4) if ph + pa > 0 else None


def build(lg):
    sp, tot, p = {}, {}, {}
    for y in SEASONS.get(lg, []):
        for r in ((read(f"lab/{lg}_{y}.json") or {}).get("g") or {}).values():
            k = f"{r['d'][:10]}|{r['h']}|{r['a']}"
            if r.get("sp") is not None and lg != "nhl":     # NHL "spread" is the puck line, not an expected margin
                sp[k] = float(r["sp"])
            if r.get("tot") is not None:
                tot[k] = float(r["tot"])
            v = _novig(r.get("ml"))
            if v is not None:
                p[k] = v
    write(f"history/market_{lg}.json", {"about": "Closing lines (home margin the market expects, total, no-vig home win chance). "
                                                 "Used only to grade the house model; never shown on the site.",
                                        "source": "ESPN pickcenter and core odds", "updated": now_iso(), "spread": sp, "total": tot, "p": p})
    return {"spread": len(sp), "total": len(tot), "p": len(p)}


def job_build():
    return {lg: build(lg) for lg in LGS}
