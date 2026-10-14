"""House ratings, game projections and playoff odds for every team league.

Ratings are a ridge-regularised SRS: each team's rating is the points-per-game margin it would
post against an average opponent on a neutral field, solved from every completed game with home
advantage removed, and pulled toward a prior (0, or last season for the NBA) with the weight of
`k` games. That is the same shrinkage as SRS x GP/(GP+k) on the methodology page, but it stays
stable early in a season and in college, where schedules barely connect.

  P(home wins) = Phi((rating_home - rating_away + HFA) / sigma)

Season simulations (NFL, NHL) replay the rest of the schedule thousands of times with the
ratings plus their uncertainty, then apply each league's playoff format.

Completed games are cached in data/sports/model/_games_{lg}.json so each hourly run only asks
ESPN for the days or weeks that are not final yet."""
import collections
import json
import math
import zlib
import os
from datetime import datetime, timedelta, timezone

import numpy as np

from .common import ESPN, get, read, write, now_iso
from .espn import season_info
from .leagues import LEAGUES, path

PARAMS = {
    #        HFA    div HFA  sigma  k (prior weight in games)  margin cap  min GP before showing projections
    "nfl":   dict(hfa=1.8, divHfa=0.9, sigma=13.5, k=5, cap=None, minGp=1, unit="points"),
    "ncaaf": dict(hfa=2.5, sigma=16.0, k=4, cap=35, minGp=2, unit="points"),
    "nhl":   dict(hfa=0.2, sigma=2.4, k=10, cap=None, minGp=3, unit="goals"),
    "nba":   dict(hfa=2.5, sigma=12.0, k=10, cap=None, minGp=0, unit="points"),
    "mlb":   dict(hfa=0.15, sigma=4.2, k=20, cap=None, minGp=10, unit="runs"),
    "ncaab": dict(hfa=3.0, sigma=11.0, k=6, cap=40, minGp=3, unit="points"),
    "ncaah": dict(hfa=0.25, sigma=2.4, k=6, cap=None, minGp=3, unit="goals"),
}
CACHE_VERSION = 3          # bump to force a full rescan after a scan fix
POOL = "_other"            # opponents outside the covered division (FCS, non-D-I) share one rating
RNG = np.random.default_rng()


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


def games(lg, si):
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


# ---------------------------------------------------------------- ratings
def ridge(results, members, hfa_fn, k, prior=None, cap=None):
    """results: list of (home, away, home_margin, neutral, game). Returns {team: rating}."""
    prior = prior or {}
    ids = sorted({t for r in results for t in r[:2]} | set(members))
    ix = {t: i for i, t in enumerate(ids)}
    n = len(ids)
    A = np.zeros((n, n))
    b = np.zeros(n)
    for h, a, m, neutral, g in results:
        if cap:
            m = max(-cap, min(cap, m))
        y = m - (0.0 if neutral else hfa_fn(g))
        i, j = ix[h], ix[a]
        A[i, i] += 1; A[j, j] += 1; A[i, j] -= 1; A[j, i] -= 1
        b[i] += y; b[j] -= y
    for t, i in ix.items():
        lam = k if t != POOL else max(k, 50)     # the pooled outsider is one rating for many teams
        A[i, i] += lam
        b[i] += lam * prior.get(t, 0.0)
    r = np.linalg.solve(A, b)
    return {t: float(r[ix[t]]) for t in ids}


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
    P = PARAMS[lg]
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
    P = PARAMS[lg]
    si = season_info(lg)
    smap = _standings_map(lg)
    members = set(_members(lg))
    res = {"lg": lg, "season": si["year"], "seasonType": si["type"], "hfa": P["hfa"], "sigma": P["sigma"],
           "k": P["k"], "unit": P["unit"], "minGp": P["minGp"], "teams": {}, "odds": None}
    if P.get("divHfa") is not None:
        res["divHfa"] = P["divHfa"]

    if lg == "mlb":
        # Full-season run margin from the standings (162 games makes schedule adjustment negligible).
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
        played = [g for g in events.values() if g["done"] and g["hs"] is not None and g["as"] is not None]
        group, hfa_fn, norm_id = context(lg, smap, members)
        results = [(norm_id(g["h"]), norm_id(g["a"]), g["hs"] - g["as"], g["n"], g) for g in played]
        results = [r for r in results if r[0] != r[1]]
        prior = {}
        if lg == "nba":
            try:
                prior = _nba_prior(si["year"])
                res["prior"] = "0.65 x last season's point margin per game"
            except Exception as e:
                print("NBA prior failed:", e)
        R = ridge(results, members, hfa_fn, P["k"], prior, P["cap"])
        # Same inputs -> same simulation, so the committed files only change when a result does.
        RNG = np.random.default_rng(zlib.crc32(json.dumps([sorted((r[0], r[1], r[2]) for r in results),
                                                              sorted((t, v.get("gp"), v.get("pts")) for t, v in smap.items())]).encode()))
        gp = collections.Counter(); margin = collections.Counter(); opp = collections.defaultdict(list)
        for h, a, m, n, g in results:
            for t, o, mm in ((h, a, m), (a, h, -m)):
                gp[t] += 1; margin[t] += mm; opp[t].append(o)
        for t in members:
            if t not in R:
                continue
            row = {"rating": round(R[t], 2), "gp": gp[t]}
            if gp[t]:
                row["mov"] = round(margin[t] / gp[t], 2)
                row["sos"] = round(float(np.mean([R[o] for o in opp[t]])), 2)
            if t in prior:
                row["prior"] = round(prior[t], 2)
            res["teams"][t] = row
        res["games"] = len(results)
        res["basis"] = (f"Ridge-regularised SRS from {len(results)} completed games, home edge removed"
                        + (f", margins capped at {P['cap']}" if P["cap"] else "")
                        + f", each team pulled toward {'last season' if prior else 'average'} with {P['k']} games of weight.")
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
    gp = np.array([T[t]["gp"] for t in ids], float)
    unc = 13.5 / np.sqrt(gp + 5)
    true = rating[None, :] + RNG.normal(0, 1, (N, 32)) * unc[None, :]
    wins = np.zeros((N, 32)); divw = np.zeros((N, 32)); pdiff = np.zeros((N, 32))
    hfa = lambda h, a: 0.9 if div[h] == div[a] else 1.8
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
            m = true[:, h] - true[:, a] + (0 if g["n"] else hfa(g["h"], g["a"])) + RNG.normal(0, 13.5, N)
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

    def play(hi, lo, s, neutral=False):
        m = true[s, hi] - true[s, lo] + (0 if neutral else 1.8) + RNG.normal(0, 13.5)
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
    return out, (f"{N:,} simulations of the {rem} remaining regular-season games, then the 14-team bracket "
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
    T = res["teams"]
    gp = np.array([smap[t].get("gp") or 0 for t in ids], float)
    pts0 = np.array([smap[t].get("pts") or 0 for t in ids], float)
    rating = np.array([T[t]["rating"] for t in ids])
    tr = rating[None, :] + RNG.normal(0, 1, (N, n)) * (2.4 / np.sqrt(gp + 10))[None, :]
    pts = np.tile(pts0, (N, 1))
    for i in range(n):
        rem = int(max(0, 82 - gp[i]))
        if not rem:
            continue
        for home, cnt in ((True, rem // 2), (False, rem - rem // 2)):
            p = np.array([phi(x) for x in ((tr[:, i] + (0.2 if home else -0.2)) / 2.4)])
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
        pa = phi((tr[s, hi] - tr[s, lo] + 0.2) / 2.4); pb = phi((tr[s, hi] - tr[s, lo] - 0.2) / 2.4)
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
