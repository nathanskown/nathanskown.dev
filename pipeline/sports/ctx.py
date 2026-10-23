"""Who is playing: game-by-game context the team ratings cannot see.

NBA (player availability). Every player gets a value in points of margin, learned only from games before the one
being projected, from the lab box scores (data/sports/lab/nba_{year}.json, ESPN):
    value = expected minutes x (A + B x shrunk on/off per minute + C x points per minute)
where expected minutes is a recency-weighted average of his minutes when he plays, on/off is his plus-minus per
minute against his team's margin with him off the floor (shrunk toward 0 by SHRINK minutes), and A, B, C were fitted
on the 2023-24 seasons and checked on 2025-26 (see VALUE). A team's rotation is every player averaging 10+ minutes
who played for it within its last 15 games this season. A game's edge is (away value missing - home value missing) x beta.

The edge works like the rest edge: it is taken out of each finished game's result before the ratings are fitted
(a team that lost without its star is not marked down as if at full strength) and added to the projection of each
upcoming game, where "missing" comes from ESPN's injury report (Out counts fully, Doubtful 3/4, Questionable and
Day-To-Day partly). beta is fitted walk-forward by job_fit and written to model/ctx.json; it goes live only if it
beats the model without it on held-out seasons."""
import collections
import glob
import math
import os
import re

import numpy as np

from .common import DATA, now_iso, read, write

LEAGUES = ("nba",)
VALUE = {"nba": {"a": -2.0 / 48, "b": 0.18, "c": 6.1 / 48, "hl_min": 6, "hl_val": 40, "shrink": 600.0, "min_em": 10.0,
                 "roster": 15, "carry": 0.6}}
STATUS_W = {"Out": 1.0, "Injured Reserve": 1.0, "Suspension": 1.0, "Doubtful": 0.75, "Questionable": 0.4, "Day-To-Day": 0.25}
GATE = {"gain": 0.002, "z": 2.0}
BETAS = [0.0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5]
_cache = {}


def lab_years(lg):
    ys = []
    for f in glob.glob(str(DATA / "lab" / f"{lg}_*.json")):
        m = re.search(r"_(\d{4})\.json$", f)
        if m:
            ys.append(int(m.group(1)))
    return sorted(ys)


def _value(st, V):
    oo = st["oo"] / (st["mins"] + V["shrink"])
    ppm = st["pts"] / max(st["mins"], 1.0)
    return st["em"] * (V["a"] + V["b"] * oo + V["c"] * ppm)


def _rotation(P, team, recent, V):
    return [(pid, st) for pid, st in P.items() if st["team"] == team and st["last"] in recent and st["em"] >= V["min_em"]]


def walk(lg):
    """Replay every lab game in order. Returns (players, recent games per team, edges for each finished game):
    edges[(start16, home, away)] = (home value missing, away value missing, home names, away names)."""
    if lg in _cache:
        return _cache[lg]
    V = VALUE[lg]
    fm, fv = 0.5 ** (1 / V["hl_min"]), 0.5 ** (1 / V["hl_val"])
    P, tg, edges = {}, collections.defaultdict(list), {}
    for y in lab_years(lg):
        store = read(f"lab/{lg}_{y}.json") or {}
        for st in P.values():
            for k in ("oo", "pts", "mins"):
                st[k] *= V["carry"]
        tg = collections.defaultdict(list)     # rotations start afresh each season: offseason moves are not absences
        for gid, g in sorted((store.get("g") or {}).items(), key=lambda kv: kv[1]["d"]):
            pl = g.get("pl") or {}
            if not pl or g.get("hs") is None or g.get("as") is None or g["h"] not in pl or g["a"] not in pl:
                continue
            miss = {}
            for t in (g["h"], g["a"]):
                played = {r[0] for r in pl.get(t, []) if (r[2] or 0) > 0}
                recent = set(tg[t][-V["roster"]:])
                rows = [(st["name"], _value(st, V)) for pid, st in _rotation(P, t, recent, V) if pid not in played]
                miss[t] = (sum(v for _, v in rows), [n for n, v in sorted(rows, key=lambda r: -r[1]) if v > 0.5])
            edges[(g["d"][:16], g["h"], g["a"])] = (miss[g["h"]][0], miss[g["a"]][0], miss[g["h"]][1], miss[g["a"]][1])
            margin = g["hs"] - g["as"]
            for t, sgn in ((g["h"], 1), (g["a"], -1)):
                tg[t].append(gid)
                for pid, name, mn, pts, pm, _ in pl.get(t, []):
                    mn = mn or 0.0
                    if mn <= 0:
                        continue
                    st = P.setdefault(pid, {"team": t, "em": mn, "oo": 0.0, "pts": 0.0, "mins": 0.0, "last": None, "name": name})
                    st["team"], st["last"], st["name"] = t, gid, name
                    st["em"] = fm * st["em"] + (1 - fm) * mn
                    on = pm or 0.0
                    oo = (on / mn - (sgn * margin - on) / max(48.0 - mn, 1.0)) * mn if mn < 47 else on
                    st["oo"] = fv * st["oo"] + oo
                    st["pts"] = fv * st["pts"] + (pts or 0.0)
                    st["mins"] = fv * st["mins"] + mn
    _cache[lg] = (P, tg, edges)
    return _cache[lg]


def season_edges(lg, year, rows, inv):
    """Home-perspective edge (away missing - home missing) for the tuner's stored games; 0 where unmatched."""
    if lg not in LEAGUES:
        return np.zeros(len(rows)), 0.0
    _, _, edges = walk(lg)
    out, hit = [], 0
    for r in rows:
        e = edges.get((r[0][:16], inv[r[1]], inv[r[2]]))
        out.append(e[1] - e[0] if e else 0.0)
        hit += e is not None
    return np.array(out, float), hit / max(1, len(rows))


def annotate(lg, games, beta):
    """Finished games of the current season: g["ctxEdge"] = beta x (away missing - home missing), taken out of the result."""
    if lg not in LEAGUES or not beta:
        return 0
    _, _, edges = walk(lg)
    n = 0
    for g in games:
        e = edges.get((g["d"][:16], g["h"], g["a"]))
        if e:
            g["ctxEdge"] = beta * (e[1] - e[0])
            n += 1
    return n


def _last(name):
    parts = [w for w in (name or "").split(" ") if w.rstrip(".") not in ("Jr", "Sr", "II", "III", "IV")]
    return parts[-1] if parts else (name or "")


def _norm(s):
    return re.sub(r"[^a-z]", "", (s or "").lower().replace("jr.", "").replace("iii", "").replace("ii", ""))


def team_missing(lg):
    """Value each team is expected to be without in its next game, from the injury report."""
    V = VALUE[lg]
    P, tg, _ = walk(lg)
    inj = (read(f"injuries/{lg}.json") or {}).get("teams", {})
    out = {}
    for t, rows in inj.items():
        recent = set(tg[t][-V["roster"]:])
        rot = {_norm(st["name"]): (pid, st) for pid, st in _rotation(P, t, recent, V)}
        tot, names = 0.0, []
        for r in rows:
            w = STATUS_W.get(r.get("status"), 0.0)
            hit = rot.get(_norm(r.get("name")))
            if not w or not hit:
                continue
            v = _value(hit[1], V)
            tot += w * v
            if w * v > 0.5:
                names.append([r["name"], r.get("status"), round(v, 1)])
        out[t] = (tot, names)
    return out


def upcoming(lg, beta, events, days=7):
    """ctxEdges / ctxInfo for games starting within `days`, keyed like SD.project: 'start16|home|away'."""
    from datetime import datetime, timedelta, timezone
    if lg not in LEAGUES or not beta:
        return {}, {}
    miss = team_missing(lg)
    ab = {t["id"]: t.get("abbr", "") for t in ((read("teams.json") or {}).get("leagues") or {}).get(lg, [])}
    now = datetime.now(timezone.utc)
    lim = (now + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M")
    lo = (now - timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M")
    edges, info = {}, {}
    for g in events.values():
        if g.get("done") or not g.get("d") or not (lo <= g["d"][:16] <= lim):
            continue
        h, a = g["h"], g["a"]
        mh, ma = miss.get(h, (0.0, [])), miss.get(a, (0.0, []))
        e = beta * (ma[0] - mh[0])
        if abs(e) < 0.05:
            continue
        k = f"{g['d'][:16]}|{h}|{a}"
        edges[k] = round(e, 2)
        notes = []
        for t, mm in ((a, ma), (h, mh)):
            if mm[1]:
                notes.append(f"{ab.get(t, '')} without " + ", ".join(_last(n)
                                                                     + ("" if st == "Out" else f" ({st.lower()})") for n, st, _ in mm[1][:3])
                             + f" (−{beta * mm[0]:.1f})")
        info[k] = notes or None
    return edges, {k: v for k, v in info.items() if v}


def params(lg):
    c = (read("model/ctx.json") or {}).get(lg) or {}
    return c.get("beta") if c.get("adopt") else None


def job_fit():
    """Walk-forward check of beta on every lab season after the first, with the live tuned settings."""
    from . import tune as T
    out = {}
    for lg in LEAGUES:
        ys = lab_years(lg)
        p = dict((read("model/tuned.json") or {}).get(lg, {}).get("params") or {})
        if len(ys) < 3 or not p:
            out[lg] = {"adopt": False, "reason": f"needs 3 lab seasons and tuned settings (have {ys})"}
            continue
        p.pop("av", None)
        L = T.League(lg)
        years = [y for y in ys[1:] if y in L.seasons and (y - 1) in L.seasons]
        runs = {}
        for b in BETAS:
            q = dict(p, av=b)
            runs[b] = {y: (lambda pr: (pr[0], pr[1], L.seasons[y].m))(T.replay(L, L.seasons[y], q, T.prior_for(L, y, q))) for y in years}

        def ll(b, ys_, s0=None):
            P = np.concatenate([runs[b][y][0] for y in ys_]); U = np.concatenate([runs[b][y][1] for y in ys_])
            A = np.concatenate([runs[b][y][2] for y in ys_])
            s0 = s0 or T.fit_sigma(P, U, A, p.get("pv"), p.get("ps"))
            return T.score(P, U, A, s0, p.get("pv"))["ll"], s0
        folds, diffs = [], []
        for ty in years[1:]:
            tr = [y for y in years if y < ty]
            best = min(BETAS, key=lambda b: ll(b, tr)[0].mean())
            base, _ = ll(0.0, [ty], ll(0.0, tr)[1])
            new, _ = ll(best, [ty], ll(best, tr)[1])
            d = base - new
            diffs.append(d)
            folds.append({"holdout": ty, "beta": best, "gain": round(float(d.mean()), 5)})
        d = np.concatenate(diffs)
        gain = float(d.mean()); z = float(gain / (d.std(ddof=1) / math.sqrt(len(d)))) if d.std() > 0 else 0.0
        better = sum(1 for f in folds if f["gain"] > 0)
        beta = min(BETAS, key=lambda b: ll(b, years)[0].mean())
        adopt = gain >= GATE["gain"] and z >= GATE["z"] and better >= len(folds) - 1 and beta > 0
        out[lg] = {"adopt": bool(adopt), "beta": beta, "gain": round(gain, 5), "z": round(z, 2), "folds": folds,
                   "foldsImproved": f"{better}/{len(folds)}", "games": int(len(d)), "seasons": [years[0], years[-1]],
                   "value": VALUE[lg], "updated": now_iso()}
    write("model/ctx.json", out)
    return {lg: {k: v.get(k) for k in ("adopt", "beta", "gain", "z", "foldsImproved")} for lg, v in out.items()}


def job_collect_current():
    """Box scores for the current season's finished games (new ones only), so player values stay current."""
    from . import lab
    out = {}
    for lg in LEAGUES:
        year = (read(f"model/{lg}.json") or {}).get("season")
        if not year:
            continue
        out[lg] = lab.collect(lg, int(year), budget_s=int(os.environ.get("CTX_BUDGET", "900")))
    return out
