"""Projected game totals for the NBA, NHL, college basketball and college football (the NFL's are in nflprops.py).

Each team gets an offense and a defense rating in points (goals), solved by ridge regression from every completed game
with older days counting less (half-life HL days) and last season carried in at CARRY:
    home points = league average + home offense - away defense + home edge / 2, and the same for the away side.
Teams with fewer than MIN_GP games in the data share one pooled rating (college non-D-I opponents). Settings were
chosen on 2019-22 seasons and checked on 2023 onward against closing totals (lab files): the model's miss is a little
larger than the closing line's and picking overs and unders against the line has been break-even, so these are a
baseline for context, not picks. The backtest below is re-run on the newest complete season each day.

Writes data/sports/model/totals_{lg}.json: {"games": {"start16|home|away": [total, home, away]}, "backtest": {...}}."""
from datetime import date, datetime, timedelta, timezone

import numpy as np

from . import history
from .common import now_iso, read, write

CONF = {"nba": dict(K=10, HL=20, CARRY=0.6, HOME=0.0, MIN_GP=5),
        "nhl": dict(K=40, HL=120, CARRY=0.6, HOME=0.0, MIN_GP=5),
        "ncaab": dict(K=6, HL=40, CARRY=0.6, HOME=0.0, MIN_GP=8),
        "ncaaf": dict(K=8, HL=120, CARRY=0.6, HOME=0.0, MIN_GP=4)}


def _games(lg, seasons):
    H = history.load(lg)
    out = []
    for y in seasons:
        for g in H.get(y, []):
            if g["hs"] is not None and g["as"] is not None:
                out.append((y, g["d"], str(g["h"]), str(g["a"]), float(g["hs"]), float(g["as"]), bool(g["n"])))
    return out


def _walk(G, c, upcoming=(), score_from=None):
    """Replay games day by day. Returns (projections for finished games of seasons >= score_from, upcoming totals)."""
    cnt = {}
    for g in G:
        cnt[g[2]] = cnt.get(g[2], 0) + 1; cnt[g[3]] = cnt.get(g[3], 0) + 1
    teams = sorted(t for t, n in cnt.items() if n >= c["MIN_GP"])
    ix = {t: i for i, t in enumerate(teams)}
    pool = len(teams); n = pool + 1
    idx = lambda t: ix.get(t, pool)
    f = 0.5 ** (1 / c["HL"])
    A = np.zeros((2 * n, 2 * n)); b = np.zeros(2 * n); prior = np.zeros(2 * n)
    mu_s = mu_w = 0.0
    byday = {}
    for g in G:
        byday.setdefault((g[0], g[1][:10]), []).append(g)
    cur_y = last = None
    proj = []
    for (y, day) in sorted(byday):
        if y != cur_y:
            if cur_y is not None:
                prior = c["CARRY"] * np.linalg.solve(A + c["K"] * np.eye(2 * n), b + c["K"] * prior)
            A[:] = 0; b[:] = 0; cur_y, last = y, None
            mu_s *= 0.3; mu_w *= 0.3
        if last:
            dd = (date.fromisoformat(day) - date.fromisoformat(last)).days
            A *= f ** dd; b *= f ** dd
        last = day
        rows = byday[(y, day)]
        if score_from is not None and y >= score_from and mu_w:
            sol = np.linalg.solve(A + c["K"] * np.eye(2 * n), b + c["K"] * prior)
            mu = mu_s / mu_w
            for g in rows:
                h, a = idx(g[2]), idx(g[3])
                proj.append((g[1], g[2], g[3], 2 * mu + sol[h] - sol[n + a] + sol[a] - sol[n + h], g[4] + g[5]))
        for g in rows:
            h, a = idx(g[2]), idx(g[3])
            mu_s += g[4] + g[5]; mu_w += 2
            mu = mu_s / mu_w
            for off, de, pts, sign in ((h, a, g[4], 1), (a, h, g[5], -1)):
                x = np.zeros(2 * n); x[off] = 1; x[n + de] = -1
                A += np.outer(x, x); b += x * (pts - mu - (0 if g[6] else sign * c["HOME"] / 2))
    up = {}
    if upcoming and mu_w:
        if last:
            dd = max(0, (datetime.now(timezone.utc).date() - date.fromisoformat(last)).days)
            A *= f ** dd; b *= f ** dd
        sol = np.linalg.solve(A + c["K"] * np.eye(2 * n), b + c["K"] * prior)
        mu = mu_s / mu_w
        for d, h0, a0, neutral in upcoming:
            h, a = idx(h0), idx(a0)
            ph = mu + sol[h] - sol[n + a] + (0 if neutral else c["HOME"] / 2)
            pa = mu + sol[a] - sol[n + h] - (0 if neutral else c["HOME"] / 2)
            up[f"{d[:16]}|{h0}|{a0}"] = [round(ph + pa, 1), round(ph, 1), round(pa, 1)]
    return proj, up


def _lines(lg):
    mk = {}
    for y in range(2013, 2040):
        for r in ((read(f"lab/{lg}_{y}.json") or {}).get("g") or {}).values():
            if r.get("tot") is not None:
                mk[f"{r['d'][:10]}|{r['h']}|{r['a']}"] = float(r["tot"])
        if lg == "ncaaf":
            for v in ((read(f"history/cfbd_lines_{y}.json") or {}).get("g") or {}).values():
                if v[4] is not None:
                    mk.setdefault(f"{v[0][:10]}|{v[1]}|{v[2]}", float(v[4]))
    return mk


def build(lg):
    c = CONF[lg]
    cache = read(f"model/_games_{lg}.json") or {}
    cur = cache.get("season")
    H = history.load(lg)
    done = sorted(y for y in H if cur is None or y < cur)[-3:]
    G = _games(lg, done)
    ev = cache.get("events") or {}
    for e in ev.values():                     # this season's finished games from the live cache
        if e.get("done") and not e.get("off") and e.get("hs") is not None and e.get("t", 2) == 2:
            G.append((cur, e["d"], str(e["h"]), str(e["a"]), float(e["hs"]), float(e["as"]), bool(e.get("n"))))
    G.sort(key=lambda g: g[1])
    now = datetime.now(timezone.utc)
    lo, hi = (now - timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M"), (now + timedelta(days=8)).strftime("%Y-%m-%dT%H:%M")
    up = [(e["d"], str(e["h"]), str(e["a"]), bool(e.get("n"))) for e in ev.values() if not e.get("done") and not e.get("off") and e.get("d") and lo <= e["d"][:16] <= hi]
    _, games = _walk(G, c, up)
    # backtest: the newest complete season, projected from the two before it
    bt = None
    if len(done) >= 2:
        proj, _ = _walk([g for g in G if g[0] in done], c, (), score_from=done[-1])
        mk = _lines(lg)
        wl = [(p, mk.get(f"{p[0][:10]}|{p[1]}|{p[2]}")) for p in proj]
        wl = [(p, l) for p, l in wl if l is not None and p[4] != l]
        bt = {"season": done[-1], "games": len(proj), "mae": round(float(np.mean([abs(p[3] - p[4]) for p in proj])), 2) if proj else None}
        if len(wl) > 100:
            w = sum(1 for p, l in wl if (p[3] > l) == (p[4] > l))
            bt.update({"withLine": len(wl), "maeModel": round(float(np.mean([abs(p[3] - p[4]) for p, _ in wl])), 2),
                       "maeLine": round(float(np.mean([abs(l - p[4]) for p, l in wl])), 2), "ou": [w, len(wl) - w],
                       "lineNote": "NHL totals sit on 5.5/6/6.5 and the price carries the rest, so the line's miss overstates its error" if lg == "nhl" else None})
    write(f"model/totals_{lg}.json", {"lg": lg, "season": cur, "updated": now_iso(), "conf": c, "games": games, "backtest": bt})
    return {"games": len(games), "backtest": bt}


def job_totals():
    out = {}
    for lg in CONF:
        try:
            out[lg] = build(lg)
        except Exception as e:
            out[lg] = {"error": str(e)[:160]}
    return out
