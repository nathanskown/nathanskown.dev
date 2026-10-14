"""Past regular seasons, saved once so the house model can be tuned and given a preseason starting point.

  data/sports/history/{lg}_{year}.json   {"year", "complete", "g": [[date, home, away, hs, as, neutral, week], ...]}

`year` follows ESPN's season year: the start year for football (2025 = fall 2025) and the ending year
for NHL, NBA and college basketball and hockey (2026 = the 2025-26 season). Only regular-season games
that were played to a final are kept. A season is fetched once and then left alone; the current season
is never stored here (the hourly model keeps its own cache).

MLB is not covered: its ratings come from season totals in the standings."""
import os
from datetime import date, datetime, timedelta

from .common import ESPN, get, read, write
from .espn import season_info
from .leagues import LEAGUES, path
from .model import _event

HISTORY = ["nfl", "ncaaf", "nhl", "nba", "ncaab", "ncaah"]
SEASONS = 5                                  # how many completed seasons to keep
WEEKS = {"nfl": range(1, 19), "ncaaf": range(0, 16)}
# regular-season window by league as (month, day) in the starting and ending calendar year
WINDOW = {"nhl": ((10, 1), (4, 30)), "nba": ((10, 15), (4, 15)), "ncaab": ((11, 1), (3, 12)), "ncaah": ((10, 1), (3, 25))}
RANGE_DAYS = {"nhl": 7, "nba": 7, "ncaah": 7, "ncaab": 1}      # days per request (ncaab has too many games per week)


def _row(e):
    r = _event(e)
    if not r or r["t"] != 2 or r["off"] or not r["done"] or r["hs"] is None or r["as"] is None:
        return None
    return [r["d"], r["h"], r["a"], r["hs"], r["as"], int(r["n"]), r["wk"]]


def _base(lg):
    base = {"limit": "300"}
    if LEAGUES[lg].get("groups"):
        base["groups"] = LEAGUES[lg]["groups"]
    return base


def _weeks(lg, year):
    out, events = {}, 0
    for wk in WEEKS[lg]:
        d = get(ESPN + path(lg) + "/scoreboard", dict(_base(lg), dates=str(year), seasontype="2", week=str(wk)))
        for e in d.get("events", []):
            events += 1
            r = _row(e)
            if r:
                r[6] = r[6] or wk
                out[e["id"]] = r
    return out, events


def _days(lg, year):
    (m0, d0), (m1, d1) = WINDOW[lg]
    start, end = date(year - 1, m0, d0), date(year, m1, d1)
    step = RANGE_DAYS[lg]
    out, events, cur = {}, 0, start

    def take(d):
        nonlocal events
        for e in d.get("events", []):
            events += 1
            r = _row(e)
            if r:
                out[e["id"]] = r
    while cur <= end:
        last = min(cur + timedelta(days=step - 1), end)
        a, b = cur.strftime("%Y%m%d"), last.strftime("%Y%m%d")
        todo = [(a, b)]
        if step > 1:
            try:
                d = get(ESPN + path(lg) + "/scoreboard", dict(_base(lg), dates=f"{a}-{b}"))
                if len(d.get("events", [])) < 300:
                    take(d)
                    todo = []
            except Exception as e:
                print(f"  {lg} {a}-{b}: range failed ({str(e)[:80]}), going day by day")
        if todo:
            c = cur
            while c <= last:
                take(get(ESPN + path(lg) + "/scoreboard", dict(_base(lg), dates=c.strftime("%Y%m%d"))))
                c += timedelta(days=1)
        cur = last + timedelta(days=1)
    return out, events


def fetch_season(lg, year):
    rows, events = _weeks(lg, year) if lg in WEEKS else _days(lg, year)
    games = sorted(rows.values(), key=lambda r: r[0])
    # a season we could read almost nothing from is a failed fetch, not an empty season
    floor = {"nfl": 250, "ncaaf": 500, "nhl": 1100, "nba": 1100, "ncaab": 4000, "ncaah": 1000}[lg]
    complete = len(games) >= floor
    write(f"history/{lg}_{year}.json", {"year": year, "complete": complete, "events": events, "g": games})
    return len(games), complete


def job_history():
    """Fetch every missing past season for the leagues named in HIST_LG (default: all)."""
    only = [x for x in os.environ.get("HIST_LG", "").split(",") if x] or HISTORY
    out = {}
    for lg in only:
        cur = season_info(lg)["year"]
        got = {}
        for year in range(cur - SEASONS, cur):
            have = read(f"history/{lg}_{year}.json")
            if have and have.get("complete"):
                got[year] = len(have["g"])
                continue
            n, ok = fetch_season(lg, year)
            print(f"{lg} {year}: {n} games{'' if ok else '  (INCOMPLETE)'}", flush=True)
            got[year] = n if ok else f"{n}!"
        out[lg] = got
    return out


def load(lg):
    """{year: [dict, ...]} for every complete stored season, oldest first."""
    seasons = {}
    for year in range(2010, 2040):
        s = read(f"history/{lg}_{year}.json")
        if s and s.get("complete"):
            seasons[year] = [{"d": r[0], "h": r[1], "a": r[2], "hs": r[3], "as": r[4], "n": bool(r[5]), "wk": r[6]} for r in s["g"]]
    return seasons
