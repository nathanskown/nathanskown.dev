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
    r = SESSION.get(MP_ALL_TEAMS, headers={"User-Agent": UA}, timeout=600, stream=True)
    r.raise_for_status()
    r.encoding = r.encoding or "utf-8"
    # iter_lines undoes any gzip transfer encoding and streams, so the large file never sits in memory whole
    rows = csv.DictReader(line for line in r.iter_lines(decode_unicode=True) if line)
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


# ---------------------------------------------------------------- MLB starting pitchers -> per-game edge
# A starter's quality is a FIP-style rate (home runs, walks, hit batters, strikeouts per inning: the parts of
# run prevention a pitcher controls, steadier than runs allowed), relative to the league that season,
# blended from this season so far and last season and pulled toward average by IP0 innings.
# The game edge is how many runs the two starters should differ by over a typical start (SP_INNINGS).
MLB_ESPN = {"DET": "6", "MIN": "9", "MIL": "8", "COL": "27", "PHI": "22", "BOS": "2", "TB": "30", "BAL": "1", "KC": "7",
            "CWS": "4", "CIN": "17", "PIT": "23", "LAD": "19", "SD": "25", "SEA": "12", "LAA": "3", "MIA": "28", "ATL": "15",
            "OAK": "11", "ATH": "11", "TEX": "13", "AZ": "29", "ARI": "29", "SF": "26", "CHC": "16", "STL": "24", "NYY": "10",
            "TOR": "14", "WSH": "20", "NYM": "21", "HOU": "18", "CLE": "5"}
IP0, PREV_W, SP_INNINGS = 40.0, 0.7, 5.3


def _raw(line):
    """FIP numerator per inning from a compact line [outs, ER, HR, BB, K, HBP, BF, GS], and innings."""
    ip = line[0] / 3.0
    if ip <= 0:
        return None, 0.0
    return (13 * line[2] + 3 * (line[3] + line[5]) - 2 * line[4]) / ip, ip


def league_raw(lines):
    tot = [0, 0, 0, 0, 0, 0]
    for ln in lines:
        tot[0] += ln[0]; tot[1] += ln[2]; tot[2] += ln[3]; tot[3] += ln[4]; tot[4] += ln[5]
    ip = tot[0] / 3.0
    return (13 * tot[1] + 3 * (tot[2] + tot[4]) - 2 * tot[3]) / ip if ip else 0.0


def sp_rating(cur, prev, lg_cur, lg_prev):
    """Runs per 9 innings worse than an average starter (negative = better), shrunk toward 0."""
    num = den = 0.0
    if cur:
        r, ip = _raw(cur)
        if r is not None:
            num += ip * (r - lg_cur); den += ip
    if prev:
        r, ip = _raw(prev)
        if r is not None:
            num += PREV_W * ip * (r - lg_prev); den += PREV_W * ip
    return num / (den + IP0)


def mlb_sp_edges(year):
    """{(startUTC16, home espn id, away espn id, home runs, away runs): home edge in runs, ...,
        ('day', date, home, away): same} for a stored season; the edge is (away SP rating - home SP rating) x 5.3/9."""
    d = read(f"history/mlb_sp_{year}.json")
    if not d or not d.get("games"):
        return {}
    snaps = sorted(d["snapshots"].items())
    lg_prev = league_raw(d["prevSeason"].values()) if d["prevSeason"] else 0.0
    # league level as of each snapshot (so nothing from later in the season leaks in); early on, last season's
    lg_at = {mon: (league_raw(s.values()) if sum(x[0] for x in s.values()) / 3.0 > 1500 else lg_prev) for mon, s in snaps}
    out = {}
    for g in d["games"]:
        day = g[0]
        cur, lg_cur = {}, lg_prev
        for mon, s in snaps:
            if mon <= day:
                cur, lg_cur = s, lg_at[mon]
            else:
                break
        h, a = MLB_ESPN.get(g[2]), MLB_ESPN.get(g[3])
        if not (h and a):
            continue
        rh = sp_rating(cur.get(g[6]) if g[6] else None, d["prevSeason"].get(g[6]) if g[6] else None, lg_cur, lg_prev)
        ra = sp_rating(cur.get(g[7]) if g[7] else None, d["prevSeason"].get(g[7]) if g[7] else None, lg_cur, lg_prev)
        edge = (ra - rh) * SP_INNINGS / 9.0
        out[(g[1], h, a, g[4], g[5])] = edge
        out[("day", day, h, a, g[4], g[5])] = edge
    return out


def _edge_lookup(edges, d16, h, a, hs, as_):
    from datetime import date, timedelta
    v = edges.get((d16, h, a, hs, as_))
    if v is None:
        for dd in (0, -1):
            v = edges.get(("day", (date.fromisoformat(d16[:10]) + timedelta(days=dd)).isoformat(), h, a, hs, as_))
            if v is not None:
                break
    return v


def annotate_sp(year, games, weight):
    """Set g["spEdge"] (runs, home perspective, times the fitted weight) on finished MLB games of `year`."""
    edges = mlb_sp_edges(year)
    for g in games:
        v = _edge_lookup(edges, g["d"][:16], g["h"], g["a"], g.get("hs"), g.get("as")) if edges else None
        g["spEdge"] = weight * v if v is not None else 0.0
    return games


def upcoming_sp(year, weight, days=7):
    """{"startUTC16|home|away": edge} for MLB games in the next `days` with announced starters (any game type),
    using each starter's season so far and last season, the same way as the stored seasons."""
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).date()
    sched = get(MLB + "schedule", {"sportId": "1", "startDate": today.isoformat(), "endDate": (today + timedelta(days=days)).isoformat(),
                                   "hydrate": "probablePitcher,team"})
    games, ids = [], set()
    for day in sched.get("dates", []):
        for g in day.get("games", []):
            t = g["teams"]
            hp, ap = (t["home"].get("probablePitcher") or {}).get("id"), (t["away"].get("probablePitcher") or {}).get("id")
            h, a = MLB_ESPN.get((t["home"]["team"] or {}).get("abbreviation")), MLB_ESPN.get((t["away"]["team"] or {}).get("abbreviation"))
            if h and a and (hp or ap):
                games.append((g.get("gameDate", "")[:16], h, a, str(hp) if hp else None, str(ap) if ap else None))
                ids.update(str(p) for p in (hp, ap) if p)
    if not games:
        return {}
    cur = _pitching({"stats": "season", "season": str(year)}, ids)
    prev = _pitching({"stats": "season", "season": str(year - 1)}, ids)
    lg_prev = league_raw(_pitching({"stats": "season", "season": str(year - 1)}).values())
    lg_cur = league_raw(_pitching({"stats": "season", "season": str(year)}).values()) or lg_prev
    out = {}
    for d16, h, a, hp, ap in games:
        rh = sp_rating(cur.get(hp) if hp else None, prev.get(hp) if hp else None, lg_cur, lg_prev)
        ra = sp_rating(cur.get(ap) if ap else None, prev.get(ap) if ap else None, lg_cur, lg_prev)
        out[f"{d16}|{h}|{a}"] = round(weight * (ra - rh) * SP_INNINGS / 9.0, 3)
    return out


def job_mlb_current():
    """Daily: refresh this MLB season's starters file while games are being played (regular season or postseason)."""
    from .espn import season_info
    si = season_info("mlb")
    if si["type"] not in (2, 3):
        return "offseason: nothing to refresh"
    return {si["year"]: mlb_season(si["year"])}


# ---------------------------------------------------------------- NHL expected goals -> per-game margin
_XG = None


def job_nhl_current():
    """Daily: refresh MoneyPuck expected goals while the NHL regular season is on (one file download)."""
    global _XG
    from .espn import season_info
    if season_info("nhl")["type"] != 2:
        return "not regular season: nothing to refresh"
    out = nhl_xg()
    _XG = None
    return {"latest season games": list(out.items())[-1]}


def _xg_file():
    global _XG
    if _XG is None:
        _XG = read("history/xg_nhl.json") or {}
    return _XG


def nhl_team_map():
    """MoneyPuck team code -> ESPN team id, learned by matching games on date and final score (votes)."""
    import collections
    from . import history
    x = _xg_file().get("seasons") or {}
    votes = collections.defaultdict(collections.Counter)
    hist = history.load("nhl")
    for season, rows in x.items():
        esp = {}
        for g in hist.get(int(season) + 1, []):
            for dd in (0, -1):
                d = (date.fromisoformat(g["d"][:10]) + timedelta(days=dd)).isoformat()
                esp.setdefault((d, g["hs"], g["as"]), []).append(g)
        for r in rows:
            if r[5] is None or r[6] is None:
                continue
            for g in esp.get((r[0], int(r[5]), int(r[6])), []):
                votes[r[1]][g["h"]] += 1
                votes[r[2]][g["a"]] += 1
    return {k: v.most_common(1)[0][0] for k, v in votes.items() if v}


def nhl_xg_lookup(espn_year, adjusted=False):
    """{(date, home espn id, away espn id): home xG minus away xG} for an ESPN NHL season year (2026 = 2025-26).
    Keyed by MoneyPuck's local game date and also the next day (ESPN dates are UTC)."""
    x = _xg_file().get("seasons") or {}
    rows = x.get(str(espn_year - 1))
    if not rows:
        return {}
    from . import model as M
    tm = nhl_team_map()
    out = {}
    for r in rows:
        h, a = tm.get(r[1]), tm.get(r[2])
        if not (h and a):
            continue
        h, a = M.alias("nhl", h), M.alias("nhl", a)       # Arizona -> Utah, as the model rates them
        hx, ax = (r[7], r[8]) if adjusted and r[7] is not None else (r[3], r[4])
        if hx is None or ax is None:
            continue
        v = hx - ax
        out[(r[0], h, a)] = v
        out.setdefault(((date.fromisoformat(r[0]) + timedelta(days=1)).isoformat(), h, a), v)
    return out
