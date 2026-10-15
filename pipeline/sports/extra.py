"""Free extra data for the house model, beyond ESPN scores. Fetched by the history workflow (not hourly).

  history/xg_nhl.json        NHL expected goals per game, every regular season MoneyPuck has (2008-09 on).
                             Source: moneypuck.com (free for non-commercial use; credit MoneyPuck.com).
                             {"seasons": {"2025": [[date, home, away, hxg, axg, hg, ag, hxgAdj, axgAdj], ...]}}
                             season = MoneyPuck's start year (2025 = 2025-26); teams are MoneyPuck codes.
  history/mlb_sp_{year}.json MLB probable starting pitchers for every regular-season game, plus each
                             starter's season-to-date pitching line as of each Monday and his full previous
                             season. Source: MLB Stats API (statsapi.mlb.com), individual non-commercial use.

Expected goals measure the quality of chances a team created and allowed; over a few dozen games they
predict future results better than actual goals, which swing on shooting and goaltending luck. Starting
pitchers are the single biggest game-to-game factor in baseball that a team rating cannot see."""
import csv
import io
import os
from datetime import date, timedelta

from .common import get, read, write
from .common import SESSION, UA

MP_ALL_TEAMS = "https://moneypuck.com/moneypuck/playerData/careers/gameByGame/all_teams.csv"
MLB = "https://statsapi.mlb.com/api/v1/"
MLB_YEARS = range(2015, 2027)


def _num(v):
    try:
        return round(float(v), 3)
    except (TypeError, ValueError):
        return None


def nhl_xg():
    """Download MoneyPuck's all-teams game-by-game file and keep one row per regular-season game."""
    r = SESSION.get(MP_ALL_TEAMS, headers={"User-Agent": UA}, timeout=300, stream=True)
    r.raise_for_status()
    rows = csv.DictReader(io.TextIOWrapper(r.raw, encoding="utf-8", errors="replace"))
    cols = rows.fieldnames or []
    seasons, seen = {}, set()
    for x in rows:
        if x.get("situation") != "all" or str(x.get("home_or_away", "")).upper() != "HOME":
            continue
        if str(x.get("playoffGame", "0")) not in ("0", "", "False", "false"):
            continue
        gid = x.get("gameId")
        if gid in seen:
            continue
        seen.add(gid)
        d = str(x.get("gameDate", ""))
        d = f"{d[:4]}-{d[4:6]}-{d[6:8]}" if len(d) == 8 else d[:10]
        row = [d, x.get("playerTeam") or x.get("team"), x.get("opposingTeam"),
               _num(x.get("xGoalsFor")), _num(x.get("xGoalsAgainst")), _num(x.get("goalsFor")), _num(x.get("goalsAgainst")),
               _num(x.get("scoreVenueAdjustedxGoalsFor")), _num(x.get("scoreVenueAdjustedxGoalsAgainst"))]
        seasons.setdefault(str(x.get("season")), []).append(row)
    for v in seasons.values():
        v.sort()
    write("history/xg_nhl.json", {"source": "MoneyPuck.com (free for non-commercial use; credit required)",
                                  "columns": ["date", "home", "away", "home xG", "away xG", "home goals", "away goals",
                                              "home xG score/venue adjusted", "away xG score/venue adjusted"],
                                  "csvColumns": cols[:80], "seasons": seasons})
    return {k: len(v) for k, v in sorted(seasons.items())}


def _line(st):
    """Compact pitching line: [outs, earned runs, home runs, walks, strikeouts, hit batters, batters faced, starts]."""
    ip = str(st.get("inningsPitched", "0"))
    whole, _, frac = ip.partition(".")
    outs = int(whole or 0) * 3 + int(frac or 0)
    return [outs, st.get("earnedRuns", 0), st.get("homeRuns", 0), st.get("baseOnBalls", 0), st.get("strikeOuts", 0),
            st.get("hitByPitch", 0), st.get("battersFaced", 0), st.get("gamesStarted", 0)]


def _pitching(params, ids=None):
    d = get(MLB + "stats", dict({"group": "pitching", "sportId": "1", "playerPool": "ALL", "limit": "5000"}, **params))
    out = {}
    for s in (d.get("stats") or [{}])[0].get("splits", []):
        pid = str((s.get("player") or {}).get("id", ""))
        if pid and (ids is None or pid in ids):
            out[pid] = _line(s.get("stat") or {})
    return out


def mlb_season(year):
    sched = get(MLB + "schedule", {"sportId": "1", "gameType": "R", "season": str(year), "hydrate": "probablePitcher,team"})
    games, starters, first = [], set(), None
    for day in sched.get("dates", []):
        for g in day.get("games", []):
            if (g.get("status") or {}).get("codedGameState") not in ("F", "O"):       # final / completed early
                continue
            t = g["teams"]
            hp, ap = (t["home"].get("probablePitcher") or {}).get("id"), (t["away"].get("probablePitcher") or {}).get("id")
            games.append([g.get("officialDate") or day["date"], g.get("gameDate", "")[:16],
                          (t["home"]["team"] or {}).get("abbreviation") or t["home"]["team"]["id"],
                          (t["away"]["team"] or {}).get("abbreviation") or t["away"]["team"]["id"],
                          t["home"].get("score"), t["away"].get("score"),
                          str(hp) if hp else None, str(ap) if ap else None, g.get("gamePk")])
            starters.update(str(p) for p in (hp, ap) if p)
            first = first or day["date"]
    games.sort()
    if not games:
        return {"games": 0}
    prev = _pitching({"stats": "season", "season": str(year - 1)}, starters)
    snaps, d0, end = {}, date.fromisoformat(games[0][0]), date.fromisoformat(games[-1][0])
    cur = d0 + timedelta(days=(7 - d0.weekday()) % 7 or 7)            # first Monday after opening day
    while cur <= end + timedelta(days=7):
        snaps[cur.isoformat()] = _pitching({"stats": "byDateRange", "season": str(year), "startDate": d0.isoformat(),
                                            "endDate": (cur - timedelta(days=1)).isoformat()}, starters)
        cur += timedelta(days=7)
    write(f"history/mlb_sp_{year}.json", {"year": year, "source": "MLB Stats API (statsapi.mlb.com)",
                                         "line": ["outs", "ER", "HR", "BB", "K", "HBP", "BF", "GS"],
                                         "gameColumns": ["officialDate", "startUTC", "home", "away", "home runs", "away runs",
                                                         "home SP", "away SP", "gamePk"],
                                         "games": games, "prevSeason": prev, "snapshots": snaps})
    both = sum(1 for g in games if g[6] and g[7])
    return {"games": len(games), "withBothStarters": both, "snapshots": len(snaps)}


def job_extra():
    """Fetch what is missing: NHL expected goals (refreshed every run) and any MLB season not stored yet."""
    out = {}
    try:
        out["nhl_xg"] = nhl_xg()
    except Exception as e:
        out["nhl_xg"] = f"error: {e}"[:200]
    mlb = {}
    for y in MLB_YEARS:
        have = read(f"history/mlb_sp_{y}.json")
        if have and have.get("games") and os.environ.get("EXTRA_REFRESH") != "1":
            mlb[y] = "stored"
            continue
        try:
            mlb[y] = mlb_season(y)
        except Exception as e:
            mlb[y] = f"error: {e}"[:160]
        print("mlb", y, mlb[y], flush=True)
    out["mlb_sp"] = mlb
    return out
