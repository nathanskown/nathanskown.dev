"""Track record: every house projection, saved before kickoff and graded after the final.

Live log (every run)
  For each game that has not started, the current projection is saved or refreshed. Once the game
  starts the pick is frozen, so what gets graded is the last projection made before kickoff, never
  one that has seen the result. When the game is final, the pick is graded against the score.
  Picks are kept in data/sports/track/_picks_{lg}.json (internal); the page reads summary.json.

Backtest (daily run)
  Replays every completed game this season in date order, rating teams only from games played
  strictly before it. It shows how the same method would have done on games that are already
  over. It is a backtest, not a track record, and the page labels it that way.

MLB is not logged yet (its projections leave out starting pitchers, which decide most of a baseball
game's odds). Games ESPN postpones or cancels are dropped, not graded."""
import math
from datetime import datetime, timezone

from .common import read, write, now_iso
from . import model as M

LEAGUES = ["nfl", "ncaaf", "nhl", "nba", "ncaab", "ncaah"]
WEEKLY = {"nfl", "ncaaf"}                  # leagues whose schedule is grouped by week
BUCKETS = [(0.5, 0.55), (0.55, 0.6), (0.6, 0.65), (0.65, 0.75), (0.75, 1.01)]
RECENT, PENDING = 40, 40


def _parse(d):
    return datetime.fromisoformat(d + ":00+00:00") if len(d) == 16 else datetime.fromisoformat(d.replace("Z", "+00:00"))


def _enough(model, t):
    return t is not None and (t.get("gp", 0) >= model.get("minGp", 0) or t.get("prior") is not None)


def rest_edge(model, H, A, start):
    """Rest edge for a game starting at `start` (ISO), from each team's game dates in the model file.
    Zero when the league has no rest setting, no start is given, or the game is beyond the dates written."""
    if not model.get("rest") or not start or start[:10] > model.get("restUntil", ""):
        return 0.0
    cap = model.get("restCap", 7)
    day = M._day(start)

    def rest(T):
        prev = [d for d in (T.get("dates") or []) if d < start[:10]]
        return min(cap, day - M._day(prev[-1])) if prev else cap
    return model["rest"] * (rest(H) - rest(A))


def project(model, h, a, neutral, start=None):
    """(home margin, P(home win)) from a model file, or None if either team is too thin."""
    T = model.get("teams") or {}
    H, A = T.get(h), T.get(a)
    if not (_enough(model, H) and _enough(model, A)):
        return None
    hfa = 0.0 if neutral else model.get("hfa", 0.0)
    if not neutral and model.get("divHfa") is not None and H.get("group") and H.get("group") == A.get("group"):
        hfa = model["divHfa"]
    m = H["rating"] - A["rating"] + hfa + rest_edge(model, H, A, start)
    if model.get("spEdges") and start:
        m += model["spEdges"].get(f"{start[:16]}|{h}|{a}", 0.0)
    if model.get("qbEdges") and start:
        m += model["qbEdges"].get(f"{start[:16]}|{h}|{a}", 0.0)      # NFL starting-QB adjustment (nflqb.py)
    return m, M.phi(m / spread(model, H, A))


def spread(model, H, A):
    """The league's sigma, widened by how unsure both ratings still are when the model says so (pv)."""
    s = model["sigma"]
    if model.get("pv") and H.get("w") and A.get("w"):
        s *= math.sqrt(1 + 1 / H["w"] + 1 / A["w"])
    return s


def _result(hs, as_):
    return 1.0 if hs > as_ else (0.0 if hs < as_ else 0.5)


def score(rows):
    """rows: dicts with p (home win prob), res (1/0/0.5) and err (actual margin minus projected)."""
    n = len(rows)
    if not n:
        return {"n": 0}
    dec = [r for r in rows if r["res"] != 0.5]
    hits = sum(1 for r in dec if (r["p"] >= 0.5) == (r["res"] == 1.0))
    home_rate = sum(r["res"] for r in rows) / n
    ll = [-(r["res"] * math.log(max(r["p"], 1e-6)) + (1 - r["res"]) * math.log(max(1 - r["p"], 1e-6))) for r in rows]
    out = {
        "n": n, "decided": len(dec), "hits": hits, "acc": round(hits / len(dec), 3) if dec else None,
        "brier": round(sum((r["p"] - r["res"]) ** 2 for r in rows) / n, 4),
        "logloss": round(sum(ll) / n, 4),
        "mae": round(sum(abs(r["err"]) for r in rows) / n, 2),
        "bias": round(sum(r["err"] for r in rows) / n, 2),
        "homeRate": round(home_rate, 3),
        "homeBrier": round(sum((home_rate - r["res"]) ** 2 for r in rows) / n, 4),   # always guess the observed home rate
        "coinBrier": 0.25,
    }
    cal = []
    for lo, hi in BUCKETS:
        bucket = [r for r in dec if lo <= max(r["p"], 1 - r["p"]) < hi]
        if bucket:
            cal.append({"lo": lo, "hi": min(hi, 1.0), "n": len(bucket),
                        "exp": round(sum(max(r["p"], 1 - r["p"]) for r in bucket) / len(bucket), 3),
                        "act": round(sum(1 for r in bucket if (r["p"] >= 0.5) == (r["res"] == 1.0)) / len(bucket), 3)})
    out["cal"] = cal
    return out


# ---------------------------------------------------------------- live log
def update_picks(lg, now=None):
    now = now or datetime.now(timezone.utc)
    cache = read(f"model/_games_{lg}.json") or {}
    model = read(f"model/{lg}.json") or {}
    if not cache.get("events") or not model.get("teams"):
        return None
    store = read(f"track/_picks_{lg}.json") or {}
    if store.get("season") != cache.get("season"):
        store = {"season": cache.get("season"), "picks": {}}
    picks = store["picks"]
    from . import blend
    mkt = blend.market(lg, model)
    stamp = now.replace(microsecond=0).isoformat()
    added = graded = 0
    for eid, g in cache["events"].items():
        if g.get("t") not in (2, None) and lg not in WEEKLY:
            continue
        pk = picks.get(eid)
        if g["off"]:
            picks.pop(eid, None)
            continue
        if pk and "hs" in pk:
            continue                                      # already graded
        start = _parse(g["d"])
        if not g["done"] and start > now:                 # not started: save or refresh
            pr = project(model, g["h"], g["a"], g["n"], g["d"])
            if pr is None:
                picks.pop(eid, None)
                continue
            if not pk:
                added += 1
            picks[eid] = {"d": g["d"], "h": g["h"], "a": g["a"], "n": int(g["n"]), "m": round(pr[0], 2), "p": round(pr[1], 4),
                          "s": (pk or {}).get("s", stamp)}
            mk = mkt.get(f"{g['d'][:16]}|{g['h']}|{g['a']}")
            if mk is not None:
                picks[eid]["mk"] = round(mk, 2)      # watched, never used in the forecast; internal file, not published
        elif pk and g["done"] and g.get("hs") is not None and g.get("as") is not None:
            pk.update({"hs": g["hs"], "as": g["as"], "d": g["d"]})
            graded += 1
    write(f"track/_picks_{lg}.json", store)
    return {"added": added, "graded": graded, "total": len(picks)}


def _graded_rows(picks):
    rows = []
    for eid, pk in picks.items():
        if "hs" not in pk:
            continue
        res = _result(pk["hs"], pk["as"])
        rows.append({"id": eid, "d": pk["d"], "h": pk["h"], "a": pk["a"], "hs": pk["hs"], "as": pk["as"], "n": pk.get("n", 0),
                     "p": pk["p"], "m": pk["m"], "res": res, "err": (pk["hs"] - pk["as"]) - pk["m"], "s": pk.get("s"),
                     "mk": pk.get("mk")})
    rows.sort(key=lambda r: r["d"])
    return rows


def summarize(now=None):
    now = now or datetime.now(timezone.utc)
    out = {"updated": now_iso(), "leagues": {}, "excluded": ["mlb"]}
    every = []
    for lg in LEAGUES:
        store = read(f"track/_picks_{lg}.json") or {}
        picks = store.get("picks", {})
        rows = _graded_rows(picks)
        every += rows
        pending = sorted(({"id": e, "d": p["d"], "h": p["h"], "a": p["a"], "n": p.get("n", 0), "m": p["m"], "p": p["p"]}
                          for e, p in picks.items() if "hs" not in p and _parse(p["d"]) > now), key=lambda x: x["d"])
        open_now = sum(1 for p in picks.values() if "hs" not in p and _parse(p["d"]) <= now)
        entry = {"season": store.get("season"), "logging": bool(picks) or bool(store), "pendingN": len(pending), "inProgress": open_now,
                 "pending": pending[:PENDING],
                 "recent": [{k: r[k] for k in ("id", "d", "h", "a", "hs", "as", "p", "m", "n")} for r in rows[-RECENT:][::-1]],
                 "firstLogged": min((p.get("s") for p in picks.values() if p.get("s")), default=None),
                 "stats": score(rows)}
        both = [r for r in rows if r["mk"] is not None]       # graded games that also have a market number
        if both:
            sg = (read(f"model/{lg}.json") or {}).get("sigma") or 13.0
            entry["watch"] = {"n": len(both), "house": score(both),
                              "market": score([dict(r, p=M.phi(r["mk"] / sg), err=(r["hs"] - r["as"]) - r["mk"]) for r in both]),
                              "gapMean": round(sum(r["mk"] - r["m"] for r in both) / len(both), 2),
                              "gapAbs": round(sum(abs(r["mk"] - r["m"]) for r in both) / len(both), 2)}
        out["leagues"][lg] = entry
    out["all"] = score(every)
    write("track/summary.json", out)
    return {lg: v["stats"].get("n", 0) for lg, v in out["leagues"].items()}


def job_track():
    out = {}
    for lg in LEAGUES:
        out[lg] = update_picks(lg)
    out["graded"] = summarize()
    return out


# ---------------------------------------------------------------- backtest
def backtest(lg):
    P = M.get_params(lg)
    cache = read(f"model/_games_{lg}.json") or {}
    ev = sorted((g for g in cache.get("events", {}).values()
                 if g["done"] and not g["off"] and g.get("hs") is not None and g.get("as") is not None and (g.get("t") in (2, None))),
                key=lambda g: g["d"])
    if len(ev) < 20:
        return {"n": 0, "games": len(ev)}
    smap = M._standings_map(lg)
    members = set(M._members(lg))
    ev = [dict(g, h=M.alias(lg, g["h"]), a=M.alias(lg, g["a"])) for g in ev]
    if lg in M.PRO_ONLY:
        ev = [g for g in ev if g["h"] in members and g["a"] in members]
    M.annotate_rest(lg, ev, P)
    M.annotate_xg(lg, cache["season"], ev, P)
    group, hfa_fn, norm = M.context(lg, smap, members)
    prior = M.season_prior(lg, cache["season"], P, members, hfa_fn, norm)
    if not prior and lg == "nba":
        try:
            prior = M._nba_prior(cache["season"])
        except Exception:
            prior = {}
    key = (lambda g: g.get("wk") or g["d"][:10]) if lg in WEEKLY else (lambda g: g["d"][:10])
    slices = {}
    for g in ev:
        slices.setdefault(key(g), []).append(g)
    rows = []
    for k, batch in sorted(slices.items(), key=lambda kv: kv[1][0]["d"]):
        t0 = batch[0]["d"]
        train = [g for g in ev if g["d"] < t0]
        if len(train) < 10:
            continue
        results = [(norm(g["h"]), norm(g["a"]), M.target(g, P), g["n"], g) for g in train]
        results = [r for r in results if r[0] != r[1]]
        gp = {}
        for h, a, *_ in results:
            gp[h] = gp.get(h, 0) + 1
            gp[a] = gp.get(a, 0) + 1
        now = M.datetime.fromisoformat(t0[:16] + ":00+00:00")
        R, eff = M.ridge(results, members, hfa_fn, P["k"], prior, P.get("cap"), P.get("soft"), M.recency(P, [r[4]["d"] for r in results], now))
        for g in batch:
            h, a = M.alias(lg, g["h"]), M.alias(lg, g["a"])
            if h not in members or a not in members or h not in R or a not in R:
                continue
            ok = lambda t: gp.get(t, 0) >= P["minGp"] or t in prior
            if not (ok(h) and ok(a)):
                continue
            m = R[h] - R[a] + (0.0 if g["n"] else hfa_fn(dict(g, h=h, a=a))) + g.get("restEdge", 0.0)
            sg = P["sigma"] * (math.sqrt(1 + 1 / eff[h] + 1 / eff[a]) if P.get("pv") else 1.0)
            p = M.phi(m / sg)
            rows.append({"p": p, "res": _result(g["hs"], g["as"]), "err": (g["hs"] - g["as"]) - m, "d": g["d"]})
    if not rows:
        return {"n": 0, "games": len(ev)}
    out = score(rows)
    out.update({"from": rows[0]["d"][:10], "to": rows[-1]["d"][:10], "games": len(ev)})
    return out


def job_backtest():
    out = {"updated": now_iso(), "leagues": {}}
    brief = {}
    for lg in LEAGUES:
        try:
            out["leagues"][lg] = backtest(lg)
            brief[lg] = out["leagues"][lg].get("n", 0)
        except Exception as e:
            out["leagues"][lg] = {"n": 0, "error": str(e)[:160]}
            brief[lg] = f"error: {e}"[:120]
    write("track/backtest.json", out)
    return brief
