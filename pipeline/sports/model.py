"""House ratings, game projections and playoff odds for every team league.

Ratings are a ridge-regularised SRS: each team's rating is the points-per-game margin it would
post against an average opponent on a neutral field, solved from every completed game with home
advantage removed, and pulled toward a prior (0, or last season for the NBA) with the weight of
`k` games. That is the same shrinkage as SRS x GP/(GP+k) on the methodology page, but it stays
stable early in a season and in college, where schedules barely connect.

  P(home wins) = Phi((rating_home - rating_away + HFA) / s),  s = sigma x sqrt(1 + 1/w_home + 1/w_away)

where w is a team's weight of evidence (games played, recency-weighted, plus k), when the league's fitted
settings say that widening helps (pv); otherwise s = sigma. Recent games can count more (hl, a half-life
in weeks) and blowouts can be damped (cap, or soft = c x tanh(margin / c)). tune.py fits all of these on
past seasons; see its docstring for the checks.

Season simulations (NFL, NHL) replay the rest of the schedule thousands of times with the
ratings plus their uncertainty and, for the NFL, a week-to-week drift in each team's true strength
(injuries, form), then apply each league's playoff format. The drift was set by replaying 2003-2025
seasons from weeks 4, 8 and 12 and checking the playoff odds against who actually made it.

Completed games are cached in data/sports/model/_games_{lg}.json so each hourly run only asks
ESPN for the days or weeks that are not final yet."""
import collections
import json
import math
import zlib
import os
from datetime import datetime, timedelta, timezone

import numpy as np

from .common import ESPN, get, read, write
from .espn import season_info
from .leagues import LEAGUES, path

PARAMS = {
    #        HFA    div HFA  sigma  k (prior weight in games)  margin cap  min GP before showing projections
    "nfl":   dict(hfa=1.8, divHfa=0.9, sigma=13.5, k=5, cap=None, minGp=1, unit="points", drift=1.0),
    "ncaaf": dict(hfa=2.5, sigma=16.0, k=4, cap=35, minGp=2, unit="points"),
    # NHL preset: game-to-game noise is about 2.5 goals while true team strength spreads only about
    # 0.45 goals, so a rating needs about (2.5 / 0.45)^2 = 30 games of weight before its own results
    # dominate; last season carries over strongly (fit on 2023-2026 held-out seasons, October 2026).
    "nhl":   dict(hfa=0.2, sigma=2.4, k=30, cap=None, minGp=3, unit="goals", carry=0.9),
    "nba":   dict(hfa=2.5, sigma=12.0, k=10, cap=None, minGp=0, unit="points", carry=0.65),
    "mlb":   dict(hfa=0.15, sigma=4.2, k=20, cap=None, minGp=10, unit="runs"),
    "ncaab": dict(hfa=3.0, sigma=11.0, k=6, cap=40, minGp=3, unit="points"),
    "ncaah": dict(hfa=0.25, sigma=2.4, k=6, cap=None, minGp=3, unit="goals"),
}
# Preseason prior = carry x last season's final rating. 0 means start every team at average; only the
# NBA carries last season over by default. tune.py fits carry and the other settings on past seasons and
# writes model/tuned.json; get_params() applies them only where the held-out season improved.
CACHE_VERSION = 3          # bump to force a full rescan after a scan fix
POOL = "_other"            # opponents outside the covered division (FCS, non-D-I) share one rating
PRO_ONLY = {"nfl", "nba", "nhl", "mlb"}   # games against non-members (all-star teams, 4 Nations) are dropped
# Rest: days since a team's previous game this season, capped where more rest stops mattering. A league's
# fitted settings give the edge per day (P["rest"]); 0 or missing means rest is ignored.
REST_CAP = {"nfl": 14, "ncaaf": 14, "nba": 3, "nhl": 3, "mlb": 2, "ncaab": 4, "ncaah": 3}
REST_AHEAD = 10                             # days of upcoming schedule written to the model file for rest
ALIAS = {"nhl": {"24": "129764"}}           # Arizona Coyotes -> Utah: the same roster moved in 2024
RNG = np.random.default_rng()


def alias(lg, t):
    return ALIAS.get(lg, {}).get(t, t)


def get_params(lg):
    P = dict(PARAMS[lg])
    t = (read("model/tuned.json") or {}).get(lg)
    if t and t.get("adopt") and t.get("params"):
        P.update(t["params"])
        P["tuned"] = True
    elif t and t.get("sigma"):
        # preset settings, with the home edge measured on recent seasons (when that held up out of sample)
        # and the error spread measured on past seasons
        P.update(t.get("fixedLive") or {})
        P["sigma"] = t["sigma"]
        P["sigmaMargin"] = t.get("sigmaMargin", t["sigma"])
    return P


def _day(d):
    return datetime.fromisoformat(d[:10] + "T00:00:00+00:00").toordinal()


def annotate_rest(lg, games, P):
    """Set g["restEdge"] = rest edge per day x (home rest - away rest) on every game dict, in date order.
    A team's first game counts as fully rested. Uses UTC calendar dates, as the tuner does."""
    per = P.get("rest") or 0.0
    cap = REST_CAP.get(lg, 7)
    last = {}
    for g in sorted(games, key=lambda g: g["d"]):
        o = _day(g["d"])
        rh = min(cap, o - last[g["h"]]) if g["h"] in last else cap
        ra = min(cap, o - last[g["a"]]) if g["a"] in last else cap
        g["restEdge"] = per * (rh - ra)
        last[g["h"]] = last[g["a"]] = o
    return games


def annotate_xg(lg, year, games, P):
    """NHL: set g["xgm"] = home minus away expected goals (MoneyPuck) where the game is matched."""
    if lg != "nhl" or not P.get("xg"):
        return games
    from . import extra
    try:
        lk = extra.nhl_xg_lookup(year)
    except Exception as e:
        print("NHL xG lookup failed:", str(e)[:120])
        return games
    for g in games:
        v = lk.get((g["d"][:10], g["h"], g["a"]))
        if v is not None:
            g["xgm"] = v
    return games


def target(g, P):
    """Rating input for a finished game: the real margin, blended with the expected-goals margin when tuned to."""
    m = g["hs"] - g["as"]
    if P.get("xg") and g.get("xgm") is not None:
        m = (1 - P["xg"]) * m + P["xg"] * g["xgm"]
    return m


def recency(P, dates, now=None):
    """Per-game weights: halve every hl weeks back from now (all 1 when the league has no half-life)."""
    if not P.get("hl"):
        return [1.0] * len(dates)
    now = now or datetime.now(timezone.utc)
    out = []
    for d in dates:
        try:
            t = datetime.fromisoformat(d[:16] + ":00+00:00")
            age = max(0.0, (now - t).total_seconds() / (7 * 86400))
        except ValueError:
            age = 0.0
        out.append(0.5 ** (age / P["hl"]))
    return out


def season_prior(lg, year, P, members, hfa_fn, norm_id):
    """{team: carry x rating from last season's full schedule} using stored history, or {} if there is none.
    Last season is rated with the same settings as this one, recency weighting measured from its last game."""
    from . import history
    carry = P.get("carry", 0)
    prev = history.load(lg).get(year - 1) if carry else None
    if not prev:
        return {}
    games = []
    for g in prev:
        h, a = alias(lg, g["h"]), alias(lg, g["a"])
        if lg in PRO_ONLY and (h not in members or a not in members):
            continue
        games.append(dict(g, h=h, a=a))
    annotate_rest(lg, games, P)
    annotate_xg(lg, year - 1, games, P)
    if lg == "mlb" and P.get("sp"):
        from . import extra
        extra.annotate_sp(year - 1, games, P["sp"])
    rows = [(norm_id(g["h"]), norm_id(g["a"]), target(g, P), g["n"], g) for g in games]
    rows = [r for r in rows if r[0] != r[1]]
    if not rows:
        return {}
    end = max(datetime.fromisoformat(g["d"][:16] + ":00+00:00") for g in games)
    w = recency(P, [r[4]["d"] for r in rows], end)
    R, _ = ridge(rows, members, hfa_fn, P["k"], None, P.get("cap"), P.get("soft"), w)
    seen = {t for r in rows for t in r[:2]}
    out = {t: carry * R[t] for t in seen if t in members}
    if P.get("newp") == "pool" and POOL in seen:
        # programs new to the division start where last season's outsiders were, not at the division average
        for t in members:
            out.setdefault(t, carry * R[POOL])
    return out


def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


# ---------------------------------------------------------------- games cache
def _event(e):
    c = e["competitions"][0]
    st = c["status"]["type"]
    side = {x["homeAway"]: x for x in c["competitors"]}
    if "home" not in side or "away" not in side:
        return None
    def sc(x):
        try:
            return int(float(x.get("score")))
        except (TypeError, ValueError):
            return None
    name = st.get("name", "")
    return {
        "d": e["date"][:16], "t": (e.get("season") or {}).get("type"),
        "h": side["home"]["team"]["id"], "a": side["away"]["team"]["id"],
        "hs": sc(side["home"]), "as": sc(side["away"]),
        "n": bool(c.get("neutralSite")), "cc": bool(c.get("conferenceCompetition")),
        "done": bool(st.get("completed")), "off": name in ("STATUS_CANCELED", "STATUS_POSTPONED", "STATUS_FORFEIT"),
        "wk": (e.get("week") or {}).get("number"),
    }


def _scan_espn(lg, si, cache):
    """Bring the cached season up to date. Week leagues re-read unfinished weeks; day leagues
    read each calendar date once it is final."""
    L = LEAGUES[lg]
    base = {"limit": "300"}         # ESPN ignores larger limits and falls back to 25
    if L.get("groups"):
        base["groups"] = L["groups"]
    ev = cache["events"]
    done_keys = set(cache["final"])
    now = datetime.now(timezone.utc)
    calls = 0
    if si["calendarType"] == "list" or (si["calendar"] and isinstance(si["calendar"][0], dict)):
        for block in si["calendar"]:
            if str(block.get("value")) != "2":       # regular season weeks
                continue
            for wk in block.get("entries", []):
                key = f"w{wk['value']}"
                if key in done_keys:
                    continue
                d = get(ESPN + path(lg) + "/scoreboard", dict(base, week=wk["value"], seasontype="2"))
                calls += 1
                rows = [_event(e) for e in d.get("events", [])]
                for e, r in zip(d.get("events", []), rows):
                    if r:
                        r["wk"] = r["wk"] or int(wk["value"])
                        ev[e["id"]] = r
                end = datetime.fromisoformat(wk["endDate"].replace("Z", "+00:00"))
                if end < now and all(r and (r["done"] or r["off"]) for r in rows):
                    cache["final"].append(key)
    else:
        for ds in si["calendar"]:
            day = ds[:10]
            dt = datetime.fromisoformat(day + "T12:00:00+00:00")
            if dt > now + timedelta(hours=12) or day in done_keys:
                continue
            d = get(ESPN + path(lg) + "/scoreboard", dict(base, dates=day.replace("-", "")))
            calls += 1
            rows = []
            for e in d.get("events", []):
                r = _event(e)
                if r and r["t"] == 2:
                    ev[e["id"]] = r
                rows.append(r)
            if all(r and (r["done"] or r["off"]) for r in rows) and dt < now - timedelta(hours=10):
                cache["final"].append(day)
    return calls


def _scan_cfbd(year, cache):
    """College football from CollegeFootballData when CFBD_KEY is set. CFBD team ids are ESPN ids."""
    key = os.environ.get("CFBD_KEY")
    rows = get("https://api.collegefootballdata.com/games", {"year": str(year), "seasonType": "regular"},
               headers={"Authorization": f"Bearer {key}"})
    ev = {}
    for g in rows:
        hid, aid = g.get("homeId", g.get("home_id")), g.get("awayId", g.get("away_id"))
        if hid is None or aid is None:
            continue
        hs, as_ = g.get("homePoints", g.get("home_points")), g.get("awayPoints", g.get("away_points"))
        ev[str(g["id"])] = {"d": (g.get("startDate") or g.get("start_date") or "")[:16], "t": 2, "h": str(hid), "a": str(aid),
                            "hs": hs, "as": as_, "n": bool(g.get("neutralSite", g.get("neutral_site"))),
                            "cc": bool(g.get("conferenceGame", g.get("conference_game"))),
                            "done": bool(g.get("completed")) and hs is not None, "off": False, "wk": g.get("week")}
    cache["events"] = ev
    return 1


def _from_history(lg, year):
    """A finished regular season already stored by history.py, in the games-cache format, or None."""
    h = read(f"history/{lg}_{year}.json")
    if not h or not h.get("complete"):
        return None
    ev = {}
    for i, r in enumerate(h["g"]):
        ev[f"h{year}-{i}"] = {"d": r[0], "t": 2, "h": r[1], "a": r[2], "hs": r[3], "as": r[4], "n": bool(r[5]), "cc": False,
                             "done": True, "off": False, "wk": r[6]}
    return ev


def games(lg, si):
    if si.get("type") in (3, 4):
        # regular season over (postseason / offseason): its games are final and history.py has stored them
        ev = _from_history(lg, si["year"])
        if ev:
            return ev, "ESPN scoreboard (stored season)"
    rel = f"model/_games_{lg}.json"
    cache = read(rel) or {}
    if cache.get("season") != si["year"] or cache.get("v") != CACHE_VERSION:
        cache = {"v": CACHE_VERSION, "season": si["year"], "events": {}, "final": []}
    source = "ESPN scoreboard"
    if lg == "ncaaf" and os.environ.get("CFBD_KEY"):
        try:
            _scan_cfbd(si["year"], cache)
            source = "CollegeFootballData"
        except Exception as e:
            print("CFBD failed, falling back to ESPN:", e)
            _scan_espn(lg, si, cache)
    else:
        _scan_espn(lg, si, cache)
    write(rel, cache)
    return cache["events"], source


def team_dates(lg, si, events, members):
    """{team: sorted UTC dates of its regular-season games from 14 days ago to REST_AHEAD days ahead}, horizon.
    Week leagues already hold the whole schedule in the cache; day leagues read the next days' scoreboards."""
    now = datetime.now(timezone.utc)
    lo, hi = (now - timedelta(days=14)).date().isoformat(), (now + timedelta(days=REST_AHEAD)).date().isoformat()
    seen = {}
    for g in events.values():
        if not g.get("off") and lo <= g["d"][:10] <= hi:
            seen[(g["d"][:16], alias(lg, g["h"]), alias(lg, g["a"]))] = 1
    if not (si.get("calendarType") == "list" or (si.get("calendar") and isinstance(si["calendar"][0], dict))):
        L = LEAGUES[lg]
        base = {"limit": "300"}
        if L.get("groups"):
            base["groups"] = L["groups"]
        for i in range(0, REST_AHEAD + 1):
            day = (now + timedelta(days=i)).strftime("%Y%m%d")
            try:
                d = get(ESPN + path(lg) + "/scoreboard", dict(base, dates=day))
            except Exception as e:
                print("rest: scoreboard", lg, day, "failed:", str(e)[:80])
                continue
            for e in d.get("events", []):
                r = _event(e)
                if r and r["t"] == 2 and not r["off"]:
                    seen[(r["d"][:16], alias(lg, r["h"]), alias(lg, r["a"]))] = 1
    out = {}
    for d, h, a in seen:
        for t in (h, a):
            if t in members:
                out.setdefault(t, set()).add(d[:10])
    return {t: sorted(v) for t, v in out.items()}, hi


# ---------------------------------------------------------------- ratings
def ridge(results, members, hfa_fn, k, prior=None, cap=None, soft=None, weights=None):
    """results: list of (home, away, home_margin, neutral, game). Returns ({team: rating}, {team: weight of
    evidence}), where weight of evidence = recency-weighted games played + k (the prior's weight)."""
    prior = prior or {}
    ids = sorted({t for r in results for t in r[:2]} | set(members))
    ix = {t: i for i, t in enumerate(ids)}
    n = len(ids)
    A = np.zeros((n, n))
    b = np.zeros(n)
    for gi, (h, a, m, neutral, g) in enumerate(results):
        if soft:
            m = soft * math.tanh(m / soft)
        elif cap:
            m = max(-cap, min(cap, m))
        w = weights[gi] if weights is not None else 1.0
        y = m - (0.0 if neutral else hfa_fn(g)) - g.get("restEdge", 0.0) - g.get("spEdge", 0.0)
        i, j = ix[h], ix[a]
        A[i, i] += w; A[j, j] += w; A[i, j] -= w; A[j, i] -= w
        b[i] += w * y; b[j] -= w * y
    lam = {t: (k if t != POOL else max(k, 50)) for t in ix}   # the pooled outsider is one rating for many teams
    eff = {}
    for t, i in ix.items():
        eff[t] = float(A[i, i]) + lam[t]
        A[i, i] += lam[t]
        b[i] += lam[t] * prior.get(t, 0.0)
    r = np.linalg.solve(A, b)
    return {t: float(r[ix[t]]) for t in ids}, eff


def _standings_map(lg):
    st = read(f"standings/{lg}.json") or {}
    out = {}
    for g in st.get("groups", []):
        for r in g["teams"]:
            out[r["id"]] = dict(r, group=g.get("name"), parent=g.get("parent"))
    return out


def _members(lg):
    idx = read("teams.json") or {}
    ids = [t["id"] for t in idx.get("leagues", {}).get(lg, [])]
    return ids or list(_standings_map(lg))


def _nba_prior(year):
    """0.65 x last regular season's point margin per game."""
    from .espn import standings
    last = standings("nba", season=year - 1)
    out = {}
    for g in last["groups"]:
        for r in g["teams"]:
            gp = r.get("gp") or ((r.get("w") or 0) + (r.get("l") or 0))
            if gp and r.get("pf") is not None and r.get("pa") is not None:
                out[r["id"]] = 0.65 * (r["pf"] - r["pa"]) / gp
    return out


def context(lg, smap=None, members=None):
    """Pieces shared by the live model and the track-record backtest: each team's division or
    conference, the home edge for a game, and how outside teams collapse into the pooled rating."""
    P = get_params(lg)
    smap = smap if smap is not None else _standings_map(lg)
    members = members if members is not None else set(_members(lg))
    group = {t: smap.get(t, {}).get("group") for t in members}

    def hfa_fn(g):
        if P.get("divHfa") is not None and group.get(g["h"]) and group.get(g["h"]) == group.get(g["a"]):
            return P["divHfa"]
        return P["hfa"]

    def norm_id(t):
        return t if (t in members or not members) else POOL
    return group, hfa_fn, norm_id


def build(lg):
    global RNG
    P = get_params(lg)
    si = season_info(lg)
    smap = _standings_map(lg)
    members = set(_members(lg))
    res = {"lg": lg, "season": si["year"], "seasonType": si["type"], "hfa": P["hfa"], "sigma": P["sigma"],
           "sigmaMargin": P.get("sigmaMargin", P["sigma"]),
           "k": P["k"], "unit": P["unit"], "minGp": P["minGp"], "teams": {}, "odds": None}
    if P.get("divHfa") is not None:
        res["divHfa"] = P["divHfa"]

    if lg == "mlb" and not P.get("tuned"):
        # Full-season run margin from the standings (162 games makes schedule adjustment negligible).
        # Once tune.py has a game-by-game MLB fit that beats this on past seasons, the general path below runs instead.
        for tid, r in smap.items():
            gp = r.get("gp") or 0
            if gp and r.get("pf") is not None:
                mov = (r["pf"] - r["pa"]) / gp
                res["teams"][tid] = {"rating": round(mov * gp / (gp + P["k"]), 2), "gp": gp, "mov": round(mov, 2)}
        res["basis"] = "Regular-season run margin per game, regressed with 20 games of league-average weight."
        res["source"] = "ESPN standings"
    else:
        events, source = games(lg, si)
        res["source"] = source
        played = [dict(g, h=alias(lg, g["h"]), a=alias(lg, g["a"])) for g in events.values()
                  if g["done"] and g["hs"] is not None and g["as"] is not None]
        if lg in PRO_ONLY:
            played = [g for g in played if g["h"] in members and g["a"] in members]
        annotate_rest(lg, played, P)
        if lg == "mlb" and P.get("sp"):
            from . import extra
            extra.annotate_sp(si["year"], played, P["sp"])       # starting-pitcher edge comes out of the results
        group, hfa_fn, norm_id = context(lg, smap, members)
        annotate_xg(lg, si["year"], played, P)
        results = [(norm_id(g["h"]), norm_id(g["a"]), target(g, P), g["n"], g) for g in played]
        results = [r for r in results if r[0] != r[1]]
        prior = season_prior(lg, si["year"], P, members, hfa_fn, norm_id)
        if prior:
            res["prior"] = f"{P['carry']:g} x last season's rating"
        elif lg == "nba":
            try:
                prior = _nba_prior(si["year"])
                res["prior"] = "0.65 x last season's point margin per game"
            except Exception as e:
                print("NBA prior failed:", e)
        R, eff = ridge(results, members, hfa_fn, P["k"], prior, P.get("cap"), P.get("soft"), recency(P, [r[4]["d"] for r in results]))
        # Same inputs -> same simulation, so the committed files only change when a result does.
        RNG = np.random.default_rng(zlib.crc32(json.dumps([sorted((r[0], r[1], r[2]) for r in results),
                                                              sorted((t, v.get("gp"), v.get("pts")) for t, v in smap.items())]).encode()))
        gp = collections.Counter(); margin = collections.Counter(); opp = collections.defaultdict(list)
        for h, a, _, n, g in results:
            m = g["hs"] - g["as"]                          # per-game margin shown on pages stays the real score
            for t, o, mm in ((h, a, m), (a, h, -m)):
                gp[t] += 1; margin[t] += mm; opp[t].append(o)
        for t in members:
            if t not in R:
                continue
            row = {"rating": round(R[t], 2), "gp": gp[t], "w": round(eff[t], 2)}
            if gp[t]:
                row["mov"] = round(margin[t] / gp[t], 2)
                row["sos"] = round(float(np.mean([R[o] for o in opp[t]])), 2)
            if t in prior:
                row["prior"] = round(prior[t], 2)
            res["teams"][t] = row
        res["games"] = len(results)
        if lg in ("nfl", "ncaaf"):
            # strength of schedule still to play: week-based leagues publish the whole regular season up front
            rem = collections.defaultdict(list)
            for g in events.values():
                if g.get("done") or g.get("off") or g.get("t") not in (2, None):
                    continue
                h, a = norm_id(alias(lg, g["h"])), norm_id(alias(lg, g["a"]))
                if h == a or h not in R or a not in R:
                    continue
                rem[h].append((R[a], not g.get("n")))
                rem[a].append((R[h], False))
            for t, row in res["teams"].items():
                lst = rem.get(t, [])
                row["left"] = len(lst)
                if lst:
                    row["sosRem"] = round(float(np.mean([x[0] for x in lst])), 2)
                    row["homeLeft"] = sum(1 for x in lst if x[1])
        if P.get("rest"):
            # each team's game dates from two weeks back to REST_AHEAD days ahead, so pages can work out rest
            res["rest"], res["restCap"] = P["rest"], REST_CAP.get(lg, 7)
            dates, horizon = team_dates(lg, si, events, members)
            res["restUntil"] = horizon
            for t, ds in dates.items():
                if t in res["teams"]:
                    res["teams"][t]["dates"] = ds
        if lg == "mlb" and P.get("sp"):
            from . import extra
            try:
                res["sp"] = P["sp"]
                res["spEdges"] = extra.upcoming_sp(si["year"], P["sp"])     # announced starters, next 7 days
            except Exception as e:
                print("MLB starters failed:", str(e)[:120])
        res["pv"] = bool(P.get("pv"))
        if lg == "nhl" and P.get("xg"):
            res["xg"] = P["xg"]
            res["xgGames"] = sum(1 for r in results if r[4].get("xgm") is not None)
        if P.get("hl"):
            res["hl"] = P["hl"]
        if P.get("soft"):
            res["soft"] = P["soft"]
        res["basis"] = (f"Ridge-regularised SRS from {len(results)} completed games, home edge removed"
                        + (f", margins capped at {P['cap']}" if P.get("cap") else "")
                        + (f", blowouts damped (soft limit {P['soft']})" if P.get("soft") else "")
                        + (f", recent games weighted more (half-life {P['hl']} weeks)" if P.get("hl") else "")
                        + (f", rest days counted ({P['rest']:g} per day of rest advantage)" if P.get("rest") else "")
                        + (", starting pitchers counted (MLB Stats API)" if lg == "mlb" and P.get("sp") else "")
                        + (f", each game's result {P['xg']:.0%} expected goals (MoneyPuck.com)" if lg == "nhl" and P.get("xg") else "")
                        + f", each team pulled toward {'last season' if prior else 'average'} with {P['k']:g} games of weight"
                        + (", win probabilities widened while ratings are still uncertain." if P.get("pv") else "."))
        res["tuned"] = bool(P.get("tuned"))
        if lg == "nfl":
            res["odds"], res["oddsBasis"] = nfl_odds(res, events, smap)
        if lg == "nhl":
            res["odds"], res["oddsBasis"] = nhl_odds(res, smap)

    ranked = sorted(res["teams"], key=lambda t: -res["teams"][t]["rating"])
    for i, t in enumerate(ranked):
        res["teams"][t]["rank"] = i + 1
    for t, row in res["teams"].items():
        g = smap.get(t)
        if g:
            row["group"] = g.get("group")
    write(f"model/{lg}.json", res)
    return {"teams": len(res["teams"]), "games": res.get("games"), "odds": bool(res["odds"])}


# ---------------------------------------------------------------- NFL season simulation
def nfl_odds(res, events, smap, N=10000):
    ids = sorted(t for t in res["teams"] if t in smap)
    if len(ids) != 32:
        return None, f"skipped: standings list {len(ids)} teams"
    ix = {t: i for i, t in enumerate(ids)}
    div = {t: smap[t]["group"] for t in ids}
    conf = {t: ("AFC" if "AFC" in (div[t] or "") or "American" in (smap[t].get("parent") or "") else "NFC") for t in ids}
    T = res["teams"]
    rating = np.array([T[t]["rating"] for t in ids])
    weight = np.array([T[t].get("w") or (T[t]["gp"] + res["k"]) for t in ids], float)
    SIG, HFA, DIVH = res["sigma"], res["hfa"], res.get("divHfa", res["hfa"])
    unc = SIG / np.sqrt(weight)
    true = rating[None, :] + RNG.normal(0, 1, (N, 32)) * unc[None, :]
    drift = PARAMS["nfl"].get("drift", 0.0)          # variance per team per week (points^2)
    now_wk = min((g.get("wk") or 99) for g in events.values() if not g["done"] and not g["off"] and g.get("t") == 2) if any(
        not g["done"] and not g["off"] and g.get("t") == 2 for g in events.values()) else 99
    # one random walk per simulation, built week by week in order, so a team's form carries from week to week
    walks, cur, last = {}, true, now_wk
    if drift:
        for wk in sorted({g["wk"] for g in events.values() if g.get("wk") and g["wk"] > now_wk and not g["done"] and not g["off"]}):
            cur = cur + RNG.normal(0, math.sqrt(drift * (wk - last)), (N, 32))
            walks[wk], last = cur, wk

    def strength(wk):
        """true strength in a future week: today's draw plus the walk up to that week."""
        return walks.get(wk, true) if wk is not None else true
    wins = np.zeros((N, 32)); divw = np.zeros((N, 32)); pdiff = np.zeros((N, 32))
    hfa = lambda h, a: DIVH if div[h] == div[a] else HFA
    if res.get("rest"):
        sched = [dict(g) for g in events.values() if g.get("t") == 2 and not g["off"]]
        annotate_rest("nfl", sched, {"rest": res["rest"]})
        redge = {(g["d"], g["h"], g["a"]): g["restEdge"] for g in sched}
    else:
        redge = {}
    played = rem = 0
    for g in events.values():
        if g.get("t") != 2 or g["off"] or g["h"] not in ix or g["a"] not in ix:
            continue
        h, a = ix[g["h"]], ix[g["a"]]
        same = div[g["h"]] == div[g["a"]]
        if g["done"] and g["hs"] is not None:
            played += 1
            m = g["hs"] - g["as"]
            hw = 1.0 if m > 0 else (0.5 if m == 0 else 0.0)
            wins[:, h] += hw; wins[:, a] += 1 - hw; pdiff[:, h] += m; pdiff[:, a] -= m
            if same:
                divw[:, h] += hw; divw[:, a] += 1 - hw
        else:
            rem += 1
            tr = strength(g.get("wk"))
            m = (tr[:, h] - tr[:, a] + (0 if g["n"] else hfa(g["h"], g["a"])) + redge.get((g["d"], g["h"], g["a"]), 0.0)
                 + RNG.normal(0, SIG, N))
            hw = m > 0
            wins[:, h] += hw; wins[:, a] += ~hw; pdiff[:, h] += m; pdiff[:, a] -= m
            if same:
                divw[:, h] += hw; divw[:, a] += ~hw
    if played + rem < 200:
        return None, f"skipped: only {played + rem} regular-season games in the cache"
    tb = wins + divw * 1e-3 + pdiff * 1e-6 + RNG.random((N, 32)) * 1e-9
    divs = collections.defaultdict(list)
    for t in ids:
        divs[div[t]].append(ix[t])
    P = {t: collections.Counter() for t in ids}

    end = walks[max(walks)] if walks else true    # strength at season's end for the playoffs

    def play(hi, lo, s, neutral=False):
        m = end[s, hi] - end[s, lo] + (0 if neutral else HFA) + RNG.normal(0, SIG)
        return hi if m > 0 else lo
    for s in range(N):
        champs = {}
        for c in ("AFC", "NFC"):
            dws = [max(v, key=lambda i: tb[s, i]) for d, v in divs.items() if conf[ids[v[0]]] == c]
            dws.sort(key=lambda i: -tb[s, i])
            rest = sorted([ix[t] for t in ids if conf[t] == c and ix[t] not in dws], key=lambda i: -tb[s, i])[:3]
            seeds = dws + rest
            for j, i in enumerate(seeds):
                P[ids[i]]["playoff"] += 1
                if j < 4: P[ids[i]]["div"] += 1
                if j == 0: P[ids[i]]["seed1"] += 1
            alive = [seeds[0]] + [play(seeds[a], seeds[b], s) for a, b in ((1, 6), (2, 5), (3, 4))]
            alive.sort(key=seeds.index)
            w1, w2 = play(alive[0], alive[3], s), play(alive[1], alive[2], s)
            pair = sorted([w1, w2], key=seeds.index)
            ch = play(pair[0], pair[1], s)
            P[ids[ch]]["conf"] += 1
            champs[c] = ch
        P[ids[play(champs["AFC"], champs["NFC"], s, neutral=True)]]["title"] += 1
    out = {}
    for t in ids:
        w = wins[:, ix[t]]
        out[t] = {"wins": round(float(w.mean()), 1), "w10": round(float(np.percentile(w, 10)), 1), "w90": round(float(np.percentile(w, 90)), 1),
                  "playoff": round(P[t]["playoff"] / N, 3), "div": round(P[t]["div"] / N, 3), "seed1": round(P[t]["seed1"] / N, 3),
                  "conf": round(P[t]["conf"] / N, 3), "title": round(P[t]["title"] / N, 3)}
    return out, (f"{N:,} simulations of the {rem} remaining regular-season games, each team's strength drifting week to week, then the 14-team bracket "
                 "(division winners seeded 1-4, three wild cards). Tiebreakers simplified to division record, then point margin.")


# ---------------------------------------------------------------- NHL season simulation
def nhl_odds(res, smap, N=10000):
    ids = sorted(t for t in res["teams"] if t in smap)
    if len(ids) < 30:
        return None, f"skipped: standings list {len(ids)} teams"
    ix = {t: i for i, t in enumerate(ids)}
    n = len(ids)
    div = {t: smap[t]["group"] for t in ids}
    conf = {t: smap[t].get("parent") or div[t] for t in ids}
    has_div = len(set(div.values())) > len(set(conf.values()))
    SIG, HFA = res["sigma"], res["hfa"]
    T = res["teams"]
    gp = np.array([smap[t].get("gp") or 0 for t in ids], float)
    pts0 = np.array([smap[t].get("pts") or 0 for t in ids], float)
    rating = np.array([T[t]["rating"] for t in ids])
    weight = np.array([T[t].get("w") or (T[t]["gp"] + res["k"]) for t in ids], float)
    tr = rating[None, :] + RNG.normal(0, 1, (N, n)) * (SIG / np.sqrt(weight))[None, :]
    pts = np.tile(pts0, (N, 1))
    for i in range(n):
        rem = int(max(0, 82 - gp[i]))
        if not rem:
            continue
        for home, cnt in ((True, rem // 2), (False, rem - rem // 2)):
            p = np.array([phi(x) for x in ((tr[:, i] + (HFA if home else -HFA)) / SIG)])
            pot = 0.5 + (p - 0.5) * 0.4                 # ~23% of games reach OT/SO, closer to a coin flip
            q = (p - 0.23 * pot) / 0.77
            reg = RNG.random((N, cnt)) >= 0.23
            u = RNG.random((N, cnt))
            win = np.where(reg, u < q[:, None], u < pot[:, None])
            pts[:, i] += (win * 2 + (~win & ~reg) * 1).sum(axis=1)
    pts += RNG.random((N, n)) * 1e-3
    P = {t: collections.Counter() for t in ids}
    confs = sorted(set(conf.values()))

    def series(hi, lo, s):
        pa = phi((tr[s, hi] - tr[s, lo] + HFA) / SIG); pb = phi((tr[s, hi] - tr[s, lo] - HFA) / SIG)
        a = b = 0
        for home in (1, 1, 0, 0, 1, 0, 1):
            if a == 4 or b == 4:
                break
            if RNG.random() < (pa if home else pb): a += 1
            else: b += 1
        return hi if a == 4 else lo
    for s in range(N):
        finals = []
        for c in confs:
            members = [ix[t] for t in ids if conf[t] == c]
            key = lambda i: -pts[s, i]
            if has_div:
                dnames = sorted({div[ids[i]] for i in members})
                tops, used = {}, set()
                for d in dnames:
                    top3 = sorted([i for i in members if div[ids[i]] == d], key=key)[:3]
                    tops[d] = top3; used.update(top3)
                    P[ids[top3[0]]]["div"] += 1
                wc = sorted([i for i in members if i not in used], key=key)[:2]
                field = list(used) + wc
                d1, d2 = sorted(dnames, key=lambda d: key(tops[d][0]))
                r1 = [series(tops[d1][0], wc[1], s), series(tops[d1][1], tops[d1][2], s),
                      series(tops[d2][0], wc[0], s), series(tops[d2][1], tops[d2][2], s)]
            else:
                field = sorted(members, key=key)[:8]
                r1 = [series(field[a], field[b], s) for a, b in ((0, 7), (3, 4), (1, 6), (2, 5))]
            for i in field:
                P[ids[i]]["playoff"] += 1
            r2 = [series(*sorted(r1[:2], key=key), s), series(*sorted(r1[2:], key=key), s)]
            cf = series(*sorted(r2, key=key), s)
            P[ids[cf]]["conf"] += 1
            finals.append(cf)
        P[ids[series(*sorted(finals, key=lambda i: -pts[s, i]), s)]]["title"] += 1
    out = {}
    for t in ids:
        i = ix[t]
        out[t] = {"pts": round(float(pts[:, i].mean()), 1), "p10": int(np.percentile(pts[:, i], 10)), "p90": int(np.percentile(pts[:, i], 90)),
                  "playoff": round(P[t]["playoff"] / N, 3), "conf": round(P[t]["conf"] / N, 3), "title": round(P[t]["title"] / N, 3)}
        if has_div:
            out[t]["div"] = round(P[t]["div"] / N, 3)
    return out, (f"{N:,} simulations of each team's remaining games against a league-average opponent (half at home), "
                 "about 23% reaching overtime, then the 16-team bracket" + (" by division." if has_div else " by conference."))


def job_model():
    out = {}
    for lg in PARAMS:
        try:
            out[lg] = build(lg)
        except Exception as e:
            import traceback; traceback.print_exc()
            out[lg] = f"error: {e}"[:200]
    if all(isinstance(v, str) for v in out.values()):
        raise RuntimeError(f"all models failed: {out}")
    return out
