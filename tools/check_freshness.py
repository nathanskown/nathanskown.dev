"""Stale-data check for nathanskown.dev.

Looks at the data files the pages read and flags anything a visitor would take as current when it isn't:
yesterday's moves shown as today's, an old Digest under today's date, pre-market wording after the open,
companies that already reported still listed as upcoming, and the homepage lagging the close.

    python3 tools/check_freshness.py            # check the files in this repo (what the next deploy will serve)
    python3 tools/check_freshness.py --live     # check what https://nathanskown.dev serves right now
    python3 tools/check_freshness.py --now 2026-11-10T15:30:00Z   # pretend it's another time (testing)
    python3 tools/check_freshness.py --json     # machine-readable output

Only reads; changes nothing. Exit code 1 when anything is STALE, 0 otherwise (WARN alone doesn't fail).
Market times follow New York (NYSE) hours. Holidays are listed below for 2026-2027; extend the list each year.
"""
import argparse
import json
import re
import ssl
import sys
import urllib.request
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://nathanskown.dev"
NY = ZoneInfo("America/New_York")
OPEN, CLOSE = time(9, 30), time(16, 0)

# NYSE full-day closures and 1 PM early closes (nyse.com/markets/hours-calendars). Add next year's each December.
HOLIDAYS = {
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03",
    "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05",
    "2027-09-06", "2027-11-25", "2027-12-24",
}
EARLY_CLOSE = {"2026-11-27", "2026-12-24", "2027-11-26"}

# Pre-market wording that is wrong once the session has started.
PREMARKET = re.compile(r"futures point|before the open|ahead of the open|pre-?market|at the open today|"
                       r"set to open|expected to open", re.I)
FILLER = re.compile(r"no headline in our feed yet", re.I)


# ---------------------------------------------------------------- market clock
def trading_day(d):
    return d.weekday() < 5 and d.isoformat() not in HOLIDAYS


def close_time(d):
    return time(13, 0) if d.isoformat() in EARLY_CLOSE else CLOSE


def prev_trading_day(d):
    d -= timedelta(days=1)
    while not trading_day(d):
        d -= timedelta(days=1)
    return d


class Clock:
    """Where the US stock market is right now, in New York time."""

    def __init__(self, now_utc):
        self.utc = now_utc
        self.ny = now_utc.astimezone(NY)
        self.today = self.ny.date()
        self.is_trading_day = trading_day(self.today)
        t = self.ny.time()
        if not self.is_trading_day:
            self.state = "closed"          # weekend or holiday
        elif t < OPEN:
            self.state = "pre"
        elif t < close_time(self.today):
            self.state = "open"
        else:
            self.state = "post"
        # the session whose moves count as "today's" on the site
        self.session = self.today if self.state in ("open", "post") else prev_trading_day(self.today)
        self.open_at = datetime.combine(self.today, OPEN, NY)
        self.close_at = datetime.combine(self.today, close_time(self.today), NY)

    def minutes_since_open(self):
        return (self.ny - self.open_at).total_seconds() / 60

    def minutes_since_close(self):
        return (self.ny - self.close_at).total_seconds() / 60

    def describe(self):
        words = {"pre": "before the open", "open": "market open", "post": "after the close", "closed": "market closed today"}
        return f"{self.ny:%a %b %d %I:%M %p} New York ({words[self.state]})"


# ---------------------------------------------------------------- helpers
def parse_ts(v):
    """ISO string or epoch seconds -> aware UTC datetime (None if missing)."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v, timezone.utc)
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def ny(dt):
    return dt.astimezone(NY) if dt else None


def fmt(dt):
    return ny(dt).strftime("%a %b %d %I:%M %p ET") if dt else "no time"


def report_time(x):
    """When a company's report counts as done (New York): 9:30 AM for before-the-open or untimed, 5:30 PM for after-the-close.
    Same rule as pipeline/jobs.py report_passed and F.reportPassed in assets/dc-runtime.js."""
    try:
        d = date.fromisoformat(x.get("date") or "")
    except ValueError:
        return None
    t = time(17, 30) if (x.get("when") or "").upper() == "AMC" else OPEN
    return datetime.combine(d, t, NY)


def age_min(clock, dt):
    return (clock.utc - dt).total_seconds() / 60 if dt else None


class Loader:
    def __init__(self, live):
        self.live = live
        self.ctx = ssl.create_default_context()

    def json(self, rel):
        try:
            if self.live:
                req = urllib.request.Request(f"{SITE}/{rel}?fresh={int(datetime.now().timestamp())}",
                                             headers={"User-Agent": "nskn-freshness-check/1.0", "Cache-Control": "no-cache"})
                with urllib.request.urlopen(req, timeout=30, context=self.ctx) as r:
                    return json.load(r)
            return json.loads((ROOT / rel).read_text())
        except Exception as e:  # missing file or network trouble is reported, not fatal
            return {"__error__": f"{type(e).__name__}: {e}"}

    def text(self, rel):
        p = ROOT / rel
        return p.read_text() if p.exists() else ""


class Report:
    def __init__(self):
        self.items = []

    def add(self, level, page, msg, fix=""):
        self.items.append({"level": level, "page": page, "msg": msg, "fix": fix})

    def stale(self, page, msg, fix=""):
        self.add("STALE", page, msg, fix)

    def warn(self, page, msg, fix=""):
        self.add("WARN", page, msg, fix)

    def ok(self, page, msg):
        self.add("OK", page, msg)


# ---------------------------------------------------------------- checks
INDEX_TILES = ("spx", "ixic", "dji", "rut")


def check_dashboard(clock, d, r):
    """Index tiles feed the dashboard, the homepage Right Now panel, its ticker and the MKT card."""
    page = "Dashboard + Home"
    if "__error__" in d:
        return r.stale(page, f"dashboard.json could not be read ({d['__error__']})")
    upd = parse_ts(d.get("updated"))
    asof = parse_ts(d.get("asOf"))
    tiles = {t.get("id"): t for t in d.get("tiles") or []}

    if clock.state == "open" and clock.minutes_since_open() > 75:
        a = age_min(clock, upd)
        if a is None or a > 90:
            r.stale(page, f"market data last refreshed {fmt(upd)} ({a:.0f} min ago); it should refresh hourly while the market is open",
                    "check the refresh-finance workflow's latest runs")
        else:
            r.ok(page, f"market data refreshed {a:.0f} min ago")

    lag = []
    for tid in INDEX_TILES:
        t = tiles.get(tid)
        if not t:
            continue
        tt = parse_ts(t.get("time"))
        if not tt:
            continue
        last_trade_day = ny(tt).date()
        if clock.state == "open" and clock.minutes_since_open() > 75 and last_trade_day < clock.today:
            lag.append(f"{t.get('name', tid)} {t.get('pct', 0):+.2f}% (last trade {fmt(tt)})")
        if clock.state == "pre" and last_trade_day < clock.session:
            lag.append(f"{t.get('name', tid)} is from {last_trade_day} (prior session was {clock.session})")
    if lag:
        r.stale(page, "index tiles show an earlier session's move as today's: " + "; ".join(lag),
                "show the prior session as 'prior close' until today's first trade arrives")
    elif clock.state in ("pre", "closed") and tiles.get("spx") and "' CLOSE'" in Loader(False).text("assets/landing.js"):
        r.ok(page, f"index moves are the {clock.session} session's; the homepage labels them with that session's close")
    elif clock.state == "pre" and tiles.get("spx"):
        r.warn(page, f"before the open, the S&P tile's {tiles['spx'].get('pct', 0):+.2f}% is the prior session's "
                     f"({clock.session}) move; the page must label it as the prior close, not today",
               "label index moves 'prior close' before 9:30 ET (or show futures instead)")

    if clock.state == "post" and clock.minutes_since_close() > 30:
        if not asof or asof < clock.close_at:
            r.stale(page, f"after the close but the homepage/dashboard snapshot is from {fmt(asof)}, before today's close; "
                          f"S&P {tiles.get('spx', {}).get('pct', 0):+.2f}% is not the closing move",
                    "add a post-close market refresh (~4:20 PM ET)")
        else:
            r.ok(page, f"snapshot is post-close ({fmt(asof)})")


def check_quotes(clock, q, d, r):
    """quotes/index.json is written once a day (pre-market); its moves are the prior session's."""
    page = "Quotes strip + Watchlist"
    if "__error__" in q:
        return r.stale(page, f"quotes/index.json could not be read ({q['__error__']})")
    upd = parse_ts(q.get("updated"))
    if upd and ny(upd).date() < prev_trading_day(clock.today) and clock.is_trading_day:
        r.stale(page, f"nightly quotes file is from {fmt(upd)}, more than one session old",
                "check the daily refresh-finance run")
    d = d or {}
    dupd = parse_ts(d.get("updated"))
    refreshed_in_session = clock.state in ("open", "post") and dupd and dupd >= clock.open_at + timedelta(minutes=15)
    # quote-page strip: hourly prices from dashboard.json "core", stamped with the session they belong to
    core, ctime = d.get("core") or {}, parse_ts(d.get("coreTime"))
    if not core:
        r.warn(page, "dashboard.json has no hourly core-list prices; the quote-page strip falls back to the nightly file "
                     "(labeled with its session)", "check the 'core list batch quotes' step of the market job")
    elif refreshed_in_session and ctime and ny(ctime).date() < clock.today:
        r.stale(page, f"core-list prices refreshed {fmt(dupd)} still carry the {ny(ctime).date()} session",
                "check the market job's S&P 500 tile and spark quotes")
    else:
        r.ok(page, f"quote strip has hourly prices for {len(core)} tickers from the {ny(ctime).date() if ctime else '?'} session")
    # dashboard watchlist rows carry their own trade time
    watch = d.get("watch") or []
    untimed = [w.get("sym") for w in watch if not w.get("time")]
    old = [w.get("sym") for w in watch if w.get("time") and ny(parse_ts(w["time"])).date() < clock.today]
    if untimed:
        r.stale(page, f"watchlist rows without a trade time ({', '.join(untimed)}): the page can't tell visitors which session they are from",
                "write each watch row's trade time in the market job")
    elif refreshed_in_session and old:
        r.stale(page, f"watchlist refreshed {fmt(dupd)} during today's session still shows an earlier session for {', '.join(old)}")
    elif watch:
        r.ok(page, "watchlist rows carry trade times (earlier sessions are labeled on the page)")


def check_digest(clock, g, ed, d, src, r):
    page = "Digest"
    if "__error__" in g:
        return r.stale(page, f"digest.json could not be read ({g['__error__']})")
    gdate = g.get("date")
    upd = parse_ts(g.get("updated"))
    auto = g.get("auto") or {}
    story = auto.get("story") or {}
    words = json.dumps(story) + " " + (auto.get("tone") or "")

    if clock.is_trading_day and clock.ny.time() >= time(8, 0) and gdate and gdate < clock.today.isoformat():
        r.stale(page, f"Digest is dated {gdate}; today is {clock.today}", "check the digest job in refresh-finance")

    written_after_open = upd and clock.state in ("open", "post") and upd >= clock.open_at
    if written_after_open:
        m = PREMARKET.findall(words)
        if m:
            r.stale(page, f"auto story uses pre-market wording after the open: {', '.join(sorted(set(x.lower() for x in m)))} "
                          f"(written {fmt(upd)})",
                    "switch to session wording once the market opens; drop futures lines after 9:30 ET")

    # Story quotes index moves that belong to an earlier session than the Digest's date
    spx = next((t for t in (d or {}).get("tiles") or [] if t.get("id") == "spx"), None)
    if spx and gdate and re.search(r"S&P 500 is [+-−]?\d", story.get("lede", "")):
        tdate = ny(parse_ts(spx.get("time"))).date().isoformat() if spx.get("time") else None
        if tdate and tdate < gdate and story.get("session") != tdate:
            r.stale(page, f"Digest dated {gdate} says \"{story.get('headline', '')}\" and \"The S&P 500 is {spx.get('pct', 0):+.1f}%\": "
                          f"that is {tdate}'s session, written up as today's",
                    "before the open, write the prior session in past tense ('Monday: stocks rose') and lead with futures")

    n_filler = len(FILLER.findall(words))
    if n_filler:
        r.warn(page, f"auto story has {n_filler} filler line(s) 'no headline in our feed yet'", "drop movers with no headline")

    # Hand-written edition: an old one must never show under today's date (first paint uses it while digest.json loads)
    if ed and "__error__" not in ed and gdate and ed.get("date") and ed["date"] != gdate:
        if re.search(r":\s*HAND\)\s*;", src):
            r.stale(page, f"hand-written edition is from {ed['date']}, and the page falls back to it before digest.json loads "
                          f"(src/finance/Digest.dc.html), so first paint can show it under today's date",
                    "render the hand-written edition only when its date matches today's; otherwise show 'loading'")
        else:
            r.ok(page, f"hand-written edition is from {ed['date']} and is not used as a fallback")

    # Today's watch items that already happened
    if written_after_open and gdate == clock.today.isoformat():
        done = [w.get("e") for w in g.get("watch") or [] if w.get("t") == "BMO"]
        if done:
            r.stale(page, f"'What to watch' still lists before-the-open reports after the open: {'; '.join(done)}",
                    "move BMO reporters to 'reported' once 9:30 ET passes")


def check_earnings(clock, e, g, r):
    page = "Earnings"
    if "__error__" in e:
        return r.stale(page, f"earnings.json could not be read ({e['__error__']})")
    today = clock.today.isoformat()
    t = clock.ny.time()
    past, bmo, amc = [], [], []
    eu, gu = parse_ts(e.get("updated")), parse_ts((g or {}).get("updated"))
    rows = [("Upcoming", x, eu) for x in e.get("upcoming") or []] + \
           [("Digest 'reporting today'", x, gu) for x in (g or {}).get("reportingToday") or [] if x.get("status") != "pending"]
    for where, x, written in rows:
        if x.get("eps") is not None:
            continue
        rt = report_time(x)
        if rt and written and written < rt:
            continue   # written before the report time; the pages move it to "reported, results pending" by the clock
        lab = f"{x.get('sym')} ({x.get('date')} {x.get('when') or '?'}) in {where}"
        if x.get("date") and x["date"] < today:
            past.append(lab)
        elif x.get("date") == today and (x.get("when") or "").upper() == "BMO" and t >= OPEN:
            bmo.append(lab)
        elif x.get("date") == today and (x.get("when") or "").upper() == "AMC" and t >= time(17, 30):
            amc.append(lab)
    if past:
        r.stale(page, "listed as upcoming but the date has passed: " + "; ".join(past))
    if bmo:
        r.stale(page, "before-the-open reporters still shown as upcoming after 9:30 ET: " + "; ".join(bmo),
                "treat BMO names as reported after the open, even before EPS arrives ('reported, results pending')")
    if amc:
        r.warn(page, "after-the-close reporters with no results yet: " + "; ".join(amc))
    unknown = [x.get("sym") for x in e.get("upcoming") or [] if x.get("date") == today and not x.get("when")]
    if unknown:
        r.warn(page, f"today's reporters with unknown timing (shows '—'): {', '.join(unknown)}")
    if not (past or bmo or amc):
        r.ok(page, "no already-reported companies in Upcoming")


# File -> (what writes it, max age in minutes that's normal, when that limit applies)
CADENCE = [
    ("data/finance/headlines.json", "hourly in trading hours", 90, "open"),
    ("data/finance/digest.json", "hourly in trading hours", 90, "open"),
    ("data/finance/earnings.json", "daily (~6 AM CT) + hourly", 26 * 60, "any"),
    ("data/finance/macro.json", "daily", 26 * 60, "any"),
    ("data/sports/status.json", "hourly 9 AM-1 AM CT", 120, "sports"),
]


def check_cadence(clock, L, r):
    for rel, sched, limit, when in CADENCE:
        j = L.json(rel)
        if "__error__" in j:
            r.warn("Data files", f"{rel} could not be read ({j['__error__']})")
            continue
        upd = parse_ts(j.get("updated") or (j.get("market") or {}).get("finished"))
        if not upd:
            continue
        hr_ct = clock.utc.astimezone(ZoneInfo("America/Chicago")).hour
        applies = when == "any" or (when == "open" and clock.state == "open" and clock.minutes_since_open() > 75) or \
                  (when == "sports" and (hr_ct >= 10 or hr_ct < 1))
        a = age_min(clock, upd)
        if applies and a > limit:
            r.stale("Data files", f"{rel} last updated {fmt(upd)} ({a / 60:.1f} h ago); expected {sched}")


# ---------------------------------------------------------------- main
def run(clock, live):
    L = Loader(live)
    r = Report()
    d = L.json("data/finance/dashboard.json")
    q = L.json("data/finance/quotes/index.json")
    g = L.json("data/finance/digest.json")
    ed = L.json("data/finance/editorial.json")
    e = L.json("data/finance/earnings.json")
    src = L.text("src/finance/Digest.dc.html")
    if clock.today.year > 2027:
        r.warn("Checker", "holiday list in tools/check_freshness.py doesn't cover this year; market-hours checks may be off")
    check_dashboard(clock, d, r)
    check_quotes(clock, q, d if "__error__" not in d else {}, r)
    check_digest(clock, g, ed, d if "__error__" not in d else {}, src, r)
    check_earnings(clock, e, g if "__error__" not in g else {}, r)
    check_cadence(clock, L, r)
    return r


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--live", action="store_true", help="check the live site instead of the repo files")
    ap.add_argument("--now", help="ISO time to check as (default: now)")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    now = parse_ts(a.now) if a.now else datetime.now(timezone.utc)
    clock = Clock(now)
    r = run(clock, a.live)
    order = {"STALE": 0, "WARN": 1, "OK": 2}
    items = sorted(r.items, key=lambda x: order[x["level"]])
    if a.json:
        print(json.dumps({"checkedAt": clock.utc.isoformat(), "market": clock.state, "source": SITE if a.live else "repo",
                          "items": items}, indent=1))
    else:
        n = {k: sum(1 for i in items if i["level"] == k) for k in order}
        print(f"Freshness check · {'live site' if a.live else 'repo files'} · {clock.describe()}")
        print(f"{n['STALE']} stale, {n['WARN']} warnings, {n['OK']} ok\n")
        for i in items:
            print(f"[{i['level']}] {i['page']}: {i['msg']}")
            if i["fix"] and i["level"] != "OK":
                print(f"        fix: {i['fix']}")
    sys.exit(1 if any(i["level"] == "STALE" for i in items) else 0)


if __name__ == "__main__":
    main()
