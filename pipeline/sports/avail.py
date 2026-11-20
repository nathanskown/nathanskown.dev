"""How often players listed on the injury report actually play, by status (Questionable, Doubtful, Day-To-Day, ...).

Every live run notes each listed player's status for today (Eastern date). The status kept for a day is the last one seen
before 6:30 PM Eastern, so in-game changes do not count. Once that team's box score for the day is in the lab files
(data/sports/lab/{lg}_{year}.json, ESPN), the entry is graded: played (any minutes) or not. Teams with no game that day
are dropped. The log only grows forward from the day this started; nothing is back-filled.

Writes track/_avail_{lg}.json (the log) and track/avail.json (the rates).
"""
import re
import unicodedata
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from .common import now_iso, read, write

LEAGUES = ("nba", "nhl")
ET = ZoneInfo("America/New_York")
CUTOFF = (18, 30)        # statuses seen after 6:30 PM Eastern are ignored for that day (games are starting)
KEEP_DAYS = 400


def _norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", s)
    return re.sub(r"[^a-z]", "", s)


def _played(lg, rows):
    """Names (normalized) with any playing time in one side's box-score rows."""
    out = set()
    for r in rows or []:
        try:
            if lg == "nba":
                if (r[2] or 0) > 0:
                    out.add(_norm(r[1]))
            elif lg == "nhl":
                mins = r[5] if r[0] == "G" else r[3]
                if (mins or 0) > 0:
                    out.add(_norm(r[2]))
        except (IndexError, TypeError):
            continue
    return out


def _box_by_day(lg, season):
    """{(ET date, ESPN team id): set of names who played} from the lab box scores for this season."""
    out = {}
    for y in (season, season - 1):
        store = read(f"lab/{lg}_{y}.json") or {}
        for g in (store.get("g") or {}).values():
            if not g.get("d") or not g.get("pl"):
                continue
            day = datetime.fromisoformat(g["d"]).replace(tzinfo=timezone.utc).astimezone(ET).date().isoformat()
            for tid, rows in g["pl"].items():
                out[(day, str(tid))] = _played(lg, rows)
    return out


def job_avail():
    now = datetime.now(ET)
    today = now.date().isoformat()
    before_cutoff = (now.hour, now.minute) < CUTOFF
    summary = {"updated": now_iso(), "leagues": {}}
    for lg in LEAGUES:
        rel = f"track/_avail_{lg}.json"
        store = read(rel) or {"since": today, "log": {}}
        log = store["log"]
        inj = read(f"injuries/{lg}.json") or {}
        if before_cutoff:
            for tid, people in (inj.get("teams") or {}).items():
                for p in people or []:
                    st = (p.get("status") or "").strip()
                    if not st or not p.get("name"):
                        continue
                    log[f"{today}|{tid}|{_norm(p['name'])}"] = {"d": today, "t": str(tid), "n": p["name"], "s": st}
        season = (read(f"model/{lg}.json") or {}).get("season")
        box = _box_by_day(lg, int(season)) if season else {}
        for k, e in list(log.items()):
            if "p" in e:
                continue
            if (e["d"], e["t"]) in box:
                e["p"] = 1 if _norm(e["n"]) in box[(e["d"], e["t"])] else 0
            elif e["d"] < today and (datetime.fromisoformat(today) - datetime.fromisoformat(e["d"])).days > 3:
                del log[k]          # no game for that team that day (or its box score never arrived)
        cut = sorted({e["d"] for e in log.values()})
        if len(cut) > KEEP_DAYS:
            old = set(cut[:-KEEP_DAYS])
            for k in [k for k, e in log.items() if e["d"] in old]:
                del log[k]
        write(rel, store)
        rates = {}
        for e in log.values():
            if "p" not in e:
                continue
            r = rates.setdefault(e["s"], {"n": 0, "played": 0})
            r["n"] += 1; r["played"] += e["p"]
        summary["leagues"][lg] = {"since": store["since"], "graded": sum(r["n"] for r in rates.values()),
                                  "pending": sum(1 for e in log.values() if "p" not in e),
                                  "status": [{"status": s, "n": r["n"], "played": r["played"], "rate": round(r["played"] / r["n"], 3)}
                                             for s, r in sorted(rates.items(), key=lambda x: -x[1]["n"])]}
    write("track/avail.json", summary)
    return {lg: v["graded"] for lg, v in summary["leagues"].items()}
