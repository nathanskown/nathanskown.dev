"""Betting-market lines from The Odds API (https://the-odds-api.com), kept so the house model can be
compared with the market. Optional: with no ODDS_API_KEY secret this job does nothing.

  data/sports/odds/{lg}.json   {"updated", "games": {event_id: {"c": kickoff UTC, "h": ESPN home id,
                               "a": ESPN away id, "sp": consensus home spread, "p": no-vig home win
                               probability, "ml": [home price, away price], "bk": books used, "t": seen}}}

When the key is out of credits (HTTP 401 OUT_OF_USAGE_CREDITS) the job raises QuotaExhausted without touching
the stored files; /status then shows the odds feed as FAILING with the time of the last good refresh, and
track/summary.json carries `marketAsOf` so nothing downstream treats frozen lines as current.

A line is refreshed every run until the game starts, then frozen, so each game keeps the last line
seen before kickoff. The free plan allows 500 credits a month; one call here costs one credit per
market per region, and calls are made at most once a day (the daily job), only for sports in season.
The `/sports` list used to check what is in season is free.

The API key travels in the URL, so every error message is scrubbed of it before it is logged or saved."""
import os
import re
import statistics
import time
from datetime import datetime, timedelta, timezone

from .common import SESSION, UA, read, write, now_iso

BASE = "https://api.the-odds-api.com/v4"
SPORT = {"nfl": "americanfootball_nfl", "ncaaf": "americanfootball_ncaaf", "nba": "basketball_nba",
         "ncaab": "basketball_ncaab", "nhl": "icehockey_nhl"}
MARKETS = "h2h,spreads"            # 2 credits per sport per call; 5 sports = 10 credits a day = ~300 a month
KEEP_DAYS = 21
MIN_HOURS = 20


class QuotaExhausted(RuntimeError):
    """The key has no credits left (HTTP 401 OUT_OF_USAGE_CREDITS, or 429). Carries the status fields that
    /status shows, so the outage is flagged instead of the stored lines silently going stale."""

    def __init__(self, msg):
        super().__init__(msg)
        self.status = {"quota": True, "asOf": last_good()}


def last_good():
    """Newest `updated` stamp across the stored odds files: when the lines on file were last refreshed."""
    best = None
    for lg in SPORT:
        u = (read(f"odds/{lg}.json") or {}).get("updated")
        if u and (best is None or u > best):
            best = u
    return best


def _scrub(msg, key):
    return msg.replace(key, "***") if key else msg


def _call(path, key, params=None):
    p = dict(params or {}, apiKey=key)
    try:
        r = SESSION.get(BASE + path, params=p, headers={"User-Agent": UA}, timeout=30)
    except Exception as e:
        raise RuntimeError(_scrub(f"Odds API request failed: {e}", key)) from None
    if r.status_code == 429 or (r.status_code == 401 and "OUT_OF_USAGE_CREDITS" in r.text):
        raise QuotaExhausted(f"Odds API out of credits (HTTP {r.status_code}); stored lines are frozen as of {last_good() or 'never'}")
    if r.status_code != 200:
        raise RuntimeError(f"Odds API HTTP {r.status_code}: {_scrub(r.text[:160], key)}")
    return r.json(), r.headers


def norm(s):
    s = (s or "").lower().replace("&", " and ").replace("’", "'")
    s = re.sub(r"\bsaint\b|\bst\.", "st", s)
    s = re.sub(r"\bstate\b", "st", s)
    s = re.sub(r"[^a-z0-9 ]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def team_lookup(lg):
    idx = (read("teams.json") or {}).get("leagues", {}).get(lg, [])
    full = {norm(t["name"]): t["id"] for t in idx}
    loc = sorted(((norm(t.get("loc")), t["id"]) for t in idx if t.get("loc")), key=lambda x: -len(x[0]))

    def find(name):
        n = norm(name)
        if n in full:
            return full[n]
        for l, tid in loc:                       # "Michigan St Spartans" starts with "michigan st"
            if l and (n == l or n.startswith(l + " ")):
                return tid
        return None
    return find


def _novig(a, b):
    ia, ib = 1 / a, 1 / b
    return ia / (ia + ib)


def consensus(ev):
    """Median home spread and average no-vig home win probability across bookmakers."""
    spreads, probs, prices, home, away = [], [], [], ev["home_team"], ev["away_team"]
    for bk in ev.get("bookmakers", []):
        for m in bk.get("markets", []):
            out = {o["name"]: o for o in m.get("outcomes", [])}
            if m["key"] == "spreads" and home in out and out[home].get("point") is not None:
                spreads.append(float(out[home]["point"]))
            if m["key"] == "h2h" and home in out and away in out:
                ph, pa = float(out[home]["price"]), float(out[away]["price"])
                probs.append(_novig(ph, pa)); prices.append((ph, pa))
    if not spreads and not probs:
        return None
    row = {"bk": max(len(spreads), len(probs))}
    if spreads:
        row["sp"] = statistics.median(spreads)
    if probs:
        row["p"] = round(sum(probs) / len(probs), 4)
        row["ml"] = [round(statistics.median(x[0] for x in prices), 3), round(statistics.median(x[1] for x in prices), 3)]
    return row


def job_odds():
    key = os.environ.get("ODDS_API_KEY", "").strip()
    if not key:
        return {"skipped": "no ODDS_API_KEY secret set"}
    now = datetime.now(timezone.utc)
    lg_ok = last_good()
    if lg_ok and now - datetime.fromisoformat(lg_ok) < timedelta(hours=MIN_HOURS):
        return {"skipped": f"lines refreshed {lg_ok}; at most one paid call per sport every {MIN_HOURS} h"}   # re-runs and manual dispatches must not burn credits
    active, hdr = _call("/sports", key)
    live = {s["key"] for s in active if s.get("active")}
    out, remaining = {}, None
    for lg, sk in SPORT.items():
        if sk not in live:
            out[lg] = "out of season"
            continue
        data, hdr = _call(f"/sports/{sk}/odds", key, {"regions": "us", "markets": MARKETS, "oddsFormat": "decimal", "dateFormat": "iso"})
        remaining = hdr.get("x-requests-remaining", remaining)
        find = team_lookup(lg)
        store = read(f"odds/{lg}.json") or {}
        games = store.get("games", {})
        seen = miss = 0
        stamp = now.replace(microsecond=0).isoformat()
        for ev in data:
            start = datetime.fromisoformat(ev["commence_time"].replace("Z", "+00:00"))
            h, a = find(ev["home_team"]), find(ev["away_team"])
            if not h or not a:
                miss += 1
                print(f"  {lg}: no team match for {ev['away_team']!r} at {ev['home_team']!r}")
                continue
            row = consensus(ev)
            if not row:
                continue
            old = games.get(ev["id"])
            if old and start <= now:              # started: keep the last line seen before kickoff
                continue
            games[ev["id"]] = dict(row, c=ev["commence_time"], h=h, a=a, t=stamp)
            seen += 1
        cutoff = (now - timedelta(days=KEEP_DAYS)).isoformat()
        games = {k: v for k, v in games.items() if v["c"] >= cutoff}
        write(f"odds/{lg}.json", {"updated": now_iso(), "games": games})
        out[lg] = {"events": len(data), "stored": len(games), "updated": seen, "unmatched": miss}
        try:
            if remaining is not None and float(remaining) < 2:      # not enough for another sport: stop cleanly
                out["creditsLow"] = True
                break
        except ValueError:
            pass
        time.sleep(0.5)
    out["creditsRemaining"] = remaining
    return out
