"""NFL non-quarterback availability from snap counts (nflverse snap_counts, CC-BY 4.0, from Pro Football Reference).

A team's regulars are the non-QB, non-specialist players who averaged at least MIN_PCT of the offensive or defensive
snaps over its last NREC games. A finished game's feature is (away regulars who did not play - home regulars who did
not play), each counted by his snap share, so a missing every-down starter counts about 1. ctx.py multiplies it by a
fitted beta (points per missing starter) and, as for the NBA, takes it out of results and adds it to projections;
for upcoming games "did not play" comes from ESPN's injury report.

  data/sports/history/nfl_snaps.json   {"edges": {season: {"home|away": feature}}, "rot": {team id: [[name, share], ...]},
                                         "rotSeason": season, "updated"}"""
import collections

from .common import now_iso, read, write

URL = "https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_{y}.csv"
FIRST = 2013
NREC, MIN_PCT = 3, 0.6
SKIP = {"QB", "K", "P", "LS"}


def _season(y, rows):
    from .nflqb import AB2ID
    bygame = collections.defaultdict(lambda: collections.defaultdict(dict))
    for r in rows:
        if r.get("game_type") != "REG" or r.get("position") in SKIP or not r.get("position"):
            continue
        pct = max(float(r.get("offense_pct") or 0), float(r.get("defense_pct") or 0))
        bygame[r["game_id"]][r["team"]][r["pfr_player_id"]] = (pct, r["player"])
    hist = collections.defaultdict(list)
    edges = {}
    for gid in sorted(bygame, key=lambda g: (int(g.split("_")[1]), g)):
        _, _, away, home = gid.split("_")[:4]
        miss = {}
        for t in (home, away):
            rec = hist[t][-NREC:]
            tot = 0.0
            if rec:
                avg = collections.defaultdict(float)
                for gm in rec:
                    for pid, (pct, _) in gm.items():
                        avg[pid] += pct / len(rec)
                tot = sum(a for pid, a in avg.items() if a >= MIN_PCT and pid not in bygame[gid][t])
            miss[t] = tot
            hist[t].append(bygame[gid][t])
        h, a = AB2ID.get(home), AB2ID.get(away)
        if h and a:
            edges[f"{h}|{a}"] = round(miss[away] - miss[home], 3)
    rot = {}
    for t, games in hist.items():
        tid = AB2ID.get(t)
        rec = games[-NREC:]
        avg, names = collections.defaultdict(float), {}
        for gm in rec:
            for pid, (pct, nm) in gm.items():
                avg[pid] += pct / len(rec); names[pid] = nm
        if tid:
            rot[tid] = sorted(([names[p], round(a, 2)] for p, a in avg.items() if a >= MIN_PCT), key=lambda x: -x[1])
    return edges, rot


def job_snaps():
    """Fetch any missing past season and always the current one."""
    from .nflqb import _csv
    store = read("history/nfl_snaps.json") or {"edges": {}}
    cur = (read("model/nfl.json") or {}).get("season")
    if not cur:
        raise RuntimeError("no NFL season in model/nfl.json")
    got = {}
    for y in range(FIRST, cur + 1):
        if str(y) in store["edges"] and y != cur:
            continue
        try:
            e, rot = _season(y, list(_csv(URL.format(y=y))))
        except Exception as ex:
            got[y] = f"error: {str(ex)[:80]}"
            continue
        store["edges"][str(y)] = e
        got[y] = len(e)
        if y == cur:
            store["rot"], store["rotSeason"] = rot, y
    store["updated"] = now_iso()
    write("history/nfl_snaps.json", store)
    return got


def edges():
    store = read("history/nfl_snaps.json") or {}
    out = {}
    for y, d in (store.get("edges") or {}).items():
        for k, v in d.items():
            h, a = k.split("|")
            out[(int(y), h, a)] = v
    return out


def team_missing(status_w, norm):
    """{team id: (snap share expected missing, [[name, status, share], ...])} from ESPN's NFL injury report."""
    store = read("history/nfl_snaps.json") or {}
    rot = store.get("rot") or {}
    inj = (read("injuries/nfl.json") or {}).get("teams", {})
    out = {}
    for t, rows in inj.items():
        reg = {norm(n): s for n, s in rot.get(t, [])}
        tot, names = 0.0, []
        for r in rows:
            w = status_w.get(r.get("status"), 0.0)
            s = reg.get(norm(r.get("name")))
            if not w or not s or r.get("pos") == "QB":
                continue
            tot += w * s
            names.append([r["name"], r.get("status"), s])
        out[t] = (tot, sorted(names, key=lambda x: -x[2]))
    return out
