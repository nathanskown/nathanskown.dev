"""Closing lines for NBA, NHL, college basketball and college football, gathered from the lab files (ESPN summaries'
pickcenter, filled in from ESPN's core odds endpoint where the summaries had none) into history/market_{lg}.json, in the
same shape as the NFL's nflverse file. Used only to grade the house model against the market; never shown on the site
and never fed into a forecast.

  {"spread": {"date|home|away": home margin the market expects}, "total": {...}, "p": {...: no-vig home win chance}}
"""
import os
import statistics

from .common import get, now_iso, read, write
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


def cfbd_lines(years=None):
    """College football closing lines from CollegeFootballData (CFBD_KEY; free tier 1,000 calls a month, two per
    season here). Stored per season as history/cfbd_lines_{year}.json {game id: [date, home id, away id, home margin
    the market expects, total, home ml, away ml]}, the median across books. CFBD uses ESPN's game and team ids."""
    key = os.environ.get("CFBD_KEY", "").strip()
    if not key:
        return {"error": "no CFBD_KEY"}
    H = {"Authorization": f"Bearer {key}"}
    cur = (read("model/ncaaf.json") or {}).get("season") or 2026
    out = {}
    for y in years or range(2013, cur + 1):
        if y < cur and (read(f"history/cfbd_lines_{y}.json") or {}).get("complete"):
            continue
        g = {}
        for st in ("regular", "postseason"):
            try:
                rows = get("https://api.collegefootballdata.com/lines", {"year": y, "seasonType": st}, headers=H, timeout=90)
            except Exception as e:
                out[y] = f"error {str(e)[:120]}"
                continue
            for r in rows or []:
                ls = r.get("lines") or []
                med = lambda k: statistics.median([float(x[k]) for x in ls if x.get(k) is not None]) if any(x.get(k) is not None for x in ls) else None
                sp_ = med("spread")
                if sp_ is None and med("overUnder") is None:
                    continue
                g[str(r["id"])] = [(r.get("startDate") or "")[:16], str(r.get("homeTeamId")), str(r.get("awayTeamId")),
                                   None if sp_ is None else -sp_, med("overUnder"), med("homeMoneyline"), med("awayMoneyline")]
        write(f"history/cfbd_lines_{y}.json", {"year": y, "complete": y < cur, "source": "CollegeFootballData", "g": g})
        out[y] = len(g)
    return out


def build(lg):
    sp, tot, p = {}, {}, {}
    if lg == "ncaaf":                                  # CFBD first; the lab's ESPN lines overwrite where both exist
        for y in range(2013, 2040):
            for gid, (d, h, a, s_, t_, mh, ma) in ((read(f"history/cfbd_lines_{y}.json") or {}).get("g") or {}).items():
                k = f"{d[:10]}|{h}|{a}"
                if s_ is not None:
                    sp[k] = float(s_)
                if t_ is not None:
                    tot[k] = float(t_)
                v = _novig([mh, ma])
                if v is not None:
                    p[k] = v
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
