"""Monthly data notes: short, numbered findings computed from the site's own data files. No language model and no
hand-typed numbers: every sentence is a template filled from data/finance (13F ownership, screener prices, earnings,
macro, IPOs, index changes) and data/sports (the house model's graded picks).

    python -m pipeline.notes            # write the note for the month that just ended (first week of a month)
    python -m pipeline.notes --now      # write a month-to-date edition for the current month

Output: data/finance/notes/<YYYY-MM>.json and data/finance/notes/index.json.
"""
import json
import statistics
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIN, SPT = ROOT / "data" / "finance", ROOT / "data" / "sports"


def load(p, default=None):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return default


def pct(v, d=1, sign=True):
    return ("+" if sign and v > 0 else "−" if v < 0 else "") + f"{abs(v):.{d}f}%"


def money(v):
    a = abs(v)
    s = f"${a / 1e9:.1f} billion" if a >= 1e9 else f"${a / 1e6:.0f} million"
    return s


def med(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


def columns(scr):
    d = scr.get("d") or {}
    n = len(d.get("sym") or [])
    return [{k: d[k][i] for k in d} for i in range(n)]


def ownership_section(members):
    sp = members.get("sp500") or []
    nm = members.get("names") or {}
    rows = []
    for s in sp:
        o = load(FIN / "ownership" / f"{s}.json")
        if o and o.get("tiles"):
            o["name"] = nm.get(s) or o.get("name") or s
            rows.append(o)
    if len(rows) < 100:
        return None
    t = [o["tiles"] for o in rows]
    period = rows[0].get("period")
    inst = med([x.get("inst") for x in t])
    passive = med([x.get("passive") for x in t])
    chg = med([x.get("instChg") for x in t])
    bul = []
    bul.append(f"Across the {len(rows)} S&P 500 companies with 13F data, the median company is {inst:.1f}% owned by institutions, "
               f"and index funds alone hold a median {passive:.1f}% of shares outstanding.")
    if chg is not None:
        bul.append(f"The median change in institutional ownership from the prior quarter was {pct(chg, 1).replace('%', ' points')}.")
    flows = []
    for o in rows:
        net, px = (o.get("tiles") or {}).get("net"), o.get("price")
        if net and px:
            flows.append((net * px, o["sym"], o.get("name", o["sym"])))
    flows.sort()
    if len(flows) >= 6:
        top = flows[-3:][::-1]
        bot = flows[:3]
        bul.append("Largest net institutional buying (shares bought, valued at today's price): " + "; ".join(f"{n} ({s}) {money(v)}" for v, s, n in top) + ".")
        bul.append("Largest net selling: " + "; ".join(f"{n} ({s}) {money(v)}" for v, s, n in bot) + ".")
    conc = sorted(((o["tiles"].get("top10") or 0, o["sym"], o.get("name", o["sym"])) for o in rows), reverse=True)[:3]
    bul.append("Most concentrated shareholder bases (top 10 holders' share): " + "; ".join(f"{n} ({s}) {c:.0f}%" for c, s, n in conc) + ".")
    idx_heavy = sum(1 for x in t if (x.get("passive") or 0) >= 25)
    bul.append(f"{idx_heavy} of {len(rows)} companies now have a quarter or more of their shares held by index funds, which caps how much "
               "of the shareholder base an investor-relations program can actually move.")
    return {"h": "Who owns the S&P 500", "src": f"SEC 13F filings, quarter ended {period}", "items": bul}


def market_section(scr, members):
    rows = [r for r in columns(scr) if (r.get("idx") or 0) & 1 and r.get("m1") is not None]
    if len(rows) < 100:
        return None
    up = sum(1 for r in rows if r["m1"] > 0)
    m = med([r["m1"] for r in rows])
    by = {}
    for r in rows:
        if r.get("sector"):
            by.setdefault(r["sector"], []).append(r["m1"])
    sec = sorted(((statistics.median(v), k, len(v)) for k, v in by.items() if len(v) >= 8), reverse=True)
    rows.sort(key=lambda r: r["m1"])
    bul = [f"{up} of {len(rows)} S&P 500 stocks rose over the past month ({up / len(rows) * 100:.0f}%); the median member returned {pct(m)}."]
    if len(sec) >= 2:
        bul.append(f"Strongest sector: {sec[0][1]} (median {pct(sec[0][0])}). Weakest: {sec[-1][1]} (median {pct(sec[-1][0])}).")
    bul.append("Best performers: " + "; ".join(f"{r['name']} ({r['sym']}) {pct(r['m1'])}" for r in rows[-3:][::-1]) + ".")
    bul.append("Worst performers: " + "; ".join(f"{r['name']} ({r['sym']}) {pct(r['m1'])}" for r in rows[:3]) + ".")
    gap = [r for r in rows if r.get("offHi") is not None]
    if gap:
        near = sum(1 for r in gap if r["offHi"] > -5)
        bul.append(f"{near} members sit within 5% of their 52-week high.")
    return {"h": "The month in stocks", "src": f"Prices as of {str(scr.get('asOf') or scr.get('updated') or '')[:10]}, delayed", "items": bul}


def earnings_section(e):
    sc = e.get("score") or {}
    if not sc.get("n"):
        return None
    season = (e.get("season") or {}).get("label", "")
    pr = e.get("progress") or {}
    bul = [f"{sc['n']} S&P 500 companies have reported {season} so far ({pr.get('reported', sc['n'])} of {pr.get('total', 503)}); "
           f"{sc.get('beatPct', 0):.0f}% beat the consensus EPS estimate, by {pct(sc.get('avgSurprise') or 0)} on average (median {pct(sc.get('medSurprise') or 0)})."]
    if sc.get("moveBeat") is not None and sc.get("moveMiss") is not None:
        bul.append(f"The average next-day stock move was {pct(sc['moveBeat'])} after a beat and {pct(sc['moveMiss'])} after a miss"
                   + (", so beating has not been enough to be rewarded." if sc["moveBeat"] <= 0 else "."))
    secs = [s for s in (e.get("sectors") or []) if (s.get("n") or 0) >= 5]
    if secs:
        secs.sort(key=lambda s: -s["beat"] / s["n"])
        bul.append("Beat rate by sector, where at least five have reported: " + "; ".join(f"{s['name']} {s['beat']}/{s['n']}" for s in secs) + ".")
    return {"h": "Earnings season", "src": "Nasdaq earnings calendar and consensus estimates", "items": bul}


def macro_section(m):
    lat = m.get("latest") or []
    if not lat:
        return None
    bul = [f"{x['n']}: {x['act']} (prior {x['prior']})." for x in lat[:6]]
    sig = m.get("signals") or []
    if sig:
        warn = [s["n"] for s in sig if s.get("kind") != "ok"]
        bul.append(f"{len(warn)} of {len(sig)} recession signals flashing" + (": " + ", ".join(warn) + "." if warn else "."))
    return {"h": "The economy", "src": "FRED, St. Louis Fed", "items": bul}


def ipo_section(i):
    sc = i.get("score") or {}
    if not sc.get("n"):
        return None
    return {"h": "IPOs", "src": "Nasdaq IPO calendar", "items": [
        f"{sc['n']} IPOs have priced on US exchanges in {i.get('year')}, raising {money(sc.get('proceeds') or 0)}; {sc.get('nSpac', 0)} were SPACs.",
        f"The median first-day move was {pct(sc.get('medD1') or 0)} (average {pct(sc.get('avgD1') or 0)}, skewed by a few big pops); {sc.get('withdrawn', 0)} deals were withdrawn or postponed."]}


def index_section(log, month):
    ch = [c for c in (log.get("changes") or []) if str(c.get("date", "")).startswith(month)]
    if not ch:
        return None
    add = [c for c in ch if c["change"] == "added"]
    rem = [c for c in ch if c["change"] == "removed"]
    bul = []
    for idx in sorted({c["index"] for c in ch}):
        a = [c for c in add if c["index"] == idx]
        r = [c for c in rem if c["index"] == idx]
        bul.append(f"{idx}: added " + (", ".join(f"{c['name']} ({c['sym']})" for c in a) or "none") + "; removed " + (", ".join(f"{c['name']} ({c['sym']})" for c in r) or "none") + ".")
    return {"h": "Index changes", "src": "S&P DJI and FTSE Russell member lists", "items": bul}


def sports_section(t):
    a = (t or {}).get("all") or {}
    if not a.get("n"):
        return None
    return {"h": "The sports model, graded", "src": "Live picks, saved before each game", "items": [
        f"The house model has made {a['n']} graded picks since launch and picked the winner {a['acc'] * 100:.0f}% of the time.",
        f"Its Brier score is {a['brier']:.3f} (a coin flip scores 0.250, always picking the home team {a.get('homeBrier', 0):.3f}); lower is better."]}


def build(month, label, partial):
    members = load(FIN / "members.json", {}) or {}
    parts = [ownership_section(members), market_section(load(FIN / "screener.json", {}) or {}, members),
             earnings_section(load(FIN / "earnings.json", {}) or {}), macro_section(load(FIN / "macro.json", {}) or {}),
             ipo_section(load(FIN / "ipo.json", {}) or {}), index_section(load(FIN / "index_changes.json", {}) or {}, month),
             sports_section(load(SPT / "track" / "summary.json", {}))]
    parts = [p for p in parts if p]
    lead = []
    for p in parts[:3]:
        lead.append(p["items"][0])
    note = {"month": month, "label": label, "partial": partial, "published": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "lead": " ".join(lead), "sections": parts}
    out = FIN / "notes"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{month}.json").write_text(json.dumps(note, separators=(",", ":"), ensure_ascii=False))
    idx = load(out / "index.json", {"notes": []}) or {"notes": []}
    idx["notes"] = [n for n in idx.get("notes", []) if n["month"] != month] + [{"month": month, "label": label, "partial": partial, "published": note["published"]}]
    idx["notes"].sort(key=lambda n: n["month"], reverse=True)
    (out / "index.json").write_text(json.dumps(idx, separators=(",", ":")))
    return note


def main():
    today = date.today()
    if "--now" in sys.argv:
        m = today.strftime("%Y-%m")
        return build(m, today.strftime("%B %Y") + f" (through {today.strftime('%b')} {today.day})", True)
    # first week of a month: the full note for the month that just ended, once
    if today.day > 7:
        return None
    y, mo = (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)
    m = f"{y}-{mo:02d}"
    have = load(FIN / "notes" / f"{m}.json")
    if have and not have.get("partial"):
        return None
    return build(m, date(y, mo, 1).strftime("%B %Y"), False)


if __name__ == "__main__":
    n = main()
    print(json.dumps({"month": n["month"], "sections": [s["h"] for s in n["sections"]]}) if n else "no note due")
