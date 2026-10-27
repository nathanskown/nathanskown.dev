"""The lab: richer per-game data for every league, collected on GitHub's runners (the only place ESPN is reachable
from), so models can be tested against the closing betting lines and against who actually played.

  data/sports/lab/{lg}_{year}.json    {"year", "v", "g": {event id: row}}

One ESPN summary request per game carries the closing line (pickcenter) and the box score, so a season costs one
request per game after a scoreboard crawl for the event ids. Modes (python -m pipeline.sports.run lab):
  probe     save one raw summary per league to data/sports/lab/_probe/ (to learn the shapes)
  collect   per league and season: every completed regular-season game's closing line and box score, kept compact
  cfbd      probe CollegeFootballData lines and player endpoints (needs the CFBD_KEY secret)
"""
import io
import json
import os
import time
from datetime import date, timedelta

from .common import ESPN, get, read, write, now_iso
from .leagues import LEAGUES, path

CORE = "https://sports.core.api.espn.com/v2/sports/"
SEASONS = {"nhl": [2022, 2023, 2024, 2025, 2026], "nba": [2022, 2023, 2024, 2025, 2026], "ncaab": [2023, 2024, 2025, 2026],
           "nfl": [], "ncaaf": [2021, 2022, 2023, 2024, 2025, 2026], "ncaah": [], "mlb": []}
WINDOW = {"nhl": ((10, 1), (6, 25)), "nba": ((10, 15), (6, 25)), "ncaab": ((11, 1), (3, 20)), "ncaaf": ((8, 20), (1, 20))}
STEP = {"nhl": 7, "nba": 7, "ncaab": 1, "ncaaf": 7}
FOOTBALL = {"nfl", "ncaaf"}                      # season year = start year, so the window runs into the next calendar year
PROBE_DATES = {"nfl": "20251116", "ncaaf": "20251115", "nhl": "20260110", "nba": "20260110", "ncaab": "20260110",
               "ncaah": "20260110", "mlb": "20250715"}


def _trim(o, depth=0):
    """Keep a raw record readable: lists longer than 40 items are cut (shape matters, not volume)."""
    if isinstance(o, dict):
        return {k: _trim(v, depth + 1) for k, v in o.items()}
    if isinstance(o, list):
        return [_trim(v, depth + 1) for v in o[:40]]
    return o


def job_probe():
    only = [x for x in os.environ.get("LAB_LG", "").split(",") if x] or list(LEAGUES)
    out = {}
    for lg in only:
        try:
            sb = get(ESPN + path(lg) + "/scoreboard", {"dates": PROBE_DATES[lg], "limit": "50", **({"groups": LEAGUES[lg]["groups"]} if LEAGUES[lg].get("groups") else {})})
            ev = [e for e in sb.get("events", []) if e.get("status", {}).get("type", {}).get("completed")]
            if not ev:
                out[lg] = f"no completed events on {PROBE_DATES[lg]}"
                continue
            e = ev[0]
            eid = e["id"]
            summ = get(ESPN + path(lg) + "/summary", {"event": eid})
            write(f"lab/_probe/{lg}_summary.json", _trim(summ))
            write(f"lab/_probe/{lg}_scoreboard_event.json", _trim(e))
            try:
                od = get(f"{CORE}{path(lg)}/events/{eid}/competitions/{eid}/odds", {"limit": "20"})
                write(f"lab/_probe/{lg}_core_odds.json", _trim(od))
                out[lg] = {"event": eid, "odds": len(od.get("items", []))}
            except Exception as ex:
                out[lg] = {"event": eid, "odds_error": str(ex)[:120]}
        except Exception as ex:
            out[lg] = f"error: {ex}"[:200]
    return out


# ---------------------------------------------------------------- per-game extraction
def _line(summ):
    """(home margin the market expects, total, home moneyline, away moneyline) from the summary's first pickcenter entry."""
    pc = summ.get("pickcenter") or []
    if not pc:
        return None
    o = pc[0]
    try:
        sp = o.get("spread")
        home = o.get("homeTeamOdds") or {}
        margin = None
        if sp is not None:
            margin = abs(float(sp)) if home.get("favorite") else -abs(float(sp))
            if float(sp) == 0:
                margin = 0.0
        return {"sp": margin, "tot": o.get("overUnder"), "ml": [home.get("moneyLine"), (o.get("awayTeamOdds") or {}).get("moneyLine")],
                "prov": (o.get("provider") or {}).get("name")}
    except (TypeError, ValueError):
        return None


def _stat(labels, stats, name):
    try:
        return stats[labels.index(name)]
    except (ValueError, IndexError, TypeError):
        return None


def _num(v):
    try:
        return float(str(v).replace("%", ""))
    except (TypeError, ValueError):
        return None


def _mins(v):
    """"32:15" or "32" -> minutes."""
    if v is None:
        return None
    s = str(v)
    if ":" in s:
        a, b = s.split(":")[:2]
        return float(a) + float(b) / 60
    return _num(s)


BASKET = ("nba", "ncaab")
BOX_LEN = 17          # basketball rows: id, name, MIN, PTS, +/-, starter, FGM, FGA, FTM, FTA, OREB, DREB, AST, STL, BLK, TO, PF


def _pair(x):
    try:
        a, b = str(x).split("-")
        return float(a), float(b)
    except (ValueError, AttributeError):
        return None, None


def _complete(lg, row):
    """A stored row has everything this version collects (older rows lack the full box score)."""
    if lg in BASKET or lg == "nhl" or lg in FOOTBALL:
        pl = row.get("pl")
        if not pl:
            return False
        if lg in BASKET:
            return all(len(r) >= BOX_LEN for rows in pl.values() for r in rows)
        if lg in FOOTBALL:
            return "ts" in row and (lg != "ncaaf" or "px" in row)
    return True


FB_GROUPS = {"rushing": ("R", ["CAR", "YDS", "TD"]), "receiving": ("C", ["REC", "YDS", "TD"]),
             "defensive": ("D", ["TOT", "SACKS", "TFL", "PD"]), "interceptions": ("I", ["INT"])}


def _football_more(summ):
    """Rushing, receiving and defensive rows per side (for returning production), and the team totals."""
    px, ts = {}, {}
    for t in (summ.get("boxscore") or {}).get("players", []):
        tid = str((t.get("team") or {}).get("id"))
        rows = []
        for g in t.get("statistics", []):
            spec = FB_GROUPS.get(g.get("name"))
            if not spec:
                continue
            labels = g.get("labels") or []
            for a in g.get("athletes", []):
                at, st = a.get("athlete") or {}, a.get("stats") or []
                if st:
                    rows.append([spec[0], at.get("id"), at.get("displayName")] + [_num(_stat(labels, st, k)) for k in spec[1]])
        px[tid] = rows
    for t in (summ.get("boxscore") or {}).get("teams", []):
        tid = str((t.get("team") or {}).get("id"))
        ts[tid] = {x.get("name"): x.get("displayValue") for x in t.get("statistics", []) if x.get("name")}
    return px, ts


def _players(lg, summ):
    """Compact player rows per side, keyed by the side's ESPN team id."""
    out = {}
    for t in (summ.get("boxscore") or {}).get("players", []):
        tid = str((t.get("team") or {}).get("id"))
        rows = []
        for g in t.get("statistics", []):
            labels = g.get("labels") or g.get("keys") or []
            name = g.get("name")
            for a in g.get("athletes", []):
                at, st = a.get("athlete") or {}, a.get("stats") or []
                if lg == "nhl":
                    if name == "goalies":
                        rows.append(["G", at.get("id"), at.get("displayName"), _num(_stat(labels, st, "GA")), _num(_stat(labels, st, "SA")), _mins(_stat(labels, st, "TOI"))])
                    elif name in ("forwards", "defenses"):
                        rows.append(["F" if name == "forwards" else "D", at.get("id"), at.get("displayName"), _mins(_stat(labels, st, "TOI")), _num(_stat(labels, st, "+/-"))])
                elif lg in FOOTBALL:
                    if name == "passing":
                        rows.append([at.get("id"), at.get("displayName"), _num((_stat(labels, st, "C/ATT") or "0/0").split("/")[-1]), _num(_stat(labels, st, "YDS")),
                                     _num(_stat(labels, st, "TD")), _num(_stat(labels, st, "INT")), _num(_stat(labels, st, "QBR")), _num(_stat(labels, st, "SACKS"))])
                elif lg in BASKET:
                    if st:
                        fg, ft = _pair(_stat(labels, st, "FG")), _pair(_stat(labels, st, "FT"))
                        rows.append([at.get("id"), at.get("displayName"), _mins(_stat(labels, st, "MIN")), _num(_stat(labels, st, "PTS")), _num(_stat(labels, st, "+/-")), 1 if a.get("starter") else 0,
                                     fg[0], fg[1], ft[0], ft[1]] + [_num(_stat(labels, st, k)) for k in ("OREB", "DREB", "AST", "STL", "BLK", "TO", "PF")])
        out[tid] = rows
    return out


def row_from(lg, ev, summ):
    c = ev["competitions"][0]
    comp = {x["homeAway"]: x for x in c["competitors"]}
    row = {"d": ev["date"][:16], "h": comp["home"]["team"]["id"], "a": comp["away"]["team"]["id"],
           "hs": _num(comp["home"].get("score")), "as": _num(comp["away"].get("score")), "n": int(bool(c.get("neutralSite")))}
    ln = _line(summ)
    if ln:
        row.update(ln)
    if lg in ("nhl",) or lg in BASKET or lg in FOOTBALL:
        row["pl"] = _players(lg, summ)
    if lg in FOOTBALL:
        px, ts = _football_more(summ)
        row["ts"] = ts
        if lg == "ncaaf":
            row["px"] = px
    return row


# ---------------------------------------------------------------- collect
def _crawl_ids(lg, year):
    """All regular-season events in a season window from the scoreboard."""
    (m0, d0), (m1, d1) = WINDOW[lg]
    if lg in FOOTBALL:
        start, end = date(year, m0, d0), min(date(year + 1, m1, d1), date.today())
    else:
        start, end = date(year - 1, m0, d0), min(date(year, m1, d1), date.today())
    step, cur, events = STEP[lg], start, {}
    base = {"limit": "300"} if lg == "ncaab" else {}
    if LEAGUES[lg].get("groups"):
        base["groups"] = LEAGUES[lg]["groups"]
    while cur <= end:
        last = min(cur + timedelta(days=step - 1), end)
        a, b = cur.strftime("%Y%m%d"), last.strftime("%Y%m%d")
        evs = []
        if step > 1:
            try:
                evs = get(ESPN + path(lg) + "/scoreboard", dict(base, dates=f"{a}-{b}")).get("events", [])
            except Exception:
                evs = []
        if step == 1 or not evs or len(evs) >= 300:           # a range ESPN would not answer, or too many for one request
            evs, c = [], cur
            while c <= last:
                try:
                    evs += get(ESPN + path(lg) + "/scoreboard", dict(base, dates=c.strftime("%Y%m%d"))).get("events", [])
                except Exception as e:
                    print(f"::notice title=lab crawl error {lg}::{c}: {str(e)[:160]}", flush=True)
                c += timedelta(days=1)
        if len(events) == 0 and cur < start + timedelta(days=step * 3):
            print(f"::notice title=lab crawl {lg}::{a}-{b}: {len(evs)} events; first: {json.dumps((evs[0].get('status') or {}).get('type') if evs else None)[:160]} season={json.dumps(evs[0].get('season') if evs else None)[:100]}", flush=True)
        for e in evs:
            st = (e.get("status") or {}).get("type") or {}
            if st.get("completed") and (e.get("season") or {}).get("type", 2) == 2:
                events[e["id"]] = e
        cur = last + timedelta(days=1)
    return events


def collect(lg, year, budget_s=None):
    rel = f"lab/{lg}_{year}.json"
    store = read(rel) or {"year": year, "v": 1, "g": {}}
    t0 = time.time()
    events = _crawl_ids(lg, year)
    todo = [eid for eid in events if eid not in store["g"] or not _complete(lg, store["g"][eid])]
    print(f"{lg} {year}: {len(events)} completed games, {len(todo)} to fetch", flush=True)
    done = fail = 0
    for i, eid in enumerate(todo):
        if budget_s and time.time() - t0 > budget_s:
            break
        try:
            summ = get(ESPN + path(lg) + "/summary", {"event": eid})
            store["g"][eid] = row_from(lg, events[eid], summ)
            done += 1
        except Exception as e:
            fail += 1
            if fail < 5:
                print(f"  {eid}: {str(e)[:100]}")
        if done and done % 400 == 0:
            write(rel, store)
    store["updated"] = now_iso()
    write(rel, store)
    withline = sum(1 for r in store["g"].values() if r.get("sp") is not None)
    return {"games": len(store["g"]), "fetched": done, "failed": fail, "withLine": withline, "seconds": round(time.time() - t0)}


def job_collect():
    only = [x for x in os.environ.get("LAB_LG", "").split(",") if x] or list(SEASONS)
    out = {}
    for lg in only:
        for year in SEASONS.get(lg, []):
            try:
                out[f"{lg}_{year}"] = collect(lg, year, budget_s=int(os.environ.get("LAB_BUDGET", "7200")))
            except Exception as e:
                import traceback; traceback.print_exc()
                out[f"{lg}_{year}"] = f"error: {e}"[:160]
    return out


# ---------------------------------------------------------------- CollegeFootballData probe
def job_cfbd():
    key = os.environ.get("CFBD_KEY", "")
    if not key:
        return {"error": "no CFBD_KEY"}
    H = {"Authorization": f"Bearer {key}"}
    base = "https://api.collegefootballdata.com"
    out = {}
    for name, url, params in (("lines", "/lines", {"year": 2025, "seasonType": "regular", "week": 8}),
                              ("players", "/games/players", {"year": 2025, "week": 8, "seasonType": "regular", "category": "passing"}),
                              ("games", "/games", {"year": 2025, "week": 8, "seasonType": "regular"})):
        try:
            d = get(base + url, params, headers=H)
            write(f"lab/_probe/cfbd_{name}.json", _trim(d if isinstance(d, list) else d))
            out[name] = len(d) if isinstance(d, list) else "object"
        except Exception as e:
            out[name] = f"error: {str(e)[:120]}"
    return out


# ---------------------------------------------------------------- probe: what is knowable before a game
def job_probe2():
    """Upcoming games: ESPN summary (injuries, probables) and the NHL's own schedule/landing endpoints (starting goalies)."""
    out = {}
    for lg in ("nhl", "nba", "ncaaf", "nfl", "ncaab"):
        try:
            cache = read(f"model/_games_{lg}.json") or {}
            up = sorted((g for g in cache.get("events", {}).values() if not g.get("done") and not g.get("off")), key=lambda g: g["d"])
            if not up:
                out[lg] = "no upcoming games in cache"
                continue
            eid = next(k for k, g in cache["events"].items() if g is up[0])
            summ = get(ESPN + path(lg) + "/summary", {"event": eid})
            write(f"lab/_probe/upcoming_{lg}_summary.json", _trim(summ))
            out[lg] = {"event": eid, "keys": sorted(summ.keys())[:40], "injuries": len(summ.get("injuries") or [])}
        except Exception as ex:
            out[lg] = f"error: {str(ex)[:150]}"
    try:
        sch = get("https://api-web.nhle.com/v1/schedule/now")
        write("lab/_probe/nhl_api_schedule.json", _trim(sch))
        gid = None
        for day in sch.get("gameWeek", []):
            for g in day.get("games", []):
                gid = g["id"]
                break
            if gid:
                break
        if gid:
            land = get(f"https://api-web.nhle.com/v1/gamecenter/{gid}/landing")
            write("lab/_probe/nhl_api_landing.json", _trim(land))
            out["nhl_api"] = {"game": gid, "keys": sorted(land.keys())}
    except Exception as ex:
        out["nhl_api"] = f"error: {str(ex)[:150]}"
    return out


# ---------------------------------------------------------------- NFL Big Data Bowl (Kaggle), probe only
def job_bdb():
    """List the Big Data Bowl competitions this Kaggle account can reach and the files in the newest ones (names,
    sizes, CSV headers of the small files). Needs a KAGGLE_API_TOKEN secret (or legacy KAGGLE_USERNAME and KAGGLE_KEY), and the competition rules
    accepted on kaggle.com by that account. Raw data is never committed; only this summary."""
    import subprocess, zipfile, glob, csv as _csv
    if not os.environ.get("KAGGLE_API_TOKEN"):           # a new-style token saved under another name
        alt = os.environ.get("KAGGLE_API_KEY") or os.environ.get("KAGGLE_TOKEN") or (os.environ.get("KAGGLE_KEY") if not os.environ.get("KAGGLE_USERNAME") else "")
        if alt:
            os.environ["KAGGLE_API_TOKEN"] = alt.strip()
            os.environ.pop("KAGGLE_KEY", None)
    if not (os.environ.get("KAGGLE_API_TOKEN") or (os.environ.get("KAGGLE_USERNAME") and os.environ.get("KAGGLE_KEY"))):
        return {"error": "no Kaggle secret visible", "seen": {k: bool(os.environ.get(k)) for k in ("KAGGLE_API_TOKEN", "KAGGLE_API_KEY", "KAGGLE_TOKEN", "KAGGLE_USERNAME", "KAGGLE_KEY")}}
    for k in ("KAGGLE_API_TOKEN", "KAGGLE_USERNAME", "KAGGLE_KEY"):       # unset secrets arrive as empty strings
        if not os.environ.get(k):
            os.environ.pop(k, None)
    run = lambda *a: subprocess.run(["kaggle", *a], capture_output=True, text=True, timeout=600)
    lst = run("competitions", "list", "-s", "big data bowl", "--csv")
    comps = [r["ref"].rstrip("/").split("/")[-1] for r in _csv.DictReader(io.StringIO(lst.stdout))] if lst.returncode == 0 else []
    out = {"list_error": (lst.stderr or lst.stdout)[-300:] if lst.returncode else None, "competitions": comps, "files": {},
           "tokenShape": ("new" if os.environ.get("KAGGLE_API_TOKEN", "").startswith("KGAT") else "other") if os.environ.get("KAGGLE_API_TOKEN") else "legacy pair"}
    pref = ["nfl-big-data-bowl-2027", "nfl-big-data-bowl-2026-analytics", "nfl-big-data-bowl-2026-prediction", "nfl-big-data-bowl-2025",
            "nfl-big-data-bowl-2024", "nfl-big-data-bowl-2023"]
    comps = sorted(comps, key=lambda c: pref.index(c) if c in pref else 99)
    out["access"] = {}
    for c in comps:                                   # one small file each: are the rules accepted?
        t = run("competitions", "download", "-c", c, "-f", "games.csv" if c != "nfl-big-data-bowl-2027" else "nfl-big-data-bowl-2027/games.csv", "-p", f"/tmp/bdbt/{c}")
        out["access"][c] = t.returncode == 0
    ok = [c for c in comps if out["access"].get(c)]
    for c in ok[:3]:
        fl = run("competitions", "files", "-c", c, "--csv")
        rows = list(_csv.DictReader(io.StringIO(fl.stdout))) if fl.returncode == 0 else []
        info = {"error": fl.stderr[-300:] if fl.returncode else None, "files": [{k: r.get(k) for k in ("name", "size", "totalBytes", "creationDate") if r.get(k)} for r in rows[:60]], "headers": {}}
        d = f"/tmp/bdb/{c}"
        os.makedirs(d, exist_ok=True)
        for r in rows:
            name = r.get("name") or ""
            if name.endswith(".csv") and not any(x in name for x in ("tracking", "input", "output")):
                dl = run("competitions", "download", "-c", c, "-f", name, "-p", d)
                for z in glob.glob(d + "/*.zip"):
                    try:
                        zipfile.ZipFile(z).extractall(d)
                    except zipfile.BadZipFile:
                        pass
                f = os.path.join(d, os.path.basename(name))
                if os.path.exists(f):
                    with open(f, newline="", encoding="utf-8", errors="replace") as fh:
                        rd = _csv.reader(fh)
                        info["headers"][name] = [next(rd, []), next(rd, [])]
                elif dl.returncode:
                    info["headers"][name] = "download failed: " + dl.stderr[-200:]
        tr = [r.get("name") for r in rows if any(x in (r.get("name") or "") for x in ("tracking", "input", "output"))]
        if tr:
            dl = run("competitions", "download", "-c", c, "-f", tr[0], "-p", d)
            for z in glob.glob(d + "/*.zip"):
                try:
                    zipfile.ZipFile(z).extractall(d)
                except zipfile.BadZipFile:
                    pass
            f = os.path.join(d, os.path.basename(tr[0]))
            if os.path.exists(f):
                with open(f, newline="", encoding="utf-8", errors="replace") as fh:
                    rd = _csv.reader(fh)
                    info["headers"][tr[0]] = [next(rd, []), next(rd, []), next(rd, [])]
        out["files"][c] = info
    write("lab/_probe/bdb.json", out)
    return {"access": out["access"], "files": {c: len(v["files"]) for c, v in out["files"].items()}, "list_error": out["list_error"], "tokenShape": out["tokenShape"]}


# ---------------------------------------------------------------- Kalshi (public market data, no key) probe
def job_kalshi():
    """Find Kalshi's open NFL player-prop markets (public API, no key) and save a summary: series tickers, sample titles,
    strike values and prices. Nothing is used in forecasts."""
    base = "https://api.elections.kalshi.com/trade-api/v2"
    out = {"series": [], "samples": [], "counts": {}}
    try:
        ser = get(base + "/series", {"category": "Sports"}, timeout=60)
        sl = ser.get("series") or []
        nfl = [x for x in sl if "NFL" in (x.get("ticker") or "") or "NFL" in (x.get("title") or "")]
        out["series"] = [{k: x.get(k) for k in ("ticker", "title", "frequency")} for x in nfl][:200]
    except Exception as e:
        out["series_error"] = str(e)[:200]
    keys = ("yards", "receptions", "touchdown", "Receiving", "Rushing", "Passing")
    cursor, seen = None, 0
    for _ in range(3):
        try:
            d = get(base + "/markets", dict({"status": "open", "limit": "1000"}, **({"cursor": cursor} if cursor else {})), timeout=60)
        except Exception as e:
            out["markets_error"] = str(e)[:200]
            break
        ms = d.get("markets") or []
        seen += len(ms)
        for m in ms:
            t = (m.get("title") or "") + " " + (m.get("subtitle") or "") + " " + (m.get("yes_sub_title") or "")
            if any(k.lower() in t.lower() for k in keys) and ("NFL" in (m.get("event_ticker") or "") or "NFL" in (m.get("series_ticker") or "") or "NFL" in (m.get("ticker") or "")):
                st = (m.get("ticker") or "").split("-")[0]
                out["counts"][st] = out["counts"].get(st, 0) + 1
                if len(out["samples"]) < 60:
                    out["samples"].append({k: m.get(k) for k in ("ticker", "event_ticker", "title", "subtitle", "yes_sub_title", "floor_strike", "cap_strike",
                                                                  "strike_type", "yes_bid", "yes_ask", "last_price", "volume", "open_interest", "close_time")})
        cursor = d.get("cursor")
        if not cursor:
            break
    out["marketsScanned"] = seen
    out["bySeries"] = {}
    for st in ("KXNFLRECYDS", "KXNFLRSHYDS", "KXNFLPASSYDS", "KXNFLREC", "KXNFLRECEPTIONS", "KXNFLRUSHYDS"):
        for status in ("open", "settled"):
            try:
                d = get(base + "/markets", {"series_ticker": st, "status": status, "limit": "200"}, timeout=60)
            except Exception as e:
                out["bySeries"][f"{st}:{status}"] = f"error {str(e)[:120]}"
                continue
            ms = d.get("markets") or []
            if ms and status == "open":
                out.setdefault("full", {})[st] = ms[0]
            out["bySeries"][f"{st}:{status}"] = {"n": len(ms), "sample": [{k: m.get(k) for k in ("ticker", "event_ticker", "title", "subtitle", "yes_sub_title",
                "floor_strike", "cap_strike", "strike_type", "yes_bid", "yes_ask", "last_price", "volume", "open_interest", "close_time", "result")} for m in ms[:8]]}
    write("lab/_probe/kalshi.json", out)
    return {"scanned": seen, "propSeries": out["counts"], "nflSeries": len(out["series"])}


# ---------------------------------------------------------------- ESPN core odds probe (free, no key)
GAPS = {"nba": [2024, 2025, 2023], "ncaab": [2024, 2025, 2023], "ncaaf": [2023, 2024, 2025, 2022], "nhl": [2025, 2024]}


def job_oddscore():
    """For seasons whose ESPN summaries carried no pickcenter line, ask ESPN's core odds endpoint for the same games.
    Saves one raw response per league to _probe/ and a summary of how many sampled games came back with a spread/total."""
    out = {}
    for lg, years in GAPS.items():
        for y in years:
            g = (read(f"lab/{lg}_{y}.json") or {}).get("g") or {}
            ids = list(g)[::max(1, len(g) // 12)][:12]
            got, provs, err = 0, {}, None
            for i, eid in enumerate(ids):
                try:
                    sp_, lg_ = path(lg).split("/", 1)
                    d = get(CORE + f"{sp_}/leagues/{lg_}/events/{eid}/competitions/{eid}/odds", {"limit": "50"}, timeout=30)
                except Exception as e:
                    err = str(e)[:120]
                    continue
                items = d.get("items") or []
                if i == 0:
                    write(f"lab/_probe/oddscore_{lg}_{y}.json", _trim(d))
                ok = False
                for it in items:
                    p = (it.get("provider") or {}).get("name")
                    provs[p] = provs.get(p, 0) + 1
                    if it.get("spread") is not None or it.get("overUnder") is not None:
                        ok = True
                got += ok
            out[f"{lg}_{y}"] = {"sampled": len(ids), "withLine": got, "providers": provs, "error": err}
    return out


PREF = ("consensus", "ESPN BET", "DraftKings", "Draft Kings", "Caesars Sportsbook", "MGM", "FanDuel", "Bet365", "Unibet")


def _core_line(d):
    """(row fields) from a core odds response: the preferred pre-game provider's closing home margin, total and moneylines,
    plus the opening home margin when given."""
    items = [it for it in (d.get("items") or []) if "Live" not in ((it.get("provider") or {}).get("name") or "")
             and (it.get("spread") is not None or it.get("overUnder") is not None)]
    if not items:
        return None
    items.sort(key=lambda it: PREF.index(it["provider"]["name"]) if it["provider"].get("name") in PREF else 99)
    it = items[0]
    home, away = it.get("homeTeamOdds") or {}, it.get("awayTeamOdds") or {}
    try:
        sp = None if it.get("spread") is None else -float(it["spread"])
    except (TypeError, ValueError):
        sp = None
    op = None
    try:
        a = (((home.get("open") or {}).get("pointSpread") or {}).get("american"))
        op = -float(str(a).replace("+", "")) if a not in (None, "", "EVEN", "PK") else None
    except (TypeError, ValueError):
        op = None
    return {"sp": sp, "tot": it.get("overUnder"), "ml": [home.get("moneyLine"), away.get("moneyLine")],
            "prov": it["provider"]["name"], "spO": op}


def job_oddsfill():
    """Fill closing lines into lab seasons whose ESPN summaries had none, from ESPN's core odds endpoint (free, no key)."""
    lgs = [x for x in os.environ.get("LAB_LG", "nba,ncaab,ncaaf,nhl").split(",") if x in SEASONS]
    budget = time.time() + float(os.environ.get("LAB_BUDGET_MIN", "320")) * 60
    out = {}
    for lg in lgs:
        sp_, lg_ = path(lg).split("/", 1)
        for y in SEASONS[lg]:
            name = f"lab/{lg}_{y}.json"
            store = read(name) or {}
            g = store.get("g") or {}
            todo = [k for k, r in g.items() if r.get("sp") is None and r.get("tot") is None and not r.get("cx")]
            filled = tried = 0
            for i, eid in enumerate(todo):
                if time.time() > budget:
                    break
                tried += 1
                try:
                    d = get(CORE + f"{sp_}/leagues/{lg_}/events/{eid}/competitions/{eid}/odds", {"limit": "50"}, timeout=30)
                    ln = _core_line(d)
                except Exception:
                    ln = None
                if ln:
                    g[eid].update(ln)
                    filled += 1
                else:
                    g[eid]["cx"] = 1                       # checked, nothing there: don't ask again
                if i % 400 == 399:
                    write(name, store)
            if tried:
                write(name, store)
            out[f"{lg}_{y}"] = {"missing": len(todo), "tried": tried, "filled": filled}
    return out


# ---------------------------------------------------------------- SportsGameOdds probe (SGO_KEY; Amateur plan: 2,500 objects a month)
def job_sgo():
    """Check the key, save account usage and two upcoming NFL events with their odds (to learn the prop shapes)."""
    key = os.environ.get("SGO_KEY", "").strip()
    if not key:
        return "no SGO_KEY secret"
    H, base, out = {"X-Api-Key": key}, "https://api.sportsgameodds.com/v2", {}
    try:
        u = get(base + "/account/usage", headers=H, timeout=60)
        def _nokey(o):          # this lands in a public repo: drop anything that names a key
            if isinstance(o, dict):
                return {k: _nokey(v) for k, v in o.items() if "key" not in k.lower()}
            return [_nokey(v) for v in o] if isinstance(o, list) else o
        ud = (u.get("data") if isinstance(u, dict) else {}) or {}
        out["usage"] = {"tier": ud.get("tier"), "month": ((ud.get("rateLimits") or {}).get("per-month") or {})}      # no account details: this file is public
    except Exception as e:
        out["usage_error"] = str(e)[:200]
    try:
        d = get(base + "/events", {"leagueID": "NFL", "oddsAvailable": "true", "limit": "2"}, headers=H, timeout=60)
        evs = d.get("data") or []
        write("lab/_probe/sgo_events.json", _trim(d))
        props = {}
        for ev in evs:
            for oid in (ev.get("odds") or {}):
                parts = oid.split("-")
                if len(parts) >= 5 and parts[1] not in ("home", "away", "all"):
                    props[parts[0]] = props.get(parts[0], 0) + 1
        out["events"] = [{"id": e.get("eventID"), "teams": [((e.get("teams") or {}).get(s) or {}).get("names", {}).get("short") for s in ("away", "home")],
                          "odds": len(e.get("odds") or {})} for e in evs]
        out["propStats"] = props
    except Exception as e:
        out["events_error"] = str(e)[:200]
    return out


def job_bdb27():
    """Big Data Bowl 2027: download every file and record its shape (columns, two rows, row count, seasons/weeks
    covered). Nothing raw is committed: only data/sports/lab/_probe/bdb27.json."""
    import subprocess, zipfile, glob, csv as _csv
    tok = os.environ.get("KAGGLE_API_TOKEN") or os.environ.get("KAGGLE_API_KEY") or os.environ.get("KAGGLE_TOKEN")
    if not tok:
        return "no Kaggle token"
    os.environ["KAGGLE_API_TOKEN"] = tok.strip()
    for k in ("KAGGLE_USERNAME", "KAGGLE_KEY"):
        if not os.environ.get(k):
            os.environ.pop(k, None)
    c, d = "nfl-big-data-bowl-2027", "/tmp/bdb27"
    os.makedirs(d, exist_ok=True)
    r = subprocess.run(["kaggle", "competitions", "download", "-c", c, "-p", d], capture_output=True, text=True, timeout=3000)
    out = {"download": r.returncode, "err": (r.stderr or "")[-300:], "files": {}}
    for z in glob.glob(d + "/*.zip"):
        try:
            zipfile.ZipFile(z).extractall(d)
            os.remove(z)
        except zipfile.BadZipFile:
            out["err"] += " bad zip " + z
    for f in sorted(glob.glob(d + "/**/*.csv", recursive=True)):
        info = {"bytes": os.path.getsize(f)}
        with open(f, newline="", encoding="utf-8", errors="replace") as fh:
            rd = _csv.reader(fh)
            head = next(rd, [])
            info["cols"] = head
            info["rows2"] = [next(rd, []), next(rd, [])]
            n, seen = 2, {}
            idx = {k: head.index(k) for k in ("season", "week", "gameId", "nflId", "game_id", "season_year") if k in head}
            for row in rd:
                n += 1
                if n % 7 == 0:
                    for k, i in idx.items():
                        if k in ("season", "week", "season_year") and i < len(row):
                            seen.setdefault(k, set()).add(row[i])
            info["n"] = n
            info["values"] = {k: sorted(v)[:40] for k, v in seen.items()}
        out["files"][os.path.relpath(f, d)] = info
    write("lab/_probe/bdb27.json", out)
    return {k: {"n": v["n"], "cols": len(v["cols"])} for k, v in out["files"].items()}


def job_bdb27test():
    """Does Big Data Bowl 2027 route data (drafted 2023-25 players only) explain what the props walk misses?
    For each receiver-week in 2024-25 the walk-forward projection's miss is compared with the player's routes, targets
    per route, yards per route and separation earlier in the same season (or last season before week 4). A
    correction fitted on 2024 is scored on 2025. Raw Kaggle data and per-player values are never committed:
    only the summary in lab/_probe/bdb27test.json."""
    import subprocess, zipfile, glob, csv as _csv, collections
    import numpy as np
    from . import nflprops as P
    tok = os.environ.get("KAGGLE_API_TOKEN") or os.environ.get("KAGGLE_API_KEY") or os.environ.get("KAGGLE_TOKEN")
    if not tok:
        return "no Kaggle token"
    os.environ["KAGGLE_API_TOKEN"] = tok.strip()
    for k in ("KAGGLE_USERNAME", "KAGGLE_KEY"):
        if not os.environ.get(k):
            os.environ.pop(k, None)
    d = "/tmp/bdb27"
    for f in ("player_play.csv", "players.csv", "games.csv"):
        subprocess.run(["kaggle", "competitions", "download", "-c", "nfl-big-data-bowl-2027", "-f", "nfl-big-data-bowl-2027/" + f, "-p", d],
                       capture_output=True, text=True, timeout=1800)
    for z in glob.glob(d + "/*.zip"):
        zipfile.ZipFile(z).extractall(d)
    find = lambda n: (glob.glob(d + "/**/" + n, recursive=True) or [None])[0]
    games = {r["game_id"]: (int(r["season"]), int(r["week"]), r["season_type"]) for r in _csv.DictReader(open(find("games.csv")))}
    names = {r["nfl_id"]: (P._norm(r["display_name"]), r["nfl_position"]) for r in _csv.DictReader(open(find("players.csv")))}
    f = lambda v: None if v in ("", "NA", None) else float(v)
    agg = collections.defaultdict(lambda: [0, 0, 0.0, 0.0, 0])        # (season, week, nfl_id): routes, targets, rec yds, sep sum, sep n
    for r in _csv.DictReader(open(find("player_play.csv"), newline="")):
        g = games.get(r["game_id"])
        if not g or g[2] != "REG" or r["nfl_id"] not in names or r["team_abbr"] != r["possession_team"]:
            continue
        if r["route_ran"] in ("", "NA") or r["play_nullified_by_penalty"] == "Y":
            continue
        a = agg[(g[0], g[1], r["nfl_id"])]
        a[0] += 1
        if r["target"] == "TRUE":
            a[1] += 1
            a[2] += f(r["rec_yards"]) or 0.0
        s = f(r["separation_at_pass_forward"])
        if s is not None and r["target"] == "TRUE":
            a[3] += s; a[4] += 1
    # season-to-date features before each week
    feat = {}
    by = collections.defaultdict(list)
    for (y, w, pid), a in agg.items():
        by[(y, pid)].append((w, a))
    for (y, pid), lst in by.items():
        lst.sort()
        cum = [0, 0, 0.0, 0.0, 0]
        prev = [sum(x[1][i] for x in by.get((y - 1, pid), [])) for i in range(5)]
        for w, a in lst:
            src = cum if cum[0] >= 60 else [cum[i] + prev[i] for i in range(5)]
            if src[0] >= 60:
                feat[(y, w, names[pid][0])] = (src[1] / src[0], src[2] / src[0], src[3] / src[4] if src[4] >= 10 else None, src[0])
            cum = [cum[i] + a[i] for i in range(5)]
    seasons = {yy: P._season_rows(yy) for yy in range(2019, 2026)}
    keys = {}
    P._walk(seasons, 2024, keys)
    rows = []
    for (y, w, nm, team, mk), (pr, act) in keys.items():
        if mk != "rec_yds" or y not in (2024, 2025):
            continue
        fe = feat.get((y, w, nm))
        if fe and pr > 0:
            rows.append((y, pr, act, fe[0], fe[1], fe[2]))
    out = {"receiverWeeks": len(rows), "players": len({k[2] for k in feat})}
    if len(rows) < 300:
        write("lab/_probe/bdb27test.json", out)
        return out
    R = np.array([[r[0], r[1], r[2], r[3], r[4]] for r in rows])
    yy, pr, act, tprr, yprr = R.T
    lr = np.log((act + 5) / (pr + 5))
    out["corr"] = {"tprr": round(float(np.corrcoef(tprr, lr)[0, 1]), 3), "yprr": round(float(np.corrcoef(yprr, lr)[0, 1]), 3)}
    sep = np.array([r[5] if r[5] is not None else np.nan for r in rows])
    ok = ~np.isnan(sep)
    out["corr"]["sep"] = round(float(np.corrcoef(sep[ok], lr[ok])[0, 1]), 3) if ok.sum() > 100 else None
    tr, te = yy == 2024, yy == 2025
    X = np.column_stack([np.ones_like(pr), tprr - tprr[tr].mean(), yprr - yprr[tr].mean()])
    beta = np.linalg.lstsq(X[tr], lr[tr], rcond=None)[0]
    adj = pr[te] * np.exp(X[te] @ beta)
    base_mae, new_mae = float(np.abs(act[te] - pr[te]).mean()), float(np.abs(act[te] - adj).mean())
    b0 = float(lr[tr].mean())                                        # level shift only: is it the routes or the intercept?
    lvl = float(np.abs(act[te] - pr[te] * np.exp(b0)).mean())
    med = lambda v: float(np.median(np.abs(v)))
    out.update({"train": int(tr.sum()), "test": int(te.sum()), "beta": [round(float(b), 4) for b in beta],
                "test2025": {"maeWalk": round(base_mae, 2), "maeLevelOnly": round(lvl, 2), "maeWithRoutes": round(new_mae, 2),
                             "medianMissWalk": round(med(act[te] - pr[te]), 2), "medianMissRoutes": round(med(act[te] - adj), 2)}})
    write("lab/_probe/bdb27test.json", out)
    return out


# ---------------------------------------------------------------- Oct 27 data batch
def job_nflopen():
    """NFL opening and closing spreads from ESPN's core odds endpoint (free): history/nfl_open_{year}.json
    {event id: [start, home id, away id, opening home margin, closing home margin, provider]}."""
    out = {}
    cur = (read("model/nfl.json") or {}).get("season") or 2026
    for y in range(2016, cur + 1):
        name = f"history/nfl_open_{y}.json"
        store = read(name) or {"year": y, "g": {}}
        if y < cur and len(store["g"]) > 250:
            out[y] = "kept"
            continue
        ids = []
        for wk in range(1, 19):
            try:
                d = get(CORE + f"football/leagues/nfl/seasons/{y}/types/2/weeks/{wk}/events", {"limit": "40"}, timeout=30)
            except Exception:
                continue
            ids += [it["$ref"].split("/events/")[1].split("?")[0] for it in d.get("items") or []]
        got = 0
        for eid in ids:
            if eid in store["g"]:
                continue
            try:
                d = get(CORE + f"football/leagues/nfl/events/{eid}/competitions/{eid}/odds", {"limit": "50"}, timeout=30)
                ev = get(CORE + f"football/leagues/nfl/events/{eid}", {}, timeout=30)
            except Exception:
                continue
            comp = (ev.get("competitions") or [{}])[0]
            side = {}
            for c in comp.get("competitors") or []:
                side[c.get("homeAway")] = str(c.get("id"))
            items = [it for it in d.get("items") or [] if "Live" not in ((it.get("provider") or {}).get("name") or "")]
            items.sort(key=lambda it: PREF.index(it["provider"]["name"]) if (it.get("provider") or {}).get("name") in PREF else 99)
            row = None
            for it in items:
                home = it.get("homeTeamOdds") or {}
                pick = lambda k: ((home.get(k) or {}).get("pointSpread") or {}).get("american")
                o, c = pick("open"), pick("close")
                def f(v):
                    if v in (None, ""):
                        return None
                    if str(v).upper() in ("PK", "EVEN"):
                        return 0.0
                    return -float(str(v).replace("+", ""))
                try:
                    o2, c2 = f(o), f(c)
                except ValueError:
                    continue
                if c2 is None and it.get("spread") is not None:
                    c2 = -float(it["spread"])
                if o2 is not None and c2 is not None:
                    row = [(ev.get("date") or "")[:16], side.get("home"), side.get("away"), o2, c2, it["provider"]["name"]]
                    break
            if row:
                store["g"][eid] = row
                got += 1
        write(name, store)
        out[y] = {"events": len(ids), "added": got, "stored": len(store["g"])}
    return out


def job_nhlgoalies():
    """Every regular-season NHL game's goalies from the NHL's own API (free): who started, minutes, shots and saves.
    history/nhl_goalies_{year}.json {nhl game id: [date, home abbr, away abbr, home goalies, away goalies]},
    goalie = [player id, name, started, seconds, shots against, saves]. year = the season's end year (ESPN style)."""
    out = {}
    cur = (read("model/nhl.json") or {}).get("season") or 2026
    budget = time.time() + 300 * 60
    for y in range(2019, cur + 1):
        name = f"history/nhl_goalies_{y}.json"
        store = read(name) or {"year": y, "g": {}}
        if y < cur and len(store["g"]) > 1000:
            out[y] = "kept"
            continue
        miss = 0
        for n in range(1, 1400):
            if time.time() > budget:
                break
            gid = f"{y - 1}02{n:04d}"
            if gid in store["g"]:
                continue
            try:
                b = get(f"https://api-web.nhle.com/v1/gamecenter/{gid}/boxscore", timeout=30)
            except Exception:
                miss += 1
                if miss > 25:
                    break
                continue
            if b.get("gameState") not in ("OFF", "FINAL"):
                continue
            miss = 0
            pg = b.get("playerByGameStats") or {}

            def goalies(side):
                rows = []
                for gk in ((pg.get(side) or {}).get("goalies") or []):
                    toi = str(gk.get("toi") or "0:00").split(":")
                    sec = int(toi[0]) * 60 + int(toi[1]) if len(toi) == 2 and toi[0].isdigit() else 0
                    sa = gk.get("shotsAgainst")
                    sv = gk.get("saves")
                    if sa is None and gk.get("saveShotsAgainst"):
                        try:
                            sv, sa = (int(x) for x in str(gk["saveShotsAgainst"]).split("/"))
                        except ValueError:
                            pass
                    rows.append([gk.get("playerId"), (gk.get("name") or {}).get("default"), bool(gk.get("starter")), sec, sa, sv])
                return rows
            store["g"][gid] = [b.get("gameDate"), (b.get("homeTeam") or {}).get("abbrev"), (b.get("awayTeam") or {}).get("abbrev"),
                               goalies("homeTeam"), goalies("awayTeam")]
            if len(store["g"]) % 300 == 0:
                write(name, store)
        write(name, store)
        out[y] = len(store["g"])
    return out


def job_torvik():
    """Can the runners reach barttorvik.com (free college basketball ratings)? Saves status and the first bytes only."""
    out = {}
    for name, url in (("season_csv", "https://barttorvik.com/2025_team_results.csv"),
                      ("timemachine", "https://barttorvik.com/timemachine/team_results/20250115_team_results.json.gz"),
                      ("trank_json", "https://barttorvik.com/trank.php?year=2025&json=1")):
        try:
            import requests
            r = requests.get(url, timeout=60, headers={"User-Agent": "Mozilla/5.0 (research; nathanskown.dev)"})
            body = r.content
            if url.endswith(".gz"):
                import gzip
                try:
                    body = gzip.decompress(body)
                except OSError:
                    pass
            out[name] = {"status": r.status_code, "bytes": len(r.content), "type": r.headers.get("content-type"), "head": body[:600].decode("utf-8", "replace")}
        except Exception as e:
            out[name] = {"error": str(e)[:200]}
    write("lab/_probe/torvik.json", out)
    return {k: (v.get("status"), v.get("bytes")) if "status" in v else v for k, v in out.items()}


def job_cfbdportal():
    """College football transfer portal entries per season from CollegeFootballData (CFBD_KEY), by ESPN team id:
    history/cfbd_portal.json {year: [[origin id, destination id or None, position, stars, rating], ...]}."""
    key = os.environ.get("CFBD_KEY", "").strip()
    if not key:
        return {"error": "no CFBD_KEY"}
    H = {"Authorization": f"Bearer {key}"}
    ids = {t.get("school"): str(t.get("id")) for t in get("https://api.collegefootballdata.com/teams", {}, headers=H, timeout=90) or []}
    store = read("history/cfbd_portal.json") or {}
    cur = (read("model/ncaaf.json") or {}).get("season") or 2026
    out = {}
    for y in range(2021, cur + 1):
        if str(y) in store and y < cur:
            continue
        try:
            rows = get("https://api.collegefootballdata.com/player/portal", {"year": y}, headers=H, timeout=90) or []
        except Exception as e:
            out[y] = f"error {str(e)[:100]}"
            continue
        store[str(y)] = [[ids.get(r.get("origin")), ids.get(r.get("destination")), r.get("position"), r.get("stars"), r.get("rating")] for r in rows]
        out[y] = len(rows)
    store["updated"] = now_iso()
    write("history/cfbd_portal.json", store)
    return out
