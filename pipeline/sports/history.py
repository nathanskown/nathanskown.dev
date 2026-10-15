"""Past regular seasons, saved once so the house model can be tuned and given a preseason starting point.

  data/sports/history/{lg}_{year}.json   {"year", "complete", "v", "g": [[date, home, away, hs, as, neutral, week, spread], ...]}

`spread` is the home team's expected margin from the betting line ESPN kept on the game (positive = home
favored), or null. It is used only to check the house model against the market; the site never shows it.
NFL seasons before 2014 come from nflverse (github.com/nflverse/nflverse-data, CC-BY 4.0), written once by
hand with their closing lines in history/market_nfl.json.

`year` follows ESPN's season year: the start year for football (2025 = fall 2025) and the ending year
for NHL, NBA and college basketball and hockey (2026 = the 2025-26 season). Only regular-season games
that were played to a final are kept. A season is fetched once and then left alone; the current season
is never stored here (the hourly model keeps its own cache), unless its regular season is over
(postseason or offseason), as MLB's is in October.

Seasons stored by an older version of this file (no "v" or a lower one) are fetched again so every
season carries the same fields."""
import os
from datetime import date, timedelta

from .common import ESPN, get, read, write
from .espn import season_info
from .leagues import LEAGUES, path
from .model import _event

HISTORY = ["nfl", "ncaaf", "nhl", "nba", "ncaab", "ncaah", "mlb"]
VERSION = 2                                  # 2: betting line kept per game
SEASONS = {"nfl": 12, "ncaaf": 12, "nhl": 12, "nba": 12, "ncaab": 10, "ncaah": 10, "mlb": 12}
DEFAULT_SEASONS = 5                          # more seasons = more held-out folds, so small effects can be told from noise
WEEKS = {"nfl": range(1, 19), "ncaaf": range(0, 16)}
# regular-season window by league as (month, day) in the starting and ending calendar year
WINDOW = {"nhl": ((10, 1), (5, 20)), "nba": ((10, 15), (5, 20)), "ncaab": ((11, 1), (3, 16)), "ncaah": ((10, 1), (3, 25)),
          "mlb": ((3, 15), (10, 7))}
SAME_YEAR = {"mlb"}                          # MLB's season sits inside one calendar year
RANGE_DAYS = {"nhl": 7, "nba": 7, "ncaah": 7, "ncaab": 1, "mlb": 5}      # days per request (ncaab has too many games per week)
# a season we could read almost nothing from is a failed fetch, not an empty season; floors allow for the
# short seasons (2012-13 lockouts, 2020-21 pandemic schedules)
FLOOR = {"nfl": 240, "ncaaf": 500, "nhl": 650, "nba": 900, "ncaab": 3000, "ncaah": 650, "mlb": 850}


def _spread(e):
    """Home team's expected margin from the line ESPN kept on the game ("DET -3.5" -> +3.5), or None."""
    try:
        c = e["competitions"][0]
        odds = (c.get("odds") or [])
        if not odds:
            return None
        o = odds[0]
        ab = {x["homeAway"]: (x.get("team") or {}).get("abbreviation", "") for x in c["competitors"]}
        det = str(o.get("details") or "").strip()
        if det.upper() in ("EVEN", "PK", "PICK"):
            return 0.0
        parts = det.rsplit(" ", 1)
        if len(parts) == 2:
            v = abs(float(parts[1]))
            if parts[0] == ab.get("home"):
                return v
            if parts[0] == ab.get("away"):
                return -v
        sp = o.get("spread")
        if sp is not None and (o.get("homeTeamOdds") or {}).get("favorite") is not None:
            v = abs(float(sp))
            return v if o["homeTeamOdds"]["favorite"] else -v
    except (KeyError, ValueError, TypeError, IndexError):
        return None
    return None


def _row(e):
    r = _event(e)
    if not r or r["t"] != 2 or r["off"] or not r["done"] or r["hs"] is None or r["as"] is None:
        return None
    return [r["d"], r["h"], r["a"], r["hs"], r["as"], int(r["n"]), r["wk"], _spread(e)]


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
    start, end = date(year if lg in SAME_YEAR else year - 1, m0, d0), date(year, m1, d1)
    end = min(end, date.today())
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
    complete = len(games) >= FLOOR[lg]
    lines = sum(1 for g in games if g[7] is not None)
    write(f"history/{lg}_{year}.json", {"year": year, "complete": complete, "v": VERSION, "events": events, "lines": lines, "g": games})
    return len(games), complete


def job_history():
    """Fetch every missing past season for the leagues named in HIST_LG (default: all)."""
    only = [x for x in os.environ.get("HIST_LG", "").split(",") if x] or HISTORY
    out = {}
    for lg in only:
        si = season_info(lg)
        cur = si["year"]
        last = cur + 1 if si["type"] in (3, 4) else cur        # the current regular season counts once it is over
        got = {}
        for year in range(last - SEASONS.get(lg, DEFAULT_SEASONS), last):
            have = read(f"history/{lg}_{year}.json")
            if have and have.get("complete") and (have.get("v", 1) >= VERSION or have.get("source", "").startswith("nflverse")):
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
    for year in range(1990, 2040):
        s = read(f"history/{lg}_{year}.json")
        if s and s.get("complete"):
            seasons[year] = [{"d": r[0], "h": r[1], "a": r[2], "hs": r[3], "as": r[4], "n": bool(r[5]), "wk": r[6],
                              "sp": r[7] if len(r) > 7 else None} for r in s["g"]]
    return seasons
