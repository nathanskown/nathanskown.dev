"""College football starting quarterbacks, from the lab box scores (data/sports/lab/ncaaf_{year}.json, ESPN).

Each passer's rating is adjusted yards per dropback, (yards + 20 x TD - 45 x INT - 6 x sacks) / (attempts + sacks),
shrunk toward a level PRIOR below the average passer by PN dropbacks (a quarterback with no record is assumed to be
worse than average), with past seasons halving in weight each season. A team's starter in a game is its passer with
the most attempts.

Finished games use the quarterbacks who actually started: the edge (home starter - away starter, x beta points per
yard) comes out of the result before ratings are fitted. Upcoming games use each team's most recent starter, since
there is no free college injury or depth-chart feed; the walk-forward test scores projections the same way."""
import collections

from .common import read

PN, PRIOR, HL_SEASONS = 250.0, -2.5, 1.0
_cache = {}


def _years():
    from .ctx import lab_years
    return lab_years("ncaaf")


def _starter(rows):
    rows = [r for r in rows if (r[2] or 0) > 0]
    return max(rows, key=lambda r: r[2]) if rows else None


def walk():
    """(ratings state, actual-starter edges, last-starter edges, last starter per team, q function)."""
    if "w" in _cache:
        return _cache["w"]
    st = collections.defaultdict(lambda: [0.0, 0.0])
    names = {}
    tot = [0.0, 0.0]
    actual, known, last = {}, {}, {}

    def q(pid):
        v, n = st[pid]
        base = (tot[0] / tot[1]) if tot[1] else 6.0
        return (v + (base + PRIOR) * PN) / (n + PN) - base

    for y in _years():
        f = 0.5 ** (1 / HL_SEASONS)
        for s in st.values():
            s[0] *= f; s[1] *= f
        tot = [x * f for x in tot]
        last = {}
        store = read(f"lab/ncaaf_{y}.json") or {}
        for _, g in sorted((store.get("g") or {}).items(), key=lambda kv: kv[1]["d"]):
            pl = g.get("pl") or {}
            if g.get("hs") is None or not pl:
                continue
            s = {t: _starter(pl.get(t, [])) for t in (g["h"], g["a"])}
            key = (y, g["h"], g["a"])
            if s[g["h"]] and s[g["a"]]:
                actual[key] = q(s[g["h"]][0]) - q(s[g["a"]][0])
                lh, la = last.get(g["h"]), last.get(g["a"])      # no starter yet this season: counted as average
                known[key] = (q(lh[0]) if lh else 0.0) - (q(la[0]) if la else 0.0)
            for t in (g["h"], g["a"]):
                if s[t]:
                    last[t] = s[t]
                for r in pl.get(t, []):
                    att, yds, td, it, sk = (r[2] or 0), (r[3] or 0), (r[4] or 0), (r[5] or 0), (r[7] or 0)
                    db = att + sk
                    if db <= 0:
                        continue
                    v = yds + 20 * td - 45 * it - 6 * sk
                    st[r[0]][0] += v; st[r[0]][1] += db; tot[0] += v; tot[1] += db
                    names[r[0]] = r[1]
    _cache["w"] = (actual, known, last, q, names)
    return _cache["w"]


def edge(year, h, a, projection=False):
    actual, known, *_ = walk()
    return (known if projection else actual).get((year, h, a))


def upcoming(beta, events, ab, lo, lim):
    _, _, last, q, _ = walk()
    edges, info = {}, {}
    for g in events.values():
        if g.get("done") or not g.get("d") or not (lo <= g["d"][:16] <= lim):
            continue
        h, a = g["h"], g["a"]
        if h not in last or a not in last:
            continue
        qh, qa = q(last[h][0]), q(last[a][0])
        e = beta * (qh - qa)
        k = f"{g['d'][:16]}|{h}|{a}"
        edges[k] = round(e, 2)
        if abs(e) >= 1.0:
            info[k] = [f"QBs: {last[a][1]} ({ab.get(a, '')}) {beta * qa:+.1f}, {last[h][1]} ({ab.get(h, '')}) {beta * qh:+.1f} vs. average"]
    return edges, info
