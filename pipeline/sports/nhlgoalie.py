"""NHL goaltending: which goalie starts, and how much better or worse he is than the one a team usually plays.

Team ratings come from results (and expected goals), so they carry a team's usual goaltending but cannot see a night
when the backup starts or the starter is hurt. Betting lines move on confirmed starters; this gives the house model
the same kind of information, learned only from game data.

Goalie quality, walk-forward over every stored season (history/nhl_goalies_{year}.json, the NHL's own API):
    goals saved above average per game = (league save % x shots - goals allowed) / (shots + SHRINK) x SHOTS_PER_GAME
shrunk toward average by SHRINK shots, older seasons counting CARRY as much each new season.
    usual   = mean quality of the team's starters over its last USUAL games (as rated at the time)
    shift   = starter quality - usual                                  (goals per game)
    edge    = home shift - away shift                                  (home perspective, scaled by beta in ctx.py)

Finished games use the goalie who actually started (so a loss with the backup in net is not counted as if the
starter played). Projections cannot know the starter for sure, so they use the expected one: each goalie weighted by
his share of the team's last USUAL starts, with the goalie who started the night before cut to B2B of his share on
the second night of a back-to-back. ctx.job_fit checks on held-out seasons whether this helps, and it goes live only
if it does. First check (Nov 2026, 2022-26 held out): no gain, even when projections were given the actual starter
(log loss within +/-0.0004 across shrinkage 300-3000 shots), so it is not live; the ratings' expected-goals input
already carries most of what save percentage adds. It stays wired so each re-fit tests it again as seasons accrue.

Daily, job_current() adds the season's newly finished games (a few requests: it stops at the first unplayed ones)."""
import time
from datetime import date, datetime, timedelta, timezone

from .common import get, now_iso, read, write

NHL2ESPN = {"ANA": "25", "ARI": "24", "BOS": "1", "BUF": "2", "CAR": "7", "CBJ": "29", "CGY": "3", "CHI": "4", "COL": "17",
            "DAL": "9", "DET": "5", "EDM": "6", "FLA": "26", "LAK": "8", "MIN": "30", "MTL": "10", "NJD": "11", "NSH": "27",
            "NYI": "12", "NYR": "13", "OTT": "14", "PHI": "15", "PIT": "16", "SEA": "124292", "SJS": "18", "STL": "19",
            "TBL": "20", "TOR": "21", "UTA": "129764", "VAN": "22", "VGK": "37", "WPG": "28", "WSH": "23"}
SHRINK = 3000.0          # shots of league-average prior on every goalie (save % is noisy; 700-3000 tested)
SHOTS_PER_GAME = 28.0
CARRY = 0.9              # share of a goalie's record carried into each new season
USUAL = 10               # games that define a team's usual goaltending
B2B = 0.2                # second night of a back-to-back: last night's starter keeps this share of his usual chance
_cache = {}


def years():
    import glob
    import re
    from .common import DATA
    out = []
    for f in glob.glob(str(DATA / "history" / "nhl_goalies_*.json")):
        m = re.search(r"_(\d{4})\.json$", f)
        if m:
            out.append(int(m.group(1)))
    return sorted(out)


def _id(ab):
    from . import model as M
    t = NHL2ESPN.get(ab)
    return M.alias("nhl", t) if t else None


def _starter(rows):
    if not rows:
        return None
    st = [r for r in rows if r[2]]
    return (st or sorted(rows, key=lambda r: -(r[3] or 0)))[0][0]


def walk():
    """Replay every stored goalie game in order. Returns (quality by goalie, edges): edges[(local date, home, away)] =
    (result edge, projection edge, home starter name, away starter name) in goals, before beta."""
    if "walk" in _cache:
        return _cache["walk"]
    Q = {}                     # goalie id -> [shots, goals allowed above league rate (negative = saved), name]
    starts = {}                # team -> [(local date, starter id)]
    edges = {}
    league = [0.0, 0.0]        # running shots, goals allowed (this season, with last season carried in)
    for y in years():
        store = (read(f"history/nhl_goalies_{y}.json") or {}).get("g") or {}
        for q in Q.values():
            q[0] *= CARRY
            q[1] *= CARRY
        league = [league[0] * 0.2, league[1] * 0.2]
        starts = {}                                   # usual goaltending starts afresh each season
        for gid, g in sorted(store.items(), key=lambda kv: (kv[1][0] or "", kv[0])):
            d, hab, aab, hg, ag = g
            h, a = _id(hab), _id(aab)
            if not d or not h or not a or not hg or not ag:
                continue
            sv = (league[0] - league[1]) / league[0] if league[0] > 500 else 0.905

            def qual(pid):
                s = Q.get(pid)
                return 0.0 if not s else -s[1] / (s[0] + SHRINK) * SHOTS_PER_GAME

            def usual(t):
                past = [s for _, s in starts.get(t, [])[-USUAL:]]
                return sum(qual(s) for s in past) / len(past) if past else None

            def expected(t):
                past = starts.get(t, [])[-USUAL:]
                if not past:
                    return None
                w = {}
                for _, s in past:
                    w[s] = w.get(s, 0.0) + 1.0
                prev = date.fromisoformat(past[-1][0])
                if (date.fromisoformat(d) - prev).days == 1:          # second night of a back-to-back
                    w[past[-1][1]] *= B2B
                tot = sum(w.values())
                return sum(v * qual(s) for s, v in w.items()) / tot

            sh, sa_ = _starter(hg), _starter(ag)
            uh, ua = usual(h), usual(a)
            if uh is not None and ua is not None and sh and sa_:
                res = (qual(sh) - uh) - (qual(sa_) - ua)
                eh, ea = expected(h), expected(a)
                proj = (eh - uh) - (ea - ua)
                nm = lambda rows, pid: next((r[1] for r in rows if r[0] == pid), "")
                edges[(d, h, a)] = (res, proj, nm(hg, sh), nm(ag, sa_))
            # then learn from this game
            for t, rows in ((h, hg), (a, ag)):
                s = _starter(rows)
                if s:
                    starts.setdefault(t, []).append((d, s))
                for pid, name, _, sec, shots, saves in rows:
                    if not shots:
                        continue
                    ga = shots - (saves or 0)
                    q = Q.setdefault(pid, [0.0, 0.0, name])
                    q[0] += shots
                    q[1] += ga - (1 - sv) * shots
                    q[2] = name
                    league[0] += shots
                    league[1] += ga
    _cache["walk"] = (Q, starts, edges)
    return _cache["walk"]


def edge(d_utc, h, a, projection=False):
    """Home-perspective goalie edge (goals, before beta) for a finished game starting at d_utc (ISO, UTC), or None.
    The NHL lists local dates, so the UTC date and the day before are both tried."""
    E = walk()[2]
    day = date.fromisoformat(d_utc[:10])
    for dd in (day - timedelta(days=1), day):
        e = E.get((dd.isoformat(), h, a))
        if e:
            return e[1] if projection else e[0]
    return None


def upcoming(beta, events, ab, lo, hi):
    """ctxEdges / ctxInfo for games starting between lo and hi (ISO minutes, UTC): expected starters, as in projections."""
    Q, starts, _ = walk()

    def qual(pid):
        s = Q.get(pid)
        return 0.0 if not s else -s[1] / (s[0] + SHRINK) * SHOTS_PER_GAME

    def side(t, day):
        past = starts.get(t, [])[-USUAL:]
        if not past:
            return None
        u = sum(qual(s) for _, s in past) / len(past)
        w = {}
        for _, s in past:
            w[s] = w.get(s, 0.0) + 1.0
        b2b = (day - date.fromisoformat(past[-1][0])).days == 1
        if b2b:
            w[past[-1][1]] *= B2B
        tot = sum(w.values())
        e = sum(v * qual(s) for s, v in w.items()) / tot
        likely = max(w, key=w.get)
        return e - u, (Q.get(likely) or [0, 0, ""])[2], b2b
    edges, info = {}, {}
    for g in events.values():
        if g.get("done") or not g.get("d") or not (lo <= g["d"][:16] <= hi):
            continue
        local = date.fromisoformat((datetime.fromisoformat(g["d"][:16]) - timedelta(hours=5)).date().isoformat())
        sh, sa = side(g["h"], local), side(g["a"], local)
        if not sh or not sa:
            continue
        e = beta * (sh[0] - sa[0])
        if abs(e) < 0.02:
            continue
        k = f"{g['d'][:16]}|{g['h']}|{g['a']}"
        edges[k] = round(e, 3)
        fmt = lambda x: ("+" if x > 0 else "−") + f"{abs(x):.2f}"
        notes = [f"{ab.get(t, '')}: {(s[1] or '?').split(' ')[-1]} expected in net{', 2nd of back-to-back' if s[2] else ''} ({fmt(beta * s[0])})"
                 for t, s in ((g["a"], sa), (g["h"], sh)) if abs(beta * s[0]) >= 0.05]
        if notes:
            info[k] = notes
    return edges, info


def job_current():
    """Goalies for the current season's newly finished games (NHL API). Stops at the first run of unplayed games."""
    cur = (read("model/nhl.json") or {}).get("season")
    if not cur:
        return {"skipped": "no NHL season"}
    name = f"history/nhl_goalies_{cur}.json"
    store = read(name) or {"year": cur, "g": {}}
    t0, added, idle = time.time(), 0, 0
    for n in range(1, 1400):
        gid = f"{cur - 1}02{n:04d}"
        if gid in store["g"]:
            continue
        if idle >= 12 or time.time() - t0 > 600:
            break
        try:
            b = get(f"https://api-web.nhle.com/v1/gamecenter/{gid}/boxscore", timeout=30)
        except Exception:
            idle += 1
            continue
        if b.get("gameState") not in ("OFF", "FINAL"):
            idle += 1
            continue
        idle = 0
        pg = b.get("playerByGameStats") or {}

        def goalies(sd):
            rows = []
            for gk in ((pg.get(sd) or {}).get("goalies") or []):
                toi = str(gk.get("toi") or "0:00").split(":")
                sec = int(toi[0]) * 60 + int(toi[1]) if len(toi) == 2 and toi[0].isdigit() else 0
                sa, sv = gk.get("shotsAgainst"), gk.get("saves")
                if sa is None and gk.get("saveShotsAgainst"):
                    try:
                        sv, sa = (int(x) for x in str(gk["saveShotsAgainst"]).split("/"))
                    except ValueError:
                        pass
                rows.append([gk.get("playerId"), (gk.get("name") or {}).get("default"), bool(gk.get("starter")), sec, sa, sv])
            return rows
        store["g"][gid] = [b.get("gameDate"), (b.get("homeTeam") or {}).get("abbrev"), (b.get("awayTeam") or {}).get("abbrev"),
                           goalies("homeTeam"), goalies("awayTeam")]
        added += 1
    store["updated"] = now_iso()
    write(name, store)
    return {"season": cur, "games": len(store["g"]), "added": added}
