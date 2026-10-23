"""The lab: richer per-game data for every league, collected on GitHub's runners (the only place ESPN is reachable
from), so models can be tested against the closing betting lines and against who actually played.

  data/sports/lab/{lg}_{year}.json    {"year", "v", "g": {event id: row}}

One ESPN summary request per game carries the closing line (pickcenter) and the box score, so a season costs one
request per game after a scoreboard crawl for the event ids. Modes (python -m pipeline.sports.run lab):
  probe     save one raw summary per league to data/sports/lab/_probe/ (to learn the shapes)
  collect   per league and season: every completed regular-season game's closing line and box score, kept compact
  cfbd      probe CollegeFootballData lines and player endpoints (needs the CFBD_KEY secret)
"""
import json
import os
import time
from datetime import date, timedelta

from .common import ESPN, get, read, write, now_iso
from .leagues import LEAGUES, path

CORE = "https://sports.core.api.espn.com/v2/sports/"
SEASONS = {"nhl": [2022, 2023, 2024, 2025, 2026], "nba": [2022, 2023, 2024, 2025, 2026], "ncaab": [2025, 2026],
           "nfl": [], "ncaaf": [2021, 2022, 2023, 2024, 2025, 2026], "ncaah": [], "mlb": []}
WINDOW = {"nhl": ((10, 1), (6, 25)), "nba": ((10, 15), (6, 25)), "ncaab": ((11, 1), (3, 20)), "ncaaf": ((8, 20), (1, 20))}
STEP = {"nhl": 7, "nba": 7, "ncaab": 1, "ncaaf": 7}
FOOTBALL = {"nfl", "ncaaf"}                      # season year = start year, so the window runs into the next calendar year
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


# ---------------------------------------------------------------- per-game extraction
def _line(summ):
    """(home margin the market expects, total, home moneyline, away moneyline) from the summary's first pickcenter entry."""
    pc = summ.get("pickcenter") or []
    if not pc:
        return None
    o = pc[0]
    try:
        sp = o.get("spread")
        home = o.get("homeTeamOdds") or {}
        margin = None
        if sp is not None:
            margin = abs(float(sp)) if home.get("favorite") else -abs(float(sp))
            if float(sp) == 0:
                margin = 0.0
        return {"sp": margin, "tot": o.get("overUnder"), "ml": [home.get("moneyLine"), (o.get("awayTeamOdds") or {}).get("moneyLine")],
                "prov": (o.get("provider") or {}).get("name")}
    except (TypeError, ValueError):
        return None


def _stat(labels, stats, name):
    try:
        return stats[labels.index(name)]
    except (ValueError, IndexError, TypeError):
        return None


def _num(v):
    try:
        return float(str(v).replace("%", ""))
    except (TypeError, ValueError):
        return None


def _mins(v):
    """"32:15" or "32" -> minutes."""
    if v is None:
        return None
    s = str(v)
    if ":" in s:
        a, b = s.split(":")[:2]
        return float(a) + float(b) / 60
    return _num(s)


def _players(lg, summ):
    """Compact player rows per side, keyed by the side's ESPN team id."""
    out = {}
    for t in (summ.get("boxscore") or {}).get("players", []):
        tid = str((t.get("team") or {}).get("id"))
        rows = []
        for g in t.get("statistics", []):
            labels = g.get("labels") or g.get("keys") or []
            name = g.get("name")
            for a in g.get("athletes", []):
                at, st = a.get("athlete") or {}, a.get("stats") or []
                if lg == "nhl":
                    if name == "goalies":
                        rows.append(["G", at.get("id"), at.get("displayName"), _num(_stat(labels, st, "GA")), _num(_stat(labels, st, "SA")), _mins(_stat(labels, st, "TOI"))])
                    elif name in ("forwards", "defenses"):
                        rows.append(["F" if name == "forwards" else "D", at.get("id"), at.get("displayName"), _mins(_stat(labels, st, "TOI")), _num(_stat(labels, st, "+/-"))])
                elif lg in FOOTBALL:
                    if name == "passing":
                        rows.append([at.get("id"), at.get("displayName"), _num((_stat(labels, st, "C/ATT") or "0/0").split("/")[-1]), _num(_stat(labels, st, "YDS")),
                                     _num(_stat(labels, st, "TD")), _num(_stat(labels, st, "INT")), _num(_stat(labels, st, "QBR")), _num(_stat(labels, st, "SACKS"))])
                elif lg in ("nba",):
                    if st:
                        rows.append([at.get("id"), at.get("displayName"), _mins(_stat(labels, st, "MIN")), _num(_stat(labels, st, "PTS")), _num(_stat(labels, st, "+/-")), 1 if a.get("starter") else 0])
        out[tid] = rows
    return out


def row_from(lg, ev, summ):
    c = ev["competitions"][0]
    comp = {x["homeAway"]: x for x in c["competitors"]}
    row = {"d": ev["date"][:16], "h": comp["home"]["team"]["id"], "a": comp["away"]["team"]["id"],
           "hs": _num(comp["home"].get("score")), "as": _num(comp["away"].get("score")), "n": int(bool(c.get("neutralSite")))}
    ln = _line(summ)
    if ln:
        row.update(ln)
    if lg in ("nhl", "nba") or lg in FOOTBALL:
        row["pl"] = _players(lg, summ)
    return row


# ---------------------------------------------------------------- collect
def _crawl_ids(lg, year):
    """All regular-season events in a season window from the scoreboard."""
    (m0, d0), (m1, d1) = WINDOW[lg]
    if lg in FOOTBALL:
        start, end = date(year, m0, d0), min(date(year + 1, m1, d1), date.today())
    else:
        start, end = date(year - 1, m0, d0), min(date(year, m1, d1), date.today())
    step, cur, events = STEP[lg], start, {}
    base = {"limit": "300"}
    if LEAGUES[lg].get("groups"):
        base["groups"] = LEAGUES[lg]["groups"]
    while cur <= end:
        last = min(cur + timedelta(days=step - 1), end)
        a, b = cur.strftime("%Y%m%d"), last.strftime("%Y%m%d")
        try:
            d = get(ESPN + path(lg) + "/scoreboard", dict(base, dates=f"{a}-{b}" if step > 1 else a))
            evs = d.get("events", [])
            if (len(evs) >= 300 or not evs) and step > 1:         # too many for one request, or a range ESPN would not answer
                evs = []
                c = cur
                while c <= last:
                    evs += get(ESPN + path(lg) + "/scoreboard", dict(base, dates=c.strftime("%Y%m%d"))).get("events", [])
                    c += timedelta(days=1)
        except Exception as e:
            print(f"  {lg} {a}-{b}: {str(e)[:80]}")
            evs = []
        if len(events) == 0 and cur < start + timedelta(days=step * 3):
            print(f"  {lg} {a}-{b}: {len(evs)} events; first: {json.dumps((evs[0].get('status') or {}).get('type') if evs else None)[:160]} season={json.dumps(evs[0].get('season') if evs else None)[:100]}", flush=True)
        for e in evs:
            st = (e.get("status") or {}).get("type") or {}
            if st.get("completed") and (e.get("season") or {}).get("type", 2) == 2:
                events[e["id"]] = e
        cur = last + timedelta(days=1)
    return events


def collect(lg, year, budget_s=None):
    rel = f"lab/{lg}_{year}.json"
    store = read(rel) or {"year": year, "v": 1, "g": {}}
    t0 = time.time()
    events = _crawl_ids(lg, year)
    todo = [eid for eid in events if eid not in store["g"]]
    print(f"{lg} {year}: {len(events)} completed games, {len(todo)} to fetch", flush=True)
    done = fail = 0
    for i, eid in enumerate(todo):
        if budget_s and time.time() - t0 > budget_s:
            break
        try:
            summ = get(ESPN + path(lg) + "/summary", {"event": eid})
            store["g"][eid] = row_from(lg, events[eid], summ)
            done += 1
        except Exception as e:
            fail += 1
            if fail < 5:
                print(f"  {eid}: {str(e)[:100]}")
        if done and done % 400 == 0:
            write(rel, store)
    store["updated"] = now_iso()
    write(rel, store)
    withline = sum(1 for r in store["g"].values() if r.get("sp") is not None)
    return {"games": len(store["g"]), "fetched": done, "failed": fail, "withLine": withline, "seconds": round(time.time() - t0)}


def job_collect():
    only = [x for x in os.environ.get("LAB_LG", "").split(",") if x] or list(SEASONS)
    out = {}
    for lg in only:
        for year in SEASONS.get(lg, []):
            try:
                out[f"{lg}_{year}"] = collect(lg, year, budget_s=int(os.environ.get("LAB_BUDGET", "7200")))
            except Exception as e:
                import traceback; traceback.print_exc()
                out[f"{lg}_{year}"] = f"error: {e}"[:160]
    return out


# ---------------------------------------------------------------- CollegeFootballData probe
def job_cfbd():
    key = os.environ.get("CFBD_KEY", "")
    if not key:
        return {"error": "no CFBD_KEY"}
    H = {"Authorization": f"Bearer {key}"}
    base = "https://api.collegefootballdata.com"
    out = {}
    for name, url, params in (("lines", "/lines", {"year": 2025, "seasonType": "regular", "week": 8}),
                              ("players", "/games/players", {"year": 2025, "week": 8, "seasonType": "regular", "category": "passing"}),
                              ("games", "/games", {"year": 2025, "week": 8, "seasonType": "regular"})):
        try:
            d = get(base + url, params, headers=H)
            write(f"lab/_probe/cfbd_{name}.json", _trim(d if isinstance(d, list) else d))
            out[name] = len(d) if isinstance(d, list) else "object"
        except Exception as e:
            out[name] = f"error: {str(e)[:120]}"
    return out
