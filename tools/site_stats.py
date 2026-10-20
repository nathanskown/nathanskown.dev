"""Counts for the "Under the hood" page, measured from the files the site actually serves.

Writes data/site.json only when a number changes, so it never causes a commit on its own. Every figure on that page
comes from here or from another data file at view time; none is typed by hand.
"""
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "data"


def load(p, default=None):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return default


def main():
    fin, sp = D / "finance", D / "sports"
    tick = load(fin / "tickers.json", {}) or {}
    mem = load(fin / "members.json", {}) or {}
    qidx = load(fin / "quotes/index.json", {}) or {}
    hl = load(fin / "headlines.json", {}) or {}
    earn = load(fin / "earnings.json", {}) or {}
    ipo = load(fin / "ipo.json", {}) or {}
    own = [p for p in (fin / "ownership").glob("*.json") if p.stem.isupper() or p.stem[:1].isalpha()] if (fin / "ownership").exists() else []
    hist, seasons = {}, {}
    for p in (sp / "history").glob("*_*.json"):
        m = re.match(r"([a-z]+)_(\d{4})$", p.stem)
        if not m:
            continue
        h = load(p, {}) or {}
        if not h.get("complete"):
            continue
        lg = m.group(1)
        hist[lg] = hist.get(lg, 0) + len(h.get("g") or [])
        seasons.setdefault(lg, []).append(int(m.group(2)))
    teams = 0
    for lg in ("nfl", "nba", "nhl", "mlb", "ncaaf", "ncaab", "ncaah"):
        teams += len((load(sp / f"model/{lg}.json", {}) or {}).get("teams") or {})
    track = (load(sp / "track/summary.json", {}) or {}).get("all") or {}

    def js_count(p, pat):
        try:
            return len(re.findall(pat, Path(p).read_text()))
        except OSError:
            return 0
    def artist_count():
        try:
            m = re.search(r'"meta":\{[^}]*"count":(\d+)', (ROOT / "music/data/artists.js").read_text()[:2000])
            return int(m.group(1)) if m else None
        except OSError:
            return None
    out = {
        "markets": {
            "tickersSearchable": len(tick.get("t") or []),
            "quotePages": len(qidx.get("tickers") or []),
            "indexMembers": len(mem.get("names") or {}),
            "ownershipFiles": len(own),
            "headlines": len(hl.get("items") or []),
            "earningsReported": (earn.get("score") or {}).get("n"),
            "iposThisYear": (ipo.get("score") or {}).get("n") if isinstance(ipo.get("score"), dict) else None,
        },
        "sports": {
            "teamsRated": teams,
            "historyGames": sum(hist.values()),
            "historyByLeague": {k: {"games": v, "from": min(seasons[k]), "to": max(seasons[k])} for k, v in sorted(hist.items())},
            "picksGraded": track.get("n"),
        },
        "music": {
            "songs": js_count(ROOT / "music/data/tracks-generated.js", r'"title":') + js_count(ROOT / "music/data/tracks.js", r'title:') + js_count(ROOT / "music/data/tracks-2010s.js", r'title:'),
            "artists": artist_count(),
        },
    }
    prev = load(D / "site.json", {}) or {}
    if {k: v for k, v in prev.items() if k != "updated"} == out:
        return
    out["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (D / "site.json").write_text(json.dumps(out, separators=(",", ":")))


if __name__ == "__main__":
    main()
