"""NFL quarterback adjustment.

The house ratings come from margins, so they carry a team's *usual* quarterback but cannot see a change.
On 2,895 NFL games (2014-2025) the betting market disagreed with the ratings by 1.5-1.9 points whenever a team
started a different QB than in its previous game, and a QB-quality feature learned only from game outcomes
improved held-out log loss (see data/sports/model/qb.json for the current fit).

Feature, per game and side:
  rating  = EPA per dropback of the starting QB before this game (recent seasons weighted more: half-life HL
            seasons; shrunk toward replacement level with PN dropbacks of prior)
  usual   = mean rating of the team's starters in its previous NH games this season (as rated at the time)
  shift   = (rating - usual) x DB    (points per game; DB = dropbacks per game)
  edge    = BETA x (home shift - away shift)        added to the projected home margin

Data: nflverse (github.com/nflverse/nflverse-data, CC-BY 4.0) player stats per week and nfldata games.csv,
which lists the starting QB of every game, including the expected starter of upcoming ones.

  history/nfl_qb.json   {"through": last full season, "perf": {qb id: [[season, week, epa, dropbacks]]}, "names": {qb id: name}}
  model/qb.json         the fit: beta, the grid winner, held-out gain
  model/nfl.json        qbEdges {"start|home|away": points}, qbInfo {same key: {"h": [name, shift], "a": [name, shift]}}"""
import collections
import csv
import io
import math

import numpy as np

from .common import SESSION, UA, read, write, now_iso

NV = "https://github.com/nflverse/nflverse-data/releases/download/"
GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
FIRST, FIRST_FIT = 2010, 2014
HL, PN, NH, MU, DB = 2.0, 400.0, 16, -0.08, 35.0
CAP = 8.0                                     # no single game moves more than this many points
AB2ID = {"ARI": "22", "ATL": "1", "BAL": "33", "BUF": "2", "CAR": "29", "CHI": "3", "CIN": "4", "CLE": "5", "DAL": "6",
         "DEN": "7", "DET": "8", "GB": "9", "HOU": "34", "IND": "11", "JAX": "30", "KC": "12", "LA": "14", "LAC": "24",
         "LV": "13", "MIA": "15", "MIN": "16", "NE": "17", "NO": "18", "NYG": "19", "NYJ": "20", "OAK": "13", "PHI": "21",
         "PIT": "23", "SD": "24", "SEA": "26", "SF": "25", "STL": "14", "TB": "27", "TEN": "10", "WAS": "28", "WSH": "28",
         "JAC": "30", "LAR": "14"}


def _csv(url):
    r = SESSION.get(url, headers={"User-Agent": UA}, timeout=180)
    if r.status_code != 200:
        raise RuntimeError(f"{url.rsplit('/', 1)[-1]}: HTTP {r.status_code}")
    return csv.DictReader(io.StringIO(r.text))


def _season_perf(year):
    """{qb id: [[season, week, epa, dropbacks], ...]} and names for one season's regular-season games."""
    name = f"stats_player/stats_player_week_{year}" if year >= 2025 else f"player_stats/player_stats_{year}"
    perf, names = collections.defaultdict(list), {}
    for r in _csv(f"{NV}{name.split('/')[0]}/{name.split('/')[1]}.csv"):
        if r.get("position") != "QB" or r.get("season_type") != "REG":
            continue
        att = float(r.get("attempts") or 0)
        sk = float(r.get("sacks") or r.get("sacks_suffered") or 0)
        if att + sk < 5:
            continue
        perf[r["player_id"]].append([int(r["season"]), int(r["week"]), round(float(r.get("passing_epa") or 0), 3), int(att + sk)])
        names[r["player_id"]] = r.get("player_display_name") or r.get("player_name") or ""
    return perf, names


def job_history():
    """Past seasons' quarterback performance, saved once per season (the current season is fetched on each run)."""
    cur = (read("model/nfl.json") or {}).get("season")          # the model file already knows the current season
    if not cur:
        raise RuntimeError("model/nfl.json has no season yet")
    have = read("history/nfl_qb.json") or {"through": FIRST - 1, "perf": {}, "names": {}}
    perf, names = have["perf"], have["names"]
    for y in range(have["through"] + 1, cur):
        p, n = _season_perf(y)
        for q, rows in p.items():
            perf.setdefault(q, [])
            perf[q] = [x for x in perf[q] if x[0] != y] + rows
        names.update(n)
    write("history/nfl_qb.json", {"through": cur - 1, "perf": perf, "names": names})
    return {"through": cur - 1, "qbs": len(perf)}


def load_perf(cur=None):
    """History plus the current season's weeks so far."""
    have = read("history/nfl_qb.json")
    if not have:
        return None, None
    perf = {q: [tuple(x) for x in rows] for q, rows in have["perf"].items()}
    names = dict(have["names"])
    if cur and cur > have["through"]:
        try:
            p, n = _season_perf(cur)
        except Exception:
            p, n = {}, {}                    # season not published yet: ratings stay on history
        for q, rows in p.items():
            perf[q] = [x for x in perf.get(q, []) if x[0] != cur] + [tuple(x) for x in rows]
        names.update(n)
    for q in perf:
        perf[q].sort()
    return perf, names


def qb_rating(perf, qid, season, week):
    """EPA per dropback from games strictly before (season, week), recent seasons weighted more, shrunk to replacement."""
    e = n = 0.0
    for s, w, epa, db in perf.get(qid, ()):
        if (s, w) >= (season, week):
            break
        wt = 0.5 ** ((season - s) / HL)
        e += epa * wt
        n += db * wt
    return (e + MU * PN) / (n + PN)


def shifts(perf, games):
    """Walk one season's games (dicts with gameday, week, home_team, away_team, home_qb_id, away_qb_id) in date order.
    Yields (game, home shift, away shift, home rating, away rating) in points per game; a side with no starter listed
    or no earlier game this season shifts by 0."""
    recent = collections.defaultdict(list)
    out = []
    for g in sorted(games, key=lambda x: (x["gameday"], x["home_team"])):
        wk, season, sh = int(g["week"]), int(g["season"]), []
        for side in ("home", "away"):
            t, q = g[side + "_team"], g[side + "_qb_id"]
            if not q:
                sh.append((0.0, None))
                continue
            rt = qb_rating(perf, q, season, wk)
            hist = recent[t][-NH:]
            sh.append(((rt - float(np.mean(hist))) * DB if hist else 0.0, rt))
            recent[t].append(rt)
        out.append((g, sh[0][0], sh[1][0], sh[0][1], sh[1][1]))
    return out


# ---------------------------------------------------------------- the fit (history/tune job)
def job_fit():
    """Fit BETA on 2014+ seasons, walk-forward, and record whether it earns its place."""
    from . import tune as T
    from .model import phi
    perf, _ = load_perf()
    if not perf:
        return {"adopt": False, "reason": "no history/nfl_qb.json; run the history job first"}
    L = T.League("nfl")
    p = (read("model/tuned.json") or {}).get("nfl", {}).get("params") or {}
    if not p:
        return {"adopt": False, "reason": "NFL not tuned yet"}
    games = {}
    for r in _csv(GAMES_URL):
        if r["game_type"] == "REG" and r["home_score"] not in ("", None):
            games.setdefault(int(r["season"]), []).append(r)
    covid = T.COVID.get("nfl", set())
    years = [y for y in L.years if y >= FIRST_FIT and y not in covid and (y - 1) in L.seasons and y in games]
    if len(years) < 5:
        return {"adopt": False, "reason": f"needs 5 seasons, have {years}"}
    P, A, F, Y = [], [], [], []
    for y in years:
        S = L.seasons[y]
        pr, _ = T.replay(L, S, p, T.prior_for(L, y, p))
        by = {(AB2ID.get(g["home_team"]), AB2ID.get(g["away_team"])): (g, hs, as_) for g, hs, as_, *_ in shifts(perf, games[y])}
        ids = {i: t for t, i in L.ix.items()}
        f = np.zeros(len(S.m))
        for k in range(len(S.m)):
            hit = by.get((ids.get(S.h[k]), ids.get(S.a[k])))
            if hit:
                f[k] = hit[1] - hit[2]
        P.append(pr); A.append(S.m); F.append(f); Y.append(np.full(len(S.m), y))
    P, A, F, Y = map(np.concatenate, (P, A, F, Y))

    def ll(m, a, s):
        q = np.clip(np.array([phi(x / s) for x in m]), 1e-4, 1 - 1e-4)
        y = (a > 0).astype(float)
        return -(y * np.log(q) + (1 - y) * np.log(1 - q))
    folds, base_all, new_all = [], [], []
    for ty in [y for y in years if y >= years[0] + 4]:
        tr, te = Y < ty, Y == ty
        beta = float(np.sum(F[tr] * (A - P)[tr]) / np.sum(F[tr] ** 2))              # no intercept: the home edge is not this feature's job
        s0 = math.sqrt(np.mean((A[tr] - P[tr]) ** 2))
        b, n = ll(P[te], A[te], s0), ll(P[te] + beta * F[te], A[te], s0)
        folds.append({"holdout": ty, "beta": round(beta, 3), "gain": round(float(b.mean() - n.mean()), 5)})
        base_all.append(b); new_all.append(n)
    d = np.concatenate(base_all) - np.concatenate(new_all)
    gain, z = float(d.mean()), float(d.mean() / (d.std() / math.sqrt(len(d))))
    beta = float(np.sum(F * (A - P)) / np.sum(F ** 2))
    better = sum(1 for f in folds if f["gain"] > 0)
    adopt = gain >= 0.002 and z >= 2.0 and better >= len(folds) - 1
    out = {"adopt": bool(adopt), "beta": round(beta, 3), "gain": round(gain, 5), "z": round(z, 2), "folds": folds,
           "foldsImproved": f"{better}/{len(folds)}", "games": int(len(d)), "seasons": [years[0], years[-1]], "updated": now_iso(),
           "settings": {"halfLifeSeasons": HL, "priorDropbacks": PN, "usualStarters": NH, "dropbacksPerGame": DB, "cap": CAP},
           "corrWithOutcomeResidual": round(float(np.corrcoef(F, A - P)[0, 1]), 3)}
    write("model/qb.json", out)
    return {k: out[k] for k in ("adopt", "beta", "gain", "z", "foldsImproved")}


# ---------------------------------------------------------------- the live edges
def apply():
    """Write qbEdges / qbInfo into model/nfl.json for games that have not been played."""
    fit = read("model/qb.json") or {}
    model = read("model/nfl.json")
    if not model or not model.get("teams"):
        return None
    for k in ("qbEdges", "qbInfo", "qbBeta"):
        model.pop(k, None)
    base = (model.get("basis") or "").replace(MARK, "")
    model["basis"] = base
    if not fit.get("adopt"):
        write("model/nfl.json", model)
        return {"adopt": False}
    cur = model.get("season")
    perf, names = load_perf(cur)
    if not perf:
        write("model/nfl.json", model)
        return {"adopt": False, "reason": "no QB history"}
    rows = [r for r in _csv(GAMES_URL) if r["season"] == str(cur) and r["game_type"] == "REG"]
    cache = (read("model/_games_nfl.json") or {}).get("events", {})
    upcoming = collections.defaultdict(list)
    for g in cache.values():
        if not g.get("done") and not g.get("off"):
            upcoming[(g["h"], g["a"])].append(g)
    beta, edges, info = fit["beta"], {}, {}
    for g, hs, as_, rh, ra in shifts(perf, rows):
        if g["home_score"] not in ("", None):
            continue
        key = (AB2ID.get(g["home_team"]), AB2ID.get(g["away_team"]))
        cands = upcoming.get(key) or []
        if not cands or not g["home_qb_id"] or not g["away_qb_id"]:
            continue
        gd = g["gameday"]
        near = [c for c in cands if abs((_day(c["d"]) - _day(gd))) <= 1]
        if not near:
            continue
        start = near[0]["d"][:16]
        e = max(-CAP, min(CAP, beta * (hs - as_)))
        edges[f"{start}|{key[0]}|{key[1]}"] = round(e, 2)
        info[f"{start}|{key[0]}|{key[1]}"] = {"h": [names.get(g["home_qb_id"], ""), round(hs, 1)], "a": [names.get(g["away_qb_id"], ""), round(as_, 1)]}
    if edges:
        model["qbEdges"], model["qbInfo"], model["qbBeta"] = edges, info, beta
        model["basis"] = base + MARK
    write("model/nfl.json", model)
    return {"edges": len(edges), "beta": beta}


MARK = " Each game's projection also moves with the starting quarterback's recent play against the team's usual starter."


def _day(s):
    from datetime import date
    return date(int(s[:4]), int(s[5:7]), int(s[8:10])).toordinal()


def job_qb():
    return {"nfl": apply()}
