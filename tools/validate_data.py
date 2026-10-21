"""Publishing gate for the data files the site reads.

Runs in the data workflows after a job writes its files and before they are committed. Every changed file under
data/ is checked; a file that fails a hard check is put back to its last committed version, so visitors keep the
last good numbers instead of bad ones. Results go to data/validation.json, which the status page shows.

    python tools/validate_data.py            # check the staged/changed files, revert failures, write the log
    python tools/validate_data.py --all      # check every known file (no reverts), for a local audit

Exit code is 0 even when files were held back: a bad source should never stop the rest of the site updating.
"""
import json
import math
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def finite(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


class Checks:
    def __init__(self):
        self.fails, self.n = [], 0

    def ok(self, cond, msg):
        self.n += 1
        if not cond:
            self.fails.append(msg)


# ---------------------------------------------------------------- finance
RANGES = {  # tile id -> (low, high, max one-day % move) for prices that would mean a broken feed if outside
    "spx": (1000, 30000, 15), "ixic": (3000, 100000, 15), "dji": (10000, 200000, 15), "rut": (500, 10000, 20),
    "vix": (5, 150, 120), "tnx": (0, 15, 40), "dxy": (60, 160, 6), "wti": (5, 300, 40), "gold": (500, 20000, 15),
    "btc": (1000, 2000000, 40),
}


def dashboard(d, c):
    tiles = d.get("tiles") or []
    c.ok(len(tiles) >= 6, f"only {len(tiles)} market tiles")
    for t in tiles:
        p = t.get("price")
        c.ok(p is None or finite(p), f"{t.get('id')} price is not a number")
        if t.get("id") in RANGES and finite(p):
            lo, hi, mv = RANGES[t["id"]]
            c.ok(lo <= p <= hi, f"{t['id']} price {p} outside {lo}-{hi}")
            if finite(t.get("pct")):
                c.ok(abs(t["pct"]) <= mv, f"{t['id']} moved {t['pct']}% in a day")
    b = d.get("breadth") or {}
    if b.get("n"):
        c.ok(b.get("adv", 0) + b.get("dec", 0) <= b["n"], "breadth adds up to more than the index")
    for s in d.get("sectors") or []:
        c.ok(finite(s.get("pct")) and abs(s["pct"]) < 20, f"sector {s.get('name')} move {s.get('pct')}")


def quote(d, c):
    q = d.get("quote") or {}
    c.ok(d.get("sym"), "quote file has no symbol")
    if q:
        c.ok(finite(q.get("price")) and q["price"] > 0, f"{d.get('sym')} price {q.get('price')}")
    st = d.get("stats") or {}
    if finite(st.get("hi52")) and finite(st.get("lo52")):
        c.ok(st["hi52"] >= st["lo52"], f"{d.get('sym')} 52-week high below low")


def macro(d, c):
    c.ok(len(d.get("latest") or []) >= 3, "fewer than 3 macro releases")
    for t in d.get("tiles") or []:
        v = str(t.get("value", "")).replace("%", "").replace("+", "").replace(",", "").replace("K", "").replace("$", "").replace("−", "-").strip()
        try:
            x = float(v)
        except ValueError:
            x = None
        c.ok(v in ("", "—") or (x is not None and math.isfinite(x)), f"macro tile {t.get('id')} reads {t.get('value')!r}")
        if t.get("id") == "UNRATE" and x is not None:
            c.ok(0 < x < 30, f"unemployment rate {x}%")


def headlines(d, c):
    items = d.get("items") or []
    c.ok(len(items) >= 20, f"only {len(items)} headlines")
    c.ok(all(i.get("title") and i.get("link") for i in items[:50]), "headline without a title or link")


def earnings(d, c):
    sc = d.get("score") or {}
    for k in ("beatPct",):
        v = sc.get(k)
        c.ok(v is None or (finite(v) and 0 <= v <= 100), f"earnings {k} = {v}")
    pr = d.get("progress") or {}
    if finite(pr.get("reported")) and finite(pr.get("total")):
        c.ok(pr["reported"] <= pr["total"], "more S&P 500 reports than companies")


def digest(d, c):
    c.ok(bool(d.get("date")), "digest has no date")
    c.ok(bool((d.get("auto") or {}).get("story")), "digest has no auto-written story")


# ---------------------------------------------------------------- sports
def model(d, c):
    teams = d.get("teams") or {}
    c.ok(len(teams) >= 20, f"model has {len(teams)} teams")
    c.ok(finite(d.get("sigma")) and d["sigma"] > 0, "model sigma missing")
    c.ok(finite(d.get("hfa")) and abs(d["hfa"]) < 10, f"home edge {d.get('hfa')}")
    bad = [t for t, r in teams.items() if not finite(r.get("rating"))]
    c.ok(not bad, f"{len(bad)} teams without a numeric rating")
    sig = d.get("sigma") or 1
    wild = [t for t, r in teams.items() if finite(r.get("rating")) and abs(r["rating"]) > 4 * sig]
    c.ok(not wild, f"{len(wild)} ratings more than 4 sigma from average")
    odds = d.get("odds")
    if isinstance(odds, dict) and odds:
        for t, o in odds.items():
            for k in ("playoff", "div", "conf", "title", "seed1"):
                if k in o:
                    c.ok(0 <= o[k] <= 1, f"{t} {k} probability {o[k]}")
        tot = sum(o.get("title", 0) for o in odds.values())
        c.ok(abs(tot - 1) < 0.02, f"title odds add to {tot:.3f}, not 1")


def standings(d, c):
    for g in d.get("groups") or []:
        for t in g.get("teams") or []:
            w, l, gp = t.get("w"), t.get("l"), t.get("gp")
            if all(finite(x) for x in (w, l, gp)):
                extra = sum(t.get(k) or 0 for k in ("t", "otl") if finite(t.get(k) or 0))
                c.ok(w + l + extra == gp or not gp, f"{t.get('abbr')} {w}-{l} does not add to {gp} games")


def track(d, c):
    a = d.get("all") or {}
    if a.get("n"):
        c.ok(a.get("hits", 0) <= a.get("decided", a["n"]) <= a["n"], "track record counts do not tie")
        c.ok(0 <= a.get("brier", 0) <= 1, f"Brier score {a.get('brier')}")


def evolution(d, c):
    for lg, v in (d.get("leagues") or {}).items():
        lad = v.get("ladder") or []
        c.ok(len(lad) >= 4, f"{lg} model history has {len(lad)} steps")
        for s in lad:
            b = (s.get("pooled") or {}).get("brier")
            c.ok(finite(b) and 0.05 < b < 0.3, f"{lg} {s.get('id')} Brier {b}")
        c.ok(all(finite(r.get("launch")) and finite(r.get("current")) for r in v.get("seasons") or []), f"{lg} season series has gaps")


def injuries(d, c):
    c.ok(isinstance(d.get("teams"), dict), "injury file has no teams")


def rule_for(rel):
    if rel == "finance/dashboard.json":
        return dashboard
    if rel.startswith("finance/quotes/") and not rel.endswith("/index.json"):
        return quote
    if rel == "finance/macro.json":
        return macro
    if rel == "finance/headlines.json":
        return headlines
    if rel == "finance/earnings.json":
        return earnings
    if rel == "finance/digest.json":
        return digest
    if rel == "sports/model/evolution.json":
        return evolution
    if rel.startswith("sports/model/") and not Path(rel).name.startswith("_") and rel.count("/") == 2 and rel not in ("sports/model/tuned.json", "sports/model/milestones.json"):
        return model
    if rel.startswith("sports/standings/"):
        return standings
    if rel == "sports/track/summary.json":
        return track
    if rel.startswith("sports/injuries/"):
        return injuries
    return None


def changed():
    out = subprocess.run(["git", "status", "--porcelain", "--", "data"], cwd=ROOT, capture_output=True, text=True).stdout
    return [line[3:].strip() for line in out.splitlines() if line[3:].strip().endswith(".json")]


def main():
    audit = "--all" in sys.argv
    files = [str(p.relative_to(ROOT)) for p in DATA.rglob("*.json")] if audit else changed()
    log = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "checked": 0, "checks": 0, "held": []}
    try:
        prev = json.loads((DATA / "validation.json").read_text())
    except (OSError, ValueError):
        prev = {}
    for f in sorted(files):
        rel = f[len("data/"):] if f.startswith("data/") else f
        rule = rule_for(rel)
        p = ROOT / f
        if not p.exists():
            continue
        c = Checks()
        try:
            obj = json.loads(p.read_text())
        except ValueError:
            c.fails.append("not valid JSON")
            obj = None
        if obj is not None and rule:
            try:
                rule(obj, c)
            except Exception as e:  # a check that crashes counts as a failure, never as a pass
                c.fails.append(f"check crashed: {e}"[:160])
        if obj is None or rule:
            log["checked"] += 1
        log["checks"] += c.n
        if c.fails:
            log["held"].append({"file": rel, "why": c.fails[:5]})
            print(f"HOLD {rel}: " + "; ".join(c.fails[:5]))
            if not audit:
                had = subprocess.run(["git", "cat-file", "-e", f"HEAD:{f}"], cwd=ROOT).returncode == 0
                if had:
                    subprocess.run(["git", "checkout", "-q", "HEAD", "--", f], cwd=ROOT)
                else:
                    p.unlink()
    if audit:
        print(json.dumps(log, indent=1))
        return 0
    # keep a short history of held files so the status page can show the last problems, not just this run
    hist = (prev.get("recent") or [])
    if log["held"]:
        hist = ([{"at": log["at"], "held": log["held"]}] + hist)[:10]
    log["recent"] = hist
    log["lastHeld"] = log["at"] if log["held"] else prev.get("lastHeld")
    # written when something was held back, and otherwise once a day as a heartbeat, so the log alone never
    # turns an hour with no real data change into a commit and a redeploy
    if log["checked"] and (log["held"] or str(prev.get("at", ""))[:10] != log["at"][:10]):
        (DATA / "validation.json").write_text(json.dumps(log, separators=(",", ":")))
    print(f"validated {log['checked']} files, {log['checks']} checks, held back {len(log['held'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
