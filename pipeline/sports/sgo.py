"""SportsGameOdds (SGO_KEY, free Amateur plan: 2,500 events a month): closing NFL player-prop lines and results.

Only finished games are fetched. Each one carries every sportsbook's closing over/under line for each player prop, plus
the player's actual result, so one request per finished game is enough to grade the props board against real lines.
Stored compactly in data/sports/track/_sgo_nfl_{season}.json: {"events": {eventID: {"d", "home", "away", "props": [
[name, team, market, close line, close over odds, close under odds, result]]}}}. Never shown on the site; used only to
grade the house projections."""
import os
import re

from .common import get, now_iso, read, write

BASE = "https://api.sportsgameodds.com/v2"
STATS = {"receiving_yards": "rec_yds", "receiving_receptions": "receptions", "rushing_yards": "rush_yds", "passing_yards": "pass_yds"}
MONTH_CAP = 2300            # stop well short of the plan's 2,500 events a month


def _key():
    return os.environ.get("SGO_KEY", "").strip()


def _h():
    return {"X-Api-Key": _key()}


def usage():
    d = get(BASE + "/account/usage", headers=_h(), timeout=60)
    m = (((d.get("data") or {}).get("rateLimits") or {}).get("per-month") or {})
    return int(m.get("current-entities") or 0), int(m.get("max-entities") or 2500)


def _num(x):
    try:
        return float(str(x).replace("+", ""))
    except (TypeError, ValueError):
        return None


def _extract(ev):
    teams = ev.get("teams") or {}
    tid = {(teams.get(s) or {}).get("teamID"): ((teams.get(s) or {}).get("names") or {}).get("short") for s in ("home", "away")}
    players = ev.get("players") or {}
    out = []
    for oid, o in (ev.get("odds") or {}).items():
        if o.get("betTypeID") != "ou" or o.get("sideID") != "over" or o.get("periodID") != "game":
            continue
        mk = STATS.get(o.get("statID"))
        pid = o.get("playerID")
        if not mk or not pid:
            continue
        un = (ev.get("odds") or {}).get(o.get("opposingOddID")) or {}
        line = _num(o.get("closeBookOverUnder") or o.get("bookOverUnder"))
        if line is None:
            continue
        p = players.get(pid) or {}
        out.append([p.get("name") or pid, tid.get(p.get("teamID")), mk, line, _num(o.get("closeBookOdds") or o.get("bookOdds")),
                    _num(un.get("closeBookOdds") or un.get("bookOdds")), _num(o.get("score"))])
    return out


def backfill(season, start, end, cap=400):
    """Fetch finished NFL games between start and end (ISO dates) that are not stored yet."""
    if not _key():
        return {"error": "no SGO_KEY"}
    used, mx = usage()
    room = min(cap, min(MONTH_CAP, mx - 200) - used)
    if room <= 0:
        return {"skipped": f"monthly budget used ({used}/{mx})"}
    name = f"track/_sgo_nfl_{season}.json"
    store = read(name) or {"season": season, "events": {}}
    ev_store = store["events"]
    got, cursor, calls = 0, None, 0
    while got < room and calls < 60:
        params = {"leagueID": "NFL", "finalized": "true", "startsAfter": start, "startsBefore": end, "limit": str(min(25, room - got))}
        if cursor:
            params["cursor"] = cursor
        d = get(BASE + "/events", params, headers=_h(), timeout=90)
        calls += 1
        evs = d.get("data") or []
        for ev in evs:
            got += 1
            if ev.get("eventID") in ev_store:
                continue
            t = ev.get("teams") or {}
            ev_store[ev["eventID"]] = {"d": ((ev.get("status") or {}).get("startsAt") or "")[:16],
                                       "home": ((t.get("home") or {}).get("names") or {}).get("short"),
                                       "away": ((t.get("away") or {}).get("names") or {}).get("short"), "props": _extract(ev)}
        cursor = d.get("nextCursor")
        if not cursor or not evs:
            break
    store["updated"] = now_iso()
    write(name, store)
    used2, _ = usage()
    return {"season": season, "stored": len(ev_store), "fetched": got, "props": sum(len(e["props"]) for e in ev_store.values()), "monthUsed": used2}


def job_backfill():
    """This season's finished games not stored yet (the window starts at the newest stored game, so each run costs
    only the games since). Last season is not fetched: its stored "closing" lines were in-game numbers, not pre-game."""
    cur = (read("model/nfl.json") or {}).get("season")
    if not cur:
        return {"error": "no NFL season"}
    store = read(f"track/_sgo_nfl_{cur}.json") or {}
    last = max((e["d"] for e in (store.get("events") or {}).values() if e.get("d")), default="")
    try:
        return backfill(cur, last[:10] if last else f"{cur}-09-01", f"{cur + 1}-02-20", cap=60)
    except Exception as e:
        return {"error": str(e)[:200]}
