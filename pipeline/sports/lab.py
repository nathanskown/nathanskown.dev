"""The lab: richer per-game data for every league, collected on GitHub's runners (the only place ESPN is reachable
from), so models can be tested against the closing betting lines and against who actually played.

  data/sports/lab/{lg}_{year}.json    {"year", "v", "g": {event id: row}}

One ESPN summary request per game carries the closing line (pickcenter) and the box score, so a season costs one
request per game after a scoreboard crawl for the event ids. Modes (python -m pipeline.sports.run lab):
  probe     save one raw summary and one raw core-API odds record per league to data/sports/lab/_probe/ (to learn the shapes)
"""
import json
import os

from .common import ESPN, get, read, write
from .leagues import LEAGUES, path

CORE = "https://sports.core.api.espn.com/v2/sports/"
PROBE_DATES = {"nfl": "20251116", "ncaaf": "20251115", "nhl": "20260110", "nba": "20260110", "ncaab": "20260110",
               "ncaah": "20260110", "mlb": "20250715"}


def _trim(o, depth=0):
    """Keep a raw record readable: lists longer than 40 items are cut (shape matters, not volume)."""
    if isinstance(o, dict):
        return {k: _trim(v, depth + 1) for k, v in o.items()}
    if isinstance(o, list):
        return [_trim(v, depth + 1) for v in o[:40]]
    return o


def job_probe():
    only = [x for x in os.environ.get("LAB_LG", "").split(",") if x] or list(LEAGUES)
    out = {}
    for lg in only:
        try:
            sb = get(ESPN + path(lg) + "/scoreboard", {"dates": PROBE_DATES[lg], "limit": "50", **({"groups": LEAGUES[lg]["groups"]} if LEAGUES[lg].get("groups") else {})})
            ev = [e for e in sb.get("events", []) if e.get("status", {}).get("type", {}).get("completed")]
            if not ev:
                out[lg] = f"no completed events on {PROBE_DATES[lg]}"
                continue
            e = ev[0]
            eid = e["id"]
            summ = get(ESPN + path(lg) + "/summary", {"event": eid})
            write(f"lab/_probe/{lg}_summary.json", _trim(summ))
            write(f"lab/_probe/{lg}_scoreboard_event.json", _trim(e))
            try:
                od = get(f"{CORE}{path(lg)}/events/{eid}/competitions/{eid}/odds", {"limit": "20"})
                write(f"lab/_probe/{lg}_core_odds.json", _trim(od))
                out[lg] = {"event": eid, "odds": len(od.get("items", []))}
            except Exception as ex:
                out[lg] = {"event": eid, "odds_error": str(ex)[:120]}
        except Exception as ex:
            out[lg] = f"error: {ex}"[:200]
    return out
