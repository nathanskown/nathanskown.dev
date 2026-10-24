"""How the house sports model got better, measured: model/evolution.json (read by /sports/model-history/).

Nothing here is typed in by hand. The tuner (tune.py) already refits the model's settings for each of the four newest
seasons using only the seasons before it. This replays those same held-out seasons with the model rebuilt one
ingredient at a time, in the order the ingredients were added to the site:

  base      no model at all: every game gets the home team's usual win rate (from the seasons before it)
  launch    the settings the site went live with (one season of results, a prior pulled toward average)
  carry     + last season's rating as the starting point for this season
  tuned     + settings fitted on past seasons (prior weight, home edge, margin limits, new-team handling)
  recency   + recent games count more, and a win probability is widened while a rating is still uncertain
  rest      + days of rest
  extra     + NHL expected goals or the MLB starting pitchers

Every step is scored on seasons the fitted settings never saw. A second table takes each ingredient away from the
final model instead (order-free). A third series scores every season from launch settings vs the current ones, and
says which seasons are in-sample (the current settings were fitted on seasons that include them).

    python -m pipeline.sports.evolution          # about a minute per league
"""
import json
import math
import sys

import numpy as np

from . import model as M
from . import tune as T
from .common import now_iso, read, write
from .leagues import LEAGUES

# PARAMS as shipped in commit 0792acbd5 (the first live model): one season's results, no carry-over, no extras
LAUNCH = {
    "nfl": dict(hfa=1.8, divHfa=0.9, k=5, cap=None),
    "ncaaf": dict(hfa=2.5, k=4, cap=35),
    "nhl": dict(hfa=0.2, k=10, cap=None),
    "nba": dict(hfa=2.5, k=10, cap=None),
    "mlb": dict(hfa=0.15, k=20, cap=None),
    "ncaab": dict(hfa=3.0, k=6, cap=40),
    "ncaah": dict(hfa=0.25, k=6, cap=None),
}
CORE = ("k", "hfa", "divHfa", "cap", "soft", "newp", "ps", "c2", "c3")
STAGES = [
    ("launch", "Launch settings", "The model as it went live on Oct 14: one season of results, a prior pulled toward average, no history."),
    ("carry", "+ Last season carried over", "Each team starts the year at its final rating from last season instead of average."),
    ("tuned", "+ Settings fitted on past seasons", "Prior weight, home edge and margin limits chosen by replaying past seasons instead of guessed."),
    ("recency", "+ Recency and uncertainty", "Recent games count more; early-season probabilities are widened while ratings are still uncertain."),
    ("rest", "+ Days of rest", "Back-to-backs, byes and short weeks move the projection."),
    ("extra", "+ Expected goals / starting pitchers", "NHL ratings use expected-goals margin (MoneyPuck); MLB projections use the day's starters."),
    ("avail", "+ Who is playing", "NBA and NFL player availability, college football starting quarterbacks and college basketball roster turnover, from box scores, snap counts, rosters and injury reports."),
]
LAST = STAGES[-1][0]
ORDER = tuple(s[0] for s in STAGES)


def stage_params(lg, fit):
    """Cumulative parameter sets for one fold's fitted settings."""
    base = dict(LAUNCH[lg], carry=0.0)
    out = {"launch": dict(base)}
    p = dict(base, carry=fit.get("carry", 0.0))
    out["carry"] = dict(p)
    p = dict(p)
    for k in CORE:
        if k in fit:
            p[k] = fit[k]
    if "soft" in fit and fit["soft"]:
        p["cap"] = None
    out["tuned"] = dict(p)
    p = dict(p, hl=fit.get("hl"), pv=fit.get("pv", 0))
    out["recency"] = dict(p)
    p = dict(p, rest=fit.get("rest", 0))
    out["rest"] = dict(p)
    p = dict(p, **{k: fit[k] for k in ("xg", "sp") if k in fit})
    out["extra"] = dict(p)
    p = dict(p, **{k: fit[k] for k in ("av", "ret", "rp") if k in fit})
    out["avail"] = dict(p)
    return out


def without(lg, fit, group):
    """The fold's fitted settings with one ingredient put back to its launch value."""
    p = dict(fit)
    if group == "carry":
        p["carry"] = 0.0
    elif group == "tuned":
        for k in CORE:
            p.pop(k, None)
        p.update(LAUNCH[lg])
    elif group == "recency":
        p["hl"], p["pv"] = None, 0
    elif group == "rest":
        p["rest"] = 0
    elif group == "extra":
        p.pop("xg", None); p.pop("sp", None)
    elif group == "avail":
        p.pop("av", None); p.pop("ret", None); p.pop("rp", None)
    return p


class Replays:
    """Replay cache: one walk-forward pass per (settings, season), reused by every fold that needs it."""

    def __init__(self, L):
        self.L, self.c = L, {}

    def one(self, p, y):
        key = (json.dumps(p, sort_keys=True, default=str), y)
        if key not in self.c:
            S = self.L.seasons[y]
            P, U = T.replay(self.L, S, p, T.prior_for(self.L, y, p))
            self.c[key] = (P, U, S.m)
        return self.c[key]

    def many(self, p, ys):
        r = [self.one(p, y) for y in ys]
        return np.concatenate([x[0] for x in r]), np.concatenate([x[1] for x in r]), np.concatenate([x[2] for x in r])

    def holdout(self, train, hold, p):
        Pt, Ut, At = self.many(p, train)
        s0 = T.fit_sigma(Pt, Ut, At, p.get("pv"), p.get("ps"))
        P, U, A = self.one(p, hold)
        return T.score(P, U, A, s0, p.get("pv"))


def _r(v):
    return None if v is None else round(float(v), 4)


def pool(rows):
    n = sum(r["n"] for r in rows)
    w = lambda k: sum(r[k] * r["n"] for r in rows if r[k] is not None) / n
    return {"n": n, "brier": _r(w("brier")), "logloss": _r(w("logloss")), "acc": _r(w("acc"))}


def base_rate_score(L, train, hold):
    res = np.concatenate([np.where(L.seasons[y].m > 0, 1.0, np.where(L.seasons[y].m < 0, 0.0, 0.5)) for y in train])
    p0 = float(res.mean())
    r = np.where(L.seasons[hold].m > 0, 1.0, np.where(L.seasons[hold].m < 0, 0.0, 0.5))
    dec = L.seasons[hold].m != 0
    ll = -(r * math.log(p0) + (1 - r) * math.log(1 - p0))
    return {"n": int(len(r)), "brier": float(((p0 - r) ** 2).mean()), "logloss": float(ll.mean()),
            "acc": float(((p0 >= 0.5) == (r == 1.0))[dec].mean())}


def league(lg, tuned):
    t = tuned[lg]
    L = T.League(lg)
    R = Replays(L)
    covid = T.COVID.get(lg, set())
    usable = [y for y in L.years if (y - 1) in L.seasons and y not in covid][-T.WINDOW:]
    folds = {f["holdout"]: f for f in t["folds"]}
    stages = [("base", "No model: the home team's usual win rate", "Every game gets the same probability: the home win rate of the seasons before it.")] + STAGES
    ladder = []
    per = {s[0]: [] for s in stages}
    for hold, f in sorted(folds.items()):
        train = [y for y in usable if y < hold]
        per["base"].append(dict(base_rate_score(L, train, hold), holdout=hold))
        sp = stage_params(lg, f["fit"])
        for sid, *_ in STAGES:
            s = R.holdout(train, hold, sp[sid])
            per[sid].append({"holdout": hold, "n": s["n"], "brier": s["brier"], "logloss": s["logloss"], "acc": s["acc"]})
        # the last stage must reproduce what the tuner recorded for this fold
        got, rec = per[LAST][-1]["brier"], f["fitted"]["brier"]
        assert abs(got - rec) < 2e-4, f"{lg} {hold}: ladder end {got:.4f} != tuner {rec:.4f}"
    prev = None
    for sid, label, note in stages:
        rows = per[sid]
        if sid in ORDER[1:]:
            ps = [stage_params(lg, folds[h]["fit"]) for h in sorted(folds)]
            before = [ORDER[ORDER.index(sid) - 1]]
            same = all(p[sid] == p[before[0]] for p in ps)
            if same:
                continue      # this ingredient does not apply to the league (e.g. no xG outside the NHL)
        ladder.append({"id": sid, "label": label, "note": note, "folds": [{k: _r(v) if isinstance(v, float) else v for k, v in r.items()} for r in rows],
                       "pooled": pool(rows)})
    # leave one out
    full = pool(per[LAST])
    ablation = []
    for g, label in (("carry", "last season carried over"), ("tuned", "fitted settings"), ("recency", "recency and uncertainty"),
                     ("rest", "days of rest"), ("extra", "expected goals / starting pitchers"), ("avail", "who is playing")):
        rows, applies = [], False
        for hold, f in sorted(folds.items()):
            train = [y for y in usable if y < hold]
            q = without(lg, f["fit"], g)
            applies = applies or q != f["fit"]
            s = R.holdout(train, hold, q)
            rows.append({"n": s["n"], "brier": s["brier"], "logloss": s["logloss"], "acc": s["acc"]})
        if not applies:
            continue
        pl = pool(rows)
        ablation.append({"id": g, "label": label, "brier": pl["brier"], "delta": _r(pl["brier"] - full["brier"]),
                         "deltaLogloss": _r(pl["logloss"] - full["logloss"])})
    # every season, launch vs current settings
    live = t.get("params") or dict(t.get("preset") or {}, **(t.get("fixedLive") or {}))     # preset settings when the fit was not adopted
    final = {k: v for k, v in live.items() if k not in ("sigma", "sigmaMargin")}
    seasons = []
    for y in usable:
        others = [x for x in usable if x != y]
        row = {"y": y, "heldOut": y in folds}
        for key, p in (("launch", dict(LAUNCH[lg], carry=0.0)), ("current", folds[y]["fit"] if y in folds else final)):
            if y in folds:
                s = R.holdout([x for x in usable if x < y], y, p)
            else:
                s = R.holdout(others, y, p)
            row[key] = _r(s["brier"])
            if key == "current":
                row["acc"] = _r(s["acc"]); row["n"] = s["n"]
        res = np.where(L.seasons[y].m > 0, 1.0, np.where(L.seasons[y].m < 0, 0.0, 0.5))
        ro = np.concatenate([np.where(L.seasons[x].m > 0, 1.0, np.where(L.seasons[x].m < 0, 0.0, 0.5)) for x in others])
        row["base"] = _r(((ro.mean() - res) ** 2).mean())
        seasons.append(row)
    return {"label": LEAGUES[lg]["label"], "unit": M.PARAMS[lg]["unit"], "seasonsUsed": [usable[0], usable[-1]], "covidExcluded": sorted(covid & set(L.years)),
            "heldOut": sorted(folds), "ladder": ladder, "ablation": ablation, "seasons": seasons,
            "final": {k: v for k, v in final.items()}, "adopted": bool(t.get("adopt")), "gate": {"gain": t.get("gain"), "z": t.get("z"), "folds": t.get("foldsImproved")}}


def job_evolution(only=None):
    tuned = read("model/tuned.json") or {}
    out = {"updated": now_iso(), "version": 1, "leagues": {}}
    for lg in ("nfl", "ncaaf", "nhl", "nba", "ncaab", "ncaah", "mlb"):
        if only and lg not in only:
            continue
        if not (tuned.get(lg) or {}).get("folds"):
            continue
        out["leagues"][lg] = league(lg, tuned)
        print(lg, "done", flush=True)
    prev = read("model/evolution.json") or {}
    for lg, v in (prev.get("leagues") or {}).items():
        out["leagues"].setdefault(lg, v)
    write("model/evolution.json", out)
    return {lg: len(v["ladder"]) for lg, v in out["leagues"].items()}


if __name__ == "__main__":
    print(job_evolution(sys.argv[1:] or None))
