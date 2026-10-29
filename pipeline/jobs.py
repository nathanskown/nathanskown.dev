"""The three jobs. Each writes JSON files under data/finance/ that the pages read.

market    (hourly in market hours): dashboard tiles, intraday charts, movers, sectors, yields, watchlist, headlines
daily     (each morning): index members, per-ticker quote pages, earnings season, IPOs, macro
quarterly (monthly check): 13F institutional ownership from the SEC's quarterly data sets
"""
import statistics
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

from . import src_market as mk
from . import src_misc as mi
from . import src_sec as sec
from .net import CONFIG, attempt, get, now_iso, num, r, read, record, write

UNIVERSE = CONFIG["universe"]
TILES = [("spx", "^GSPC", "S&P 500", "", 2), ("ixic", "^IXIC", "Nasdaq Comp.", "", 2), ("dji", "^DJI", "Dow Jones", "", 2),
         ("rut", "^RUT", "Russell 2000", "", 2), ("vix", "^VIX", "VIX", "", 2), ("tnx", "^TNX", "US 10Y yield", "%", 2),
         ("dxy", "DX-Y.NYB", "US Dollar Idx", "", 2), ("wti", "CL=F", "WTI crude", "$", 2), ("gold", "GC=F", "Gold", "$", 2),
         ("btc", "BTC-USD", "Bitcoin", "$", 0),
         # global markets: off by default on the dashboard, visitors can add them from Customize
         ("ftse", "^FTSE", "FTSE 100", "", 2), ("dax", "^GDAXI", "DAX", "", 2), ("sx5e", "^STOXX50E", "Euro Stoxx 50", "", 2),
         ("n225", "^N225", "Nikkei 225", "", 2), ("hsi", "^HSI", "Hang Seng", "", 2), ("tsx", "^GSPTSE", "S&P/TSX", "", 2),
         ("eurusd", "EURUSD=X", "EUR/USD", "", 4), ("usdjpy", "JPY=X", "USD/JPY", "", 2), ("gbpusd", "GBPUSD=X", "GBP/USD", "", 4)]
SECTORS = [("XLK", "Technology"), ("XLE", "Energy"), ("XLC", "Communication"), ("XLF", "Financials"),
           ("XLY", "Cons. Discretionary"), ("XLI", "Industrials"), ("XLB", "Materials"), ("XLV", "Health Care"),
           ("XLRE", "Real Estate"), ("XLP", "Cons. Staples"), ("XLU", "Utilities")]


def today():
    return datetime.now(timezone.utc).date()


def ds(d):
    return d.isoformat()


# =====================================================================================
# MARKET
# =====================================================================================

def _tile(tid, sym, name, unit, dec):
    ch = mk.chart(sym, "1d", "5m")
    q = mk.quote_from_chart(ch)
    step = max(1, len(ch["c"]) // 80)
    return {"id": tid, "sym": sym, "name": name, "unit": unit, "dec": dec, **q,
            "t": ch["t"][::step], "c": [r(x, 4) for x in ch["c"][::step]]}


def members():
    m = read("members.json")
    if not m:
        m = attempt("members (wikipedia)", build_members, default=None) or {"sp500": [], "sectors": {}, "names": {}}
    return m


def build_members():
    out = {"sectors": {}, "names": {}}
    for key, page in [("sp500", "List_of_S%26P_500_companies"), ("sp400", "List_of_S%26P_400_companies"),
                      ("sp600", "List_of_S%26P_600_companies")]:
        rows = attempt(f"index members {key}", mk.index_members, page, default=[]) or []
        out[key] = [x["sym"] for x in rows]
        for x in rows:
            out["sectors"].setdefault(x["sym"], x["sector"])
            out["names"].setdefault(x["sym"], x["name"])
    if not out["sp500"]:
        raise RuntimeError("S&P 500 list empty")
    old = read("members.json", {}) or {}
    asof, fresh = dict(old.get("russellAsOf") or {}), {}
    for key in ("r1000", "r2000"):  # Russell lists from iShares; keep yesterday's list if today's download fails
        got = attempt(f"index members {key} (iShares)", mk.russell_members, key, default=None)
        out[key] = got or old.get(key, [])
        fresh[key] = bool(got)
        if got:
            asof[key] = mk.RUSSELL_ASOF.get(key) or today().isoformat()
    # the pages and /status read these: a stale or empty list is shown as such, never silently dropped
    out["russellAsOf"] = asof
    out["russellFresh"] = fresh
    log_index_changes(old, out)
    write("members.json", out)
    return out


def log_index_changes(old, new):
    """Keep a running log of index adds and drops (data/finance/index_changes.json), found by comparing
    today's member lists with yesterday's. Lists that came back empty or shrank by more than a tenth are
    treated as a failed download, not as mass deletions."""
    from datetime import date as _d
    names = {**(old.get("names") or {}), **(new.get("names") or {})}
    log = read("index_changes.json", {"changes": []}) or {"changes": []}
    today = _d.today().isoformat()
    label = {"sp500": "S&P 500", "sp400": "S&P MidCap 400", "sp600": "S&P SmallCap 600", "r1000": "Russell 1000", "r2000": "Russell 2000"}
    added = []
    for key, nm in label.items():
        a, b = set(old.get(key) or []), set(new.get(key) or [])
        if not a or not b or len(b) < 0.9 * len(a):
            continue
        for s in sorted(b - a):
            added.append({"date": today, "index": nm, "sym": s, "name": names.get(s, s), "change": "added"})
        for s in sorted(a - b):
            added.append({"date": today, "index": nm, "sym": s, "name": names.get(s, s), "change": "removed"})
    if added:
        log["changes"] = (added + log.get("changes", []))[:400]
        log["updated"] = now_iso()
        write("index_changes.json", log)


# "Notable": a whole-word match on market-moving terms, never on spam (class-action ads, market-size reports),
# and a press release only counts when it names a listed company. Same rule as worker/live.js and the pages.
NOTABLE_RE = __import__("re").compile(r"\b(acquires?|acquired|acquisition|merger|to buy|buyout|takeover|bankrupt(cy)?|chapter 11|guidance|outlook|forecast|recalls?|subpoena|sec charges|fda (approv|clear)\w*|fomc|rate (cut|hike|decision)s?|tariffs?|downgrades?d?|upgrades?d?|layoffs?|job cuts|ceo|cfo|resigns?|steps down|buyback|repurchase|stock split|ipo|trading halt|halts trading|outage|data breach|activist|13d|beats|misses|earnings)\b", __import__("re").I)
SPAM_RE = __import__("re").compile(r"lost money|who lost|class action|securities fraud|law firm|attorney|investigation on behalf|investors who|reminds investors|shareholder alert|deadline|recover losses|market to reach|market size|cagr|webinar", __import__("re").I)


def is_notable(title, kind, tickers):
    if SPAM_RE.search(title or ""):
        return False
    if kind == "Press release" and not tickers:
        return False
    return bool(NOTABLE_RE.search(title or ""))


# Digest relevance: a publication story must be about markets, companies or the economy; a press release must not be routine corporate boilerplate
MARKET_RE = __import__("re").compile(r"\b(stocks?|shares|market|markets|wall street|dow|nasdaq|s&p|russell|fed|fomc|rates?|yields?|treasur\w+|inflation|cpi|jobs?|payrolls?|economy|economic|earnings|profit|revenue|guidance|oil|crude|gold|bitcoin|dollar|tariffs?|trade|bank|banks|ipo|merger|acquisition|deal|bonds?|credit|recession|investors?|traders?|etf|sector|ceo|layoffs?|futures|equit\w+|indexes|index)\b", __import__("re").I)
BOILER_RE = __import__("re").compile(r"announces? (the )?(date|timing)|conference call|to (present|participate|host|attend)|webinar|appoints?|names? .{0,40} (as|to) |expands?|launch(es)?|partnership|partners? with|celebrates?|recognized|award|retirement|leadership transition|to ring", __import__("re").I)


def digest_relevant(h):
    t = h.get("title", "")
    if h.get("type") == "Publication":
        return bool(h.get("tickers")) or bool(MARKET_RE.search(t))
    return bool(h.get("notable")) and not BOILER_RE.search(t)


ITEM_NOTABLE = ("1.01", "1.03", "2.01", "2.02", "2.05", "2.06", "4.02", "5.02")


def headlines():
    import re
    old = read("headlines.json", {}) or {}
    seen = {h["link"]: h for h in old.get("items", []) if mi.is_english(h.get("title", "")) and not mi.is_junk(h.get("title", ""), h.get("source", ""))}  # drops non-English, lawsuit-ad and non-recap Yahoo items kept from earlier runs
    c2t = attempt("sec ticker map", sec.cik_to_ticker, default={}) or {}
    alias = {}
    for t, info in UNIVERSE.items():
        for a in info.get("aliases", []):
            alias[a.lower()] = t
    fresh = 0
    for kind, feeds in CONFIG["feeds"].items():
        for src, url in feeds.items():
            items = attempt(f"feed: {src}", mi.feed, url, default=[]) or []
            for it in items[:60]:
                if it["link"] in seen:
                    continue
                if not mi.is_english(it["title"]) or mi.is_junk(it["title"], src):
                    continue
                title, summ = it["title"], it.get("summary", "")
                tick = set(re.findall(r"\((?:NYSE|NASDAQ|Nasdaq|NYSE American|Cboe)[^:)]*:\s*([A-Z.]{1,6})\)", title + " " + summ))
                tick |= set(re.findall(r"\$([A-Z]{1,5})\b", title))
                low = title.lower()
                for a, t in alias.items():
                    if re.search(r"\b" + re.escape(a) + r"\b", low):
                        tick.add(t)
                items_hit = False
                if kind == "SEC filing":
                    m = re.search(r"\((\d{6,10})\)", title)
                    if m and int(m.group(1)) in c2t:
                        tick.add(c2t[int(m.group(1))])
                    items_hit = any(("Item " + x) in summ for x in ITEM_NOTABLE) or "13D" in title
                    title = re.sub(r"\s*\(\d{6,10}\)\s*\((Filer|Subject)\)", "", title)
                notable = items_hit or is_notable(title, kind, tick)
                seen[it["link"]] = {"title": title[:240], "link": it["link"], "source": src, "type": kind,
                                    "published": it.get("published") or now_iso(), "firstSeen": now_iso(),
                                    "tickers": sorted(t.replace(".", "-") for t in tick)[:6], "notable": notable}
                fresh += 1
    items = sorted(seen.values(), key=lambda h: h["published"], reverse=True)[:400]
    write("headlines.json", {"updated": now_iso(), "fresh": fresh, "items": items})
    return items


def market():
    tiles = [x for x in (attempt(f"chart {t[1]}", _tile, *t) for t in TILES) if x]
    sectors = []
    for sym, name in SECTORS:
        ch = attempt(f"sector {sym}", mk.chart, sym, "1d", "1d")
        if ch:
            q = mk.quote_from_chart(ch)
            sectors.append({"sym": sym, "name": name, "pct": q["pct"]})
    mem = members()
    sp = mem.get("sp500", [])
    movers, breadth = {"gainers": [], "losers": []}, None
    px = attempt("S&P 500 batch quotes (spark)", mk.spark, sp, default={}) if sp else {}
    if px:
        rows = [{"sym": s, "name": mem["names"].get(s, s), "sector": mem["sectors"].get(s), **v} for s, v in px.items()]
        rows.sort(key=lambda x: x["pct"])
        movers = {"gainers": rows[::-1][:8], "losers": rows[:8]}
        breadth = {"adv": sum(1 for x in rows if x["pct"] > 0), "dec": sum(1 for x in rows if x["pct"] < 0), "n": len(rows)}
    curve = attempt("treasury yield curve", mk.treasury_curve)
    watch = []
    for s in CONFIG["watchlist"]:
        ch = attempt(f"watch {s}", mk.chart, s, "1d", "5m")
        if ch:
            q = mk.quote_from_chart(ch)
            watch.append({"sym": s, "name": q["name"] or s, "price": q["price"], "pct": q["pct"], "inUniverse": s in UNIVERSE})
    heads = attempt("headlines", headlines, default=[]) or [h for h in (read("headlines.json", {}) or {}).get("items", []) if mi.is_english(h.get("title", "")) and not mi.is_junk(h.get("title", ""), h.get("source", ""))]
    asof = max([t.get("time") or 0 for t in tiles] or [0])
    write("dashboard.json", {"updated": now_iso(), "asOf": asof, "tiles": tiles, "sectors": sectors, "movers": movers,
                             "breadth": breadth, "curve": curve, "watch": watch, "headlines": heads[:8]})
    attempt("prediction-market odds", odds)
    attempt("earnings season (same-day results)", earnings, mem, True)
    attempt("market digest", digest)


# =====================================================================================
# DAILY: quotes
# =====================================================================================

def _slice_since(t, c, since_ts):
    i = next((k for k, x in enumerate(t) if x >= since_ts), len(t))
    return t[i:], c[i:]


def quote_page(sym, info, mem, spx_daily, cal):
    cik, title = sec.tickers().get(sym, (None, None))
    d1 = mk.chart(sym, "1d", "5m")
    d5 = mk.chart(sym, "5d", "30m")
    y5 = mk.chart(sym, "5y", "1d", events="div")
    q = mk.quote_from_chart(d1)
    price = q["price"]
    t, c, v = y5["t"], y5["c"], y5["v"]
    now = time.time()
    year_start = datetime(today().year, 1, 1, tzinfo=timezone.utc).timestamp()

    def pack(tt, cc, step=1):
        return {"t": tt[::step], "c": [r(x, 3) for x in cc[::step]]}
    charts = {"1D": pack(d1["t"], d1["c"]), "5D": pack(d5["t"], d5["c"])}
    for key, days in (("1M", 31), ("6M", 183), ("1Y", 366)):
        tt, cc = _slice_since(t, c, now - days * 86400)
        charts[key] = pack(tt, cc)
    tt, cc = _slice_since(t, c, year_start)
    charts["YTD"] = pack(tt, cc)
    charts["5Y"] = pack(t, c, 5)
    # stats
    prior_close = next((c[k - 1] for k in range(len(t)) if t[k] >= year_start and k > 0), None)
    ytd = (price / prior_close - 1) * 100 if price and prior_close else None
    y1 = None
    tt, cc = _slice_since(t, c, now - 365 * 86400)
    if cc and price:
        y1 = (price / cc[0] - 1) * 100
    div_ttm = sum(a for ts, a in y5["div"].items() if int(ts) >= now - 365 * 86400)
    vols = [x for x in v[-63:] if x]
    beta = None
    if spx_daily and len(t) > 300:  # weekly returns vs the S&P 500, sampled on the same trading days
        day = lambda ts: datetime.fromtimestamp(ts, timezone.utc).date()  # noqa: E731
        sp = {day(ts): x for ts, x in spx_daily}
        pts = [(c[k], sp[day(t[k])]) for k in range(len(t)) if day(t[k]) in sp]
        pairs = [(pts[k][0] / pts[k - 5][0] - 1, pts[k][1] / pts[k - 5][1] - 1) for k in range(5, len(pts), 5)]
        if len(pairs) > 30:
            xs = [p[1] for p in pairs]
            ys = [p[0] for p in pairs]
            mx, my = statistics.mean(xs), statistics.mean(ys)
            var = sum((x - mx) ** 2 for x in xs)
            beta = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / var if var else None
    fin = attempt(f"sec facts {sym}", sec.financials, cik, default=None) if cik else None
    sub = attempt(f"sec filings {sym}", sec.submissions, cik, default=None) if cik else None
    filings = sec.recent_filings(sub) if sub else []
    shares = fin["shares"][-1][1] if fin and fin["shares"] else None
    mcap_shares, eps_ttm, class_shares = shares, (fin or {}).get("epsTTM"), None
    if info.get("shareClass") and filings:
        # multi-class company: this ticker is one class, so ownership % uses that class's count,
        # while market cap and P/E use every class on an as-converted basis
        cov = attempt(f"cover shares {sym}", sec.cover_shares, cik, filings, default=None)
        if cov:
            hit = [v for k, v in cov["classes"].items() if info["shareClass"].lower() in k.lower()]
            class_shares = hit[0] if hit else None
            record(f"cover shares {sym}", bool(hit), n=len(cov["classes"]),
                   note=f"as of {cov['asOf']}: " + ", ".join(f"{k or 'total'}={v:,.0f}" for k, v in cov["classes"].items()))
        ratio = info.get("classRatio", 1)
        mcap_shares = fin["diluted"] * ratio if fin and fin.get("diluted") else None
        eps_ttm = eps_ttm / ratio if eps_ttm else None
        shares = class_shares
    mcap = price * mcap_shares if price and mcap_shares else None
    nxt = next((x for x in cal if x["sym"] == sym and x["date"] >= ds(today())), None)
    if mcap is None and nxt and nxt.get("mcap"):
        mcap = nxt["mcap"]  # Nasdaq's figure, when SEC per-share data only exists by share class
    pe = price / eps_ttm if eps_ttm and eps_ttm > 0 and price else None
    ni4 = [q["ni"] for q in (fin or {}).get("quarters", [])[-4:] if q.get("ni") is not None]
    if pe is None and mcap and len(ni4) == 4 and sum(ni4) > 0:
        pe = mcap / sum(ni4)  # market cap over trailing net income: same ratio, no per-share data needed
    quarters = []
    if fin:
        qs = fin["quarters"]
        by_end = {x["end"]: x for x in qs}
        for x in qs[-5:]:
            ya = (date.fromisoformat(x["end"]) - timedelta(days=365))
            prev = min(by_end.values(), key=lambda y: abs((date.fromisoformat(y["end"]) - ya).days)) if by_end else None
            yoy = None
            if prev and abs((date.fromisoformat(prev["end"]) - ya).days) < 20 and prev.get("rev") and x.get("rev"):
                yoy = (x["rev"] / prev["rev"] - 1) * 100
            quarters.append({"end": x["end"], "rev": r(x["rev"] / 1e6 if x["rev"] else None, 1), "revYoY": r(yoy, 1),
                             "gm": r(x["gp"] / x["rev"] * 100 if x.get("gp") and x.get("rev") else None, 1),
                             "op": r(x["op"] / 1e6 if x.get("op") else None, 1), "ni": r(x["ni"] / 1e6 if x.get("ni") else None, 1),
                             "eps": r(x["eps"], 2)})
    ins = attempt(f"form 4 {sym}", sec.insiders, cik, filings, default=[]) if cik else []
    cutoff = ds(today() - timedelta(days=365))
    yr = [x for x in ins or [] if (x.get("date") or x["filed"]) >= cutoff]
    buys = [x for x in yr if x["code"] == "P"]
    sells = [x for x in yr if x["code"] == "S"]
    net = sum((x["shares"] or 0) * (x["price"] or 0) for x in buys) - sum((x["shares"] or 0) * (x["price"] or 0) for x in sells)
    insider = {"rows": [x for x in (ins or []) if x["code"] in ("P", "S", "M", "A", "F")][:12],
               "net": r(net, 0), "buyers": len({x["name"] for x in buys}), "sellers": len({x["name"] for x in sells}),
               "sales": len(sells), "planSales": sum(1 for x in sells if x["plan"])}
    holders5 = attempt(f"13D/G {sym}", sec.big_holders, cik, filings, default=[]) if cik else []
    news = attempt(f"news {sym}", mi.feed, f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={sym}&region=US&lang=en-US", default=[]) or []
    idx = [{"name": "S&P 500", "member": sym in mem.get("sp500", [])}, {"name": "S&P MidCap 400", "member": sym in mem.get("sp400", [])},
           {"name": "S&P SmallCap 600", "member": sym in mem.get("sp600", [])}]
    # an empty list means "membership unavailable" (member: None), not "not a member"
    idx += [{"name": "Russell 1000", "member": (sym in mem["r1000"]) if mem.get("r1000") else None},
            {"name": "Russell 2000", "member": (sym in mem["r2000"]) if mem.get("r2000") else None}]
    eight_k = [{"date": f["filingDate"], "items": f.get("items"), "url": sec.filing_url(cik, f["accessionNumber"], f["primaryDocument"])}
               for f in filings if f["form"] == "8-K"][:6]
    return {"sym": sym, "name": q["name"] or title, "exch": q["exch"], "sector": mem.get("sectors", {}).get(sym) or (sub or {}).get("sicDescription"),
            "updated": now_iso(), "quote": q, "charts": charts,
            "stats": {"mcap": r(mcap, 0), "pe": r(pe, 1), "divYield": r(div_ttm / price * 100, 2) if price and div_ttm else 0,
                      "hi52": q["hi52"], "lo52": q["lo52"], "avgVol3m": r(statistics.mean(vols), 0) if vols else None,
                      "beta": r(beta, 2), "shares": shares, "epsTTM": r(eps_ttm, 2)},
            "ytd": r(ytd, 2), "y1": r(y1, 2), "fin": quarters, "insider": insider, "holders5": holders5, "index": idx,
            "news": [{"title": n["title"], "link": n["link"], "published": n["published"]} for n in news[:6]],
            "next": nxt, "eightK": eight_k, "peers": info.get("peers", []), "cik": cik}


def quotes(mem, cal):
    spx = attempt("chart ^GSPC 5y", mk.chart, "^GSPC", "5y", "1d")
    spx_daily = list(zip(spx["t"], spx["c"])) if spx else None
    pages = {}
    for sym, info in UNIVERSE.items():
        p = attempt(f"quote page {sym}", quote_page, sym, info, mem, spx_daily, cal)
        if p:
            pages[sym] = p
    # peers table needs every page first
    for sym, p in pages.items():
        rows = []
        for s in [sym] + p["peers"]:
            o = pages.get(s)
            if o:
                rows.append({"sym": s, "name": o["name"], "mcap": o["stats"]["mcap"], "pe": o["stats"]["pe"],
                             "ytd": o["ytd"], "y1": o["y1"], "me": s == sym})
        p["peerRows"] = rows
        own = read(f"ownership/{sym}.json")
        if own:
            p["own"] = {"period": own["period"], "inst": own["tiles"]["inst"], "instChg": own["tiles"]["instChg"],
                        "holders": own["tiles"]["holders"], "holdersChg": own["tiles"]["holdersChg"],
                        "trend": [x["inst"] for x in own["trend"]], "buyers": own["buyers"][:3], "sellers": own["sellers"][:3],
                        "buyersActive": own.get("buyersActive", [])[:3] if "buyersActive" in own else None,
                        "sellersActive": own.get("sellersActive", [])[:3] if "sellersActive" in own else None,
                        "read": own["read"], "passive": own["tiles"].get("passive")}
        write(f"quotes/{sym}.json", p)
    write("quotes/index.json", {"updated": now_iso(), "tickers": [
        {"sym": s, "name": p["name"], "price": p["quote"]["price"], "pct": p["quote"]["pct"]} for s, p in sorted(pages.items())]})
    return pages


# =====================================================================================
# DAILY: earnings season
# =====================================================================================

def _season(d):
    qend = date(d.year, ((d.month - 1) // 3) * 3 + 1, 1) - timedelta(days=1)  # last quarter end
    if (d - qend).days < 8:  # first week after quarter end: still the prior season
        qend = date(qend.year, ((qend.month - 1) // 3) * 3 + 1, 1) - timedelta(days=1)
    q = (qend.month - 1) // 3 + 1
    return qend, f"Q{q} {qend.year}"


def earnings(mem, live=False):
    """Earnings season. live=True (hourly market job) refetches only today and yesterday so reports land the same day."""
    sp = set(mem.get("sp500", []))
    sect = mem.get("sectors", {})
    d0 = today()
    qend, label = _season(d0)
    start, end = qend + timedelta(days=8), qend + timedelta(days=80)
    cache = read("earnings_cache.json", {}) or {}
    days = {}
    day = start
    while day <= max(end, d0 + timedelta(days=14)):
        if day.weekday() < 5:
            key = ds(day)
            fresh_needed = day >= d0 - timedelta(days=1) if live else day >= d0 - timedelta(days=3)
            if key in cache.get("days", {}) and not fresh_needed:
                days[key] = cache["days"][key]
            else:
                rows = attempt(f"nasdaq earnings {key}", mi.earnings_day, key, default=None)
                days[key] = rows if rows is not None else cache.get("days", {}).get(key, [])
        day += timedelta(days=1)
    record("nasdaq earnings calendar", True, n=sum(len(v) for v in days.values()))
    # v2: reports with no time given now use the same-session window, so moves cached by the old rule are redone
    moves = cache.get("moves", {}) if cache.get("movesV") == 2 else {}
    # Nasdaq drops the report time, estimate count and year-ago EPS from some rows once results are in. Remember
    # what earlier fetches said for each report so those fields stay filled.
    memo = cache.get("memo", {})
    for v in days.values():
        for x in v:
            k = f"{x['sym']}:{x['date']}"
            m = memo.setdefault(k, {})
            for f in ("when", "nEst", "lastYearEps"):
                val = x.get(f)
                if val not in (None, "—"):
                    m[f] = val
                elif m.get(f) is not None:
                    x[f] = m[f]
    memo = {k: v for k, v in memo.items() if k.split(":")[-1] >= ds(start - timedelta(days=7))}
    rows = [x for v in days.values() for x in v if x["sym"] in sp]
    reported = [x for x in rows if x["date"] <= ds(d0) and x["eps"] is not None and x["est"] is not None]
    live_moves = {}
    for x in reported:
        key = f"{x['sym']}:{x['date']}"
        if key in moves:
            continue
        try:
            ch = mk.chart(x["sym"], "3mo", "1d")
            dts = [datetime.fromtimestamp(ts, timezone.utc).date().isoformat() for ts in ch["t"]]
            if x["date"] in dts:
                i = dts.index(x["date"])
                # AMC reports trade the next session. BMO, and reports with no time given (mostly banks and
                # industrials, which report before the open), trade the same session.
                a, b = (i, i + 1) if x["when"] == "AMC" else (i - 1, i)
                if a >= 0 and b < len(ch["c"]):
                    mv = r((ch["c"][b] / ch["c"][a] - 1) * 100, 2)
                    if dts[b] >= ds(d0):   # today's session isn't over: show it, but don't freeze it in the cache
                        live_moves[key] = mv
                    else:
                        moves[key] = mv
        except Exception as e:
            print("move skip", key, e)
    beats = [x for x in reported if x["eps"] >= x["est"]]
    surpr = [(x["eps"] - x["est"]) / abs(x["est"]) * 100 for x in reported if x["est"]]
    growth = [(x["eps"] - x["lastYearEps"]) / abs(x["lastYearEps"]) * 100 for x in reported if x.get("lastYearEps")]
    allmv = {**moves, **live_moves}
    mv_b = [allmv[f"{x['sym']}:{x['date']}"] for x in beats if allmv.get(f"{x['sym']}:{x['date']}") is not None]
    mv_m = [allmv[f"{x['sym']}:{x['date']}"] for x in reported if x not in beats and allmv.get(f"{x['sym']}:{x['date']}") is not None]
    by_sec = defaultdict(lambda: [0, 0])
    for x in reported:
        s = sect.get(x["sym"], "Other")
        by_sec[s][1] += 1
        if x in beats:
            by_sec[s][0] += 1
    for s in set(sect.get(x, "Other") for x in sp):
        by_sec.setdefault(s, [0, 0])
    weeks = Counter()
    for x in rows:
        dd = date.fromisoformat(x["date"])
        weeks[ds(dd - timedelta(days=dd.weekday()))] += 1
    this_week = ds(d0 - timedelta(days=d0.weekday()))
    recent = sorted([x for x in reported if x["date"] >= ds(d0 - timedelta(days=10))], key=lambda x: -(x["mcap"] or 0))[:12]
    recent_out = []
    for x in recent:
        key = f"{x['sym']}:{x['date']}"
        recent_out.append({**x, "sector": sect.get(x["sym"]), "move": allmv.get(key), "moveLive": key in live_moves,
                           "beat": x["eps"] >= x["est"], "surprisePct": r((x["eps"] - x["est"]) / abs(x["est"]) * 100, 1) if x["est"] else None})
    upcoming = sorted([x for x in rows if ds(d0) <= x["date"] <= ds(d0 + timedelta(days=14))],
                      key=lambda x: (x["date"], -(x["mcap"] or 0)))
    # trim the upcoming table to the biggest names per day
    per_day = defaultdict(list)
    for x in upcoming:
        if len(per_day[x["date"]]) < 6:
            per_day[x["date"]].append({**x, "sector": sect.get(x["sym"])})
    themes = headline_themes()
    write("earnings_cache.json", {"days": {k: v for k, v in days.items()}, "moves": moves, "movesV": 2, "memo": memo})
    all_cal = [x for v in days.values() for x in v]
    out = {"updated": now_iso(), "season": {"label": label, "qend": ds(qend), "start": ds(start)},
           "progress": {"reported": len(reported), "total": len(sp), "scheduled": len({x["sym"] for x in rows})},
           "weeks": [{"week": k, "n": n, "current": k == this_week} for k, n in sorted(weeks.items())],
           "score": {"n": len(reported), "beatPct": r(len(beats) / len(reported) * 100, 1) if reported else None,
                     "avgSurprise": r(statistics.mean(surpr), 1) if surpr else None,
                     "medSurprise": r(statistics.median(surpr), 1) if surpr else None,
                     "medGrowth": r(statistics.median(growth), 1) if growth else None,
                     "moveBeat": r(statistics.mean(mv_b), 2) if mv_b else None, "moveMiss": r(statistics.mean(mv_m), 2) if mv_m else None},
           "sectors": sorted([{"name": s, "beat": b, "n": n} for s, (b, n) in by_sec.items()], key=lambda z: (-z["n"], z["name"])),
           "recent": recent_out, "upcoming": [x for v in per_day.values() for x in v], "themes": themes}
    write("earnings.json", out)
    return all_cal


def headline_themes():
    items = (read("headlines.json", {}) or {}).get("items", [])
    cut = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    # news coverage only: press releases (market-size reports, class-action ads) would drown the signal
    week = [h for h in items if h["published"] >= cut and h.get("type") == "Publication"]
    if not week:
        return None
    since = min(h["published"] for h in week)
    terms = {"tariff": r"tariff", "AI": r"\bai\b|artificial intelligence", "recession": r"recession", "layoffs": r"layoff|job cuts",
             "rate cut": r"rate cuts?|cut rates", "rate hike": r"rate hikes?|hike rates|raise rates", "inflation": r"inflation|\bcpi\b",
             "Fed": r"\bfed\b|fomc|powell"}
    import re
    out = []
    for name, pat in terms.items():
        n = sum(1 for h in week if re.search(pat, h["title"], re.I))
        out.append({"term": name, "n": n, "share": r(n / len(week) * 100, 1)})
    raised = sum(1 for h in week if re.search(r"(raises|raised|boosts|lifts).*(guidance|outlook|forecast)", h["title"], re.I))
    lowered = sum(1 for h in week if re.search(r"(lowers|cuts|reduces|slashes).*(guidance|outlook|forecast)", h["title"], re.I))
    return {"n": len(week), "since": since, "terms": sorted(out, key=lambda x: -x["n"]), "raised": raised, "lowered": lowered}


# =====================================================================================
# DAILY: IPOs
# =====================================================================================

def ipos():
    d0 = today()
    months = []
    m = date(d0.year - 1, d0.month, 1)
    while m <= d0:
        months.append(m.strftime("%Y-%m"))
        m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    data = {ym: attempt(f"nasdaq ipo {ym}", mi.ipo_month, ym, default=None) for ym in months}
    cache = read("ipo_cache.json", {}) or {}
    ranges, first = cache.get("ranges", {}), cache.get("first", {})

    def pdate(s):
        try:
            return datetime.strptime(s, "%m/%d/%Y").date()
        except (TypeError, ValueError):
            return None
    priced, upcoming, filed, withdrawn = [], [], [], []
    for ym, dd in data.items():
        if not dd:
            continue
        for x in dd["priced"]:
            pd_ = pdate(x.get("pricedDate"))
            priced.append({"sym": x.get("proposedTickerSymbol"), "name": x.get("companyName"), "exch": x.get("proposedExchange"),
                           "price": num(x.get("proposedSharePrice")), "shares": num(x.get("sharesOffered")),
                           "proceeds": num(x.get("dollarValueOfSharesOffered")), "date": ds(pd_) if pd_ else None})
        if ym == months[-1] or ym == months[-2]:
            for x in dd["upcoming"]:
                sym = x.get("proposedTickerSymbol")
                if sym and x.get("proposedSharePrice"):
                    ranges[sym] = x.get("proposedSharePrice")
                ed = pdate(x.get("expectedPriceDate"))
                upcoming.append({"sym": sym, "name": x.get("companyName"), "exch": x.get("proposedExchange"),
                                 "range": x.get("proposedSharePrice"), "shares": num(x.get("sharesOffered")),
                                 "proceeds": num(x.get("dollarValueOfSharesOffered")), "date": ds(ed) if ed else None})
        for x in dd["filed"]:
            fd = pdate(x.get("filedDate"))
            filed.append({"sym": x.get("proposedTickerSymbol"), "name": x.get("companyName"),
                          "proceeds": num(x.get("dollarValueOfSharesOffered")), "date": ds(fd) if fd else None})
        for x in dd["withdrawn"]:
            wd = pdate(x.get("withdrawDate"))
            withdrawn.append({"sym": x.get("proposedTickerSymbol"), "name": x.get("companyName"), "exch": x.get("proposedExchange"),
                              "proceeds": num(x.get("dollarValueOfSharesOffered")), "date": ds(wd) if wd else None})
    priced = [x for x in {x["sym"] or x["name"]: x for x in priced if x["date"]}.values()]
    priced.sort(key=lambda x: x["date"], reverse=True)
    ytd = [x for x in priced if x["date"] >= f"{d0.year}-01-01"]
    # first-day and since-IPO returns (first day cached forever; latest price refreshed)
    latest = attempt("ipo latest prices (spark)", mk.spark, [x["sym"] for x in ytd if x["sym"]], default={}) or {}
    for x in ytd[:60]:
        s = x["sym"]
        if s and s not in first and x["price"]:
            try:
                ch = mk.chart(s, "3mo" if x["date"] >= ds(d0 - timedelta(days=80)) else "1y", "1d")
                dts = [datetime.fromtimestamp(ts, timezone.utc).date().isoformat() for ts in ch["t"]]
                k = next((i for i, dd in enumerate(dts) if dd >= x["date"]), None)
                if k is not None:
                    first[s] = r((ch["c"][k] / x["price"] - 1) * 100, 1)
            except Exception as e:
                print("ipo first-day skip", s, e)
    for x in ytd:
        s = x["sym"]
        x["d1"] = first.get(s)
        lp = (latest.get(s) or {}).get("price")
        x["last"] = lp
        x["since"] = r((lp / x["price"] - 1) * 100, 1) if lp and x["price"] else None
        rg = ranges.get(s)
        x["range"] = rg
        lo_hi = [num(v) for v in (rg or "").split("-")] if rg else []
        if len(lo_hi) == 2 and all(v is not None for v in lo_hi) and x["price"]:
            x["vs"] = "Above" if x["price"] > lo_hi[1] else ("Below" if x["price"] < lo_hi[0] else "Within")
        elif len(lo_hi) == 1 and lo_hi[0] and x["price"]:
            x["vs"] = "Above" if x["price"] > lo_hi[0] else ("Below" if x["price"] < lo_hi[0] else "Within")
        else:
            x["vs"] = None
    # SPACs list at $10 and trade near trust value, so they would drag every average toward zero:
    # stats below cover operating companies only; SPACs are counted separately and flagged in the tables.
    import re as _re
    for x in priced:
        nm, sy = x.get("name") or "", x.get("sym") or ""
        x["spac"] = bool(_re.search(r"\bacquisition (corp|corporation|company|co)\b|\bblank check\b|\bspac\b", nm, _re.I)
                         or (x.get("price") == 10 and sy.endswith("U")))
    ops = [x for x in ytd if not x["spac"]]
    d1s = [x["d1"] for x in ops if x["d1"] is not None]
    since = [x for x in ops if x["since"] is not None]
    by_month = Counter(x["date"][:7] for x in ytd)
    lockups = []
    for x in priced:
        lu = date.fromisoformat(x["date"]) + timedelta(days=180)
        if d0 <= lu <= d0 + timedelta(days=60):
            lp = (latest.get(x["sym"]) or {}).get("price")
            lockups.append({**x, "lockup": ds(lu), "vsIpo": r((lp / x["price"] - 1) * 100, 1) if lp and x["price"] else None})
    lockups.sort(key=lambda x: x["lockup"])
    vs = Counter(x["vs"] for x in ops if x["vs"])
    write("ipo_cache.json", {"ranges": ranges, "first": first})
    write("ipo.json", {
        "updated": now_iso(), "year": d0.year,
        "score": {"n": len(ytd), "proceeds": r(sum(x["proceeds"] or 0 for x in ytd), 0),
                  "avgD1": r(statistics.mean(d1s), 1) if d1s else None, "medD1": r(statistics.median(d1s), 1) if d1s else None,
                  "above": r(sum(1 for x in since if x["since"] > 0) / len(since) * 100, 0) if since else None,
                  "medSize": r(statistics.median([x["proceeds"] for x in ops if x["proceeds"]]), 0) if any(x["proceeds"] for x in ops) else None,
                  "nOps": len(ops), "nSpac": len(ytd) - len(ops),
                  "withdrawn": len([x for x in withdrawn if (x["date"] or "") >= f"{d0.year}-01-01"]),
                  "measuredD1": len(d1s)},
        "months": [{"m": f"{d0.year}-{k:02d}", "n": by_month.get(f"{d0.year}-{k:02d}", 0)} for k in range(1, d0.month + 1)],
        "vs": {k: vs.get(k, 0) for k in ("Above", "Within", "Below")},
        "exch": Counter((x["exch"] or "Other").split(" ")[0] for x in ytd).most_common(5),
        "upcoming": sorted([x for x in upcoming if x["date"] is None or x["date"] >= ds(d0)], key=lambda x: x["date"] or "9999")[:12],
        "recent": ytd[:20], "filed": sorted(filed, key=lambda x: x["date"] or "", reverse=True)[:10],
        "withdrawn": sorted(withdrawn, key=lambda x: x["date"] or "", reverse=True)[:6], "lockups": lockups[:8]})


# =====================================================================================
# DAILY: macro (FRED)
# =====================================================================================
SERIES = ["CPIAUCSL", "CPILFESL", "CPIAUCNS", "CPILFENS", "PCEPILFE", "UNRATE", "PAYEMS", "A191RL1Q225SBEA", "DFF", "DGS10", "T10Y2Y",
          "BAMLH0A0HYM2", "ICSA", "RSAFS", "UMCSENT", "SAHMREALTIME", "FEDFUNDS", "USREC", "DFEDTARL", "DFEDTARU",
          "CUSR0000SAH1", "CUSR0000SASL2RS", "CPIUFDSL", "CUSR0000SACL1E", "CPIENGSL",
          "JTSJOL", "JTSQUR", "CES0500000003", "CIVPART", "CCSA", "LNS12300060"]
# Market-moving releases only, with their usual release time (New York). FRED's calendar lists many minor
# series and a "FOMC Press Release" entry for every day, so the list is matched by name, not taken whole.
MAJOR_RELEASES = [
    ("consumer price index", "Consumer Price Index (CPI)", "08:30"),
    ("employment situation", "Jobs report (Employment Situation)", "08:30"),
    ("gross domestic product", "GDP", "08:30"),
    ("personal income and outlays", "Personal income & PCE inflation", "08:30"),
    ("advance monthly sales for retail", "Retail sales", "08:30"),
    ("producer price index", "Producer Price Index (PPI)", "08:30"),
    ("unemployment insurance weekly claims report", "Initial jobless claims", "08:30"),
    ("new residential construction", "Housing starts", "08:30"),
    ("advance report on durable goods", "Durable goods orders", "08:30"),
    ("g.17 industrial production", "Industrial production", "09:15"),
    ("job openings and labor turnover", "JOLTS job openings", "10:00"),
    ("existing home sales", "Existing home sales", "10:00"),
    ("surveys of consumers", "UMich consumer sentiment", "10:00"),
    ("university of michigan", "UMich consumer sentiment", "10:00"),
]


def curate_calendar(cal, fomc_dates):
    """FRED release dates -> [{date, name, et, at}] for major releases on weekdays, plus FOMC decisions from config."""
    from zoneinfo import ZoneInfo
    ny = ZoneInfo("America/New_York")
    out, seen = [], set()
    for c in cal:
        nm = (c.get("name") or "").lower()
        hit = next((x for x in MAJOR_RELEASES if nm.startswith(x[0])), None)
        if not hit:
            continue
        d = date.fromisoformat(c["date"])
        if d.weekday() >= 5 or (c["date"], hit[1]) in seen:
            continue
        seen.add((c["date"], hit[1]))
        out.append({"date": c["date"], "name": hit[1], "et": hit[2], "id": c.get("id")})
    first = min((c["date"] for c in cal), default=ds(today()))
    last_ = max((c["date"] for c in cal), default=first)
    for d in fomc_dates:
        if first <= d <= last_:
            out.append({"date": d, "name": "FOMC rate decision", "et": "14:00", "id": None})
    for c in out:
        hh, mm = map(int, c["et"].split(":"))
        y, mo, dd = map(int, c["date"].split("-"))
        c["at"] = datetime(y, mo, dd, hh, mm, tzinfo=ny).astimezone(timezone.utc).isoformat()
    out.sort(key=lambda c: c["at"])
    return out


def _yoy(obs, lag=12):
    """Year-over-year % change, matched by calendar month. Counting 12 observations back is wrong when a month is
    missing (BLS did not publish October 2025 CPI), which shifted every later reading by about a month."""
    by = {d[:7]: v for d, v in obs}
    out = []
    for d, v in obs:
        prev = by.get(f"{int(d[:4]) - 1}-{d[5:7]}")
        if prev:
            out.append((d, (v / prev - 1) * 100))
    return out


def _monthly(obs):
    by = {}
    for d, v in obs:
        by[d[:7]] = v  # last value in the month
    return sorted((k + "-01", v) for k, v in by.items())


def macro():
    raw = {}
    for sid in SERIES:
        obs = attempt(f"fred {sid}", mi.fred_series, sid, default=None)
        if obs:
            raw[sid] = obs
    record("fred mode", True, note="API key" if mi.FRED_KEY else "public CSV (no API key)")
    # The BLS headline and core CPI year-over-year rates are computed from NOT seasonally adjusted indexes.
    # Year-over-year on the seasonally adjusted series can differ by a few tenths, so use the unadjusted ones.
    for sa, ns in (("CPIAUCSL", "CPIAUCNS"), ("CPILFESL", "CPILFENS")):
        if raw.get(ns):
            raw[sa] = raw[ns]

    def last(sid, k=1):
        o = raw.get(sid) or []
        return o[-k] if len(o) >= k else (None, None)

    def tile(label, sid, value, period, chg, tone):
        return {"label": label, "id": sid, "value": value, "period": period, "chg": chg, "tone": tone}
    tiles = []

    def mon(dstr):
        return datetime.strptime(dstr, "%Y-%m-%d").strftime("%b %Y")

    def fmt(v, d=1, suf=""):
        return None if v is None else f"{v:.{d}f}{suf}"
    if "CPIAUCSL" in raw:
        y = _yoy(raw["CPIAUCSL"])
        tiles.append(tile("CPI inflation (YoY)", "CPIAUCSL", fmt(y[-1][1], 1, "%"), mon(y[-1][0]) + f" · prior {y[-2][1]:.1f}%",
                          f"{'▲' if y[-1][1] > y[-2][1] else '▼'} {abs(y[-1][1] - y[-2][1]):.1f} pt", "bad" if y[-1][1] > y[-2][1] else "good"))
    if "PCEPILFE" in raw:
        y = _yoy(raw["PCEPILFE"])
        tiles.append(tile("Core PCE (YoY)", "PCEPILFE", fmt(y[-1][1], 1, "%"), mon(y[-1][0]) + f" · prior {y[-2][1]:.1f}%",
                          f"{'▲' if y[-1][1] > y[-2][1] else '▼'} {abs(y[-1][1] - y[-2][1]):.1f} pt", "bad" if y[-1][1] > y[-2][1] else "good"))
    if "UNRATE" in raw:
        (d1, v1), (_, v0) = last("UNRATE"), last("UNRATE", 2)
        tiles.append(tile("Unemployment rate", "UNRATE", fmt(v1, 1, "%"), mon(d1) + f" · prior {v0:.1f}%",
                          f"{'▲' if v1 > v0 else ('▼' if v1 < v0 else '■')} {abs(v1 - v0):.1f} pt", "bad" if v1 > v0 else ("good" if v1 < v0 else "neutral")))
    if "PAYEMS" in raw and len(raw["PAYEMS"]) > 4:
        p = raw["PAYEMS"]
        ch = [p[i][1] - p[i - 1][1] for i in range(len(p) - 3, len(p))]
        tiles.append(tile("Nonfarm payrolls", "PAYEMS", f"{ch[-1]:+.0f}K", mon(p[-1][0]) + f" · prior {ch[-2]:+.0f}K",
                          f"3-mo avg {statistics.mean(ch):+.0f}K", "neutral"))
    if "A191RL1Q225SBEA" in raw:
        (d1, v1), (_, v0) = last("A191RL1Q225SBEA"), last("A191RL1Q225SBEA", 2)
        qn = (int(d1[5:7]) - 1) // 3 + 1
        tiles.append(tile("Real GDP (q/q ann.)", "A191RL1Q225SBEA", f"{v1:+.1f}%", f"Q{qn} {d1[:4]} · prior {v0:+.1f}%",
                          f"{'▲' if v1 > v0 else '▼'} {abs(v1 - v0):.1f} pt", "good" if v1 > v0 else "bad"))
    if "DFF" in raw:
        d1, v1 = last("DFF")
        lo, hi = last("DFEDTARL")[1], last("DFEDTARU")[1]
        yr = [v for d, v in raw["DFF"] if d <= ds(date.fromisoformat(d1) - timedelta(days=365))]
        chg = f"{(v1 - yr[-1]) * 100:+.0f} bp in 12 mo" if yr else ""
        tiles.append(tile("Fed funds (effective)", "DFF", fmt(v1, 2, "%"), f"Target {lo:.2f}–{hi:.2f}%" if lo is not None and hi is not None else d1, chg, "neutral"))
    for label, sid, unit in (("10-year Treasury", "DGS10", "%"), ("10Y – 2Y spread", "T10Y2Y", ""), ("High-yield spread", "BAMLH0A0HYM2", "%")):
        if sid in raw:
            (d1, v1), (_, v0) = last(sid), last(sid, 2)
            tiles.append(tile(label, sid, (f"{v1:+.2f}" if not unit else f"{v1:.2f}%"), datetime.strptime(d1, "%Y-%m-%d").strftime("%b %d"),
                              f"{'▲' if v1 > v0 else ('▼' if v1 < v0 else '■')} {abs(v1 - v0) * 100:.0f} bp",
                              ("bad" if v1 > v0 else "good") if sid == "BAMLH0A0HYM2" else "neutral"))
    if "ICSA" in raw:
        o = raw["ICSA"]
        tiles.append(tile("Initial jobless claims", "ICSA", f"{o[-1][1] / 1000:.0f}K", "Week of " + datetime.strptime(o[-1][0], "%Y-%m-%d").strftime("%b %d"),
                          f"4-wk avg {statistics.mean(v for _, v in o[-4:]) / 1000:.0f}K", "neutral"))
    if "RSAFS" in raw:
        o = raw["RSAFS"]
        m1, m0 = (o[-1][1] / o[-2][1] - 1) * 100, (o[-2][1] / o[-3][1] - 1) * 100
        tiles.append(tile("Retail sales (MoM)", "RSAFS", f"{m1:+.1f}%", mon(o[-1][0]) + f" · prior {m0:+.1f}%",
                          f"{'▲' if m1 > m0 else '▼'} {abs(m1 - m0):.1f} pt", "good" if m1 > m0 else "bad"))
    if "UMCSENT" in raw:
        (d1, v1), (_, v0) = last("UMCSENT"), last("UMCSENT", 2)
        tiles.append(tile("Consumer sentiment", "UMCSENT", f"{v1:.1f}", mon(d1) + f" · prior {v0:.1f}",
                          f"{'▲' if v1 > v0 else '▼'} {abs(v1 - v0):.1f}", "good" if v1 > v0 else "bad"))

    # history charts (monthly since 2016)
    def hist(obs):
        return [(d, r(v, 3)) for d, v in obs if d >= "2016-01-01"]
    history = {}
    if "UNRATE" in raw:
        history["UNRATE"] = hist(raw["UNRATE"])
    if "CPIAUCSL" in raw:
        history["CPI"] = hist(_yoy(raw["CPIAUCSL"]))
    if "FEDFUNDS" in raw:
        history["FEDFUNDS"] = hist(raw["FEDFUNDS"])
    for sid in ("DGS10", "T10Y2Y", "BAMLH0A0HYM2"):
        if sid in raw:
            history[sid] = hist(_monthly(raw[sid]))
    recessions = []
    if "USREC" in raw:
        run = None
        for d, v in raw["USREC"]:
            if v == 1 and run is None:
                run = d
            if v == 0 and run is not None:
                recessions.append((run, d))
                run = None
        if run:
            recessions.append((run, raw["USREC"][-1][0]))
    # recession watch
    signals = []
    if "SAHMREALTIME" in raw:
        v = last("SAHMREALTIME")[1]
        signals.append({"n": "Sahm rule", "id": "SAHMREALTIME", "detail": f"Reading {v:.2f} · triggers at 0.50",
                        "status": "Triggered" if v >= 0.5 else ("Watch" if v >= 0.3 else "OK"), "kind": "warn" if v >= 0.3 else "ok"})
    if "PAYEMS" in raw and len(raw["PAYEMS"]) > 4:
        p = raw["PAYEMS"]
        avg = statistics.mean(p[i][1] - p[i - 1][1] for i in range(len(p) - 3, len(p)))
        signals.append({"n": "Payroll momentum", "id": "PAYEMS", "detail": f"3-month avg {avg:+.0f}K",
                        "status": "Weak" if avg < 100 else "OK", "kind": "warn" if avg < 100 else "ok"})
    if "T10Y2Y" in raw:
        v = last("T10Y2Y")[1]
        signals.append({"n": "Yield curve", "id": "T10Y2Y", "detail": f"10Y–2Y at {v:+.2f}",
                        "status": "Inverted" if v < 0 else "OK", "kind": "warn" if v < 0 else "ok"})
    if "BAMLH0A0HYM2" in raw:
        v = last("BAMLH0A0HYM2")[1]
        signals.append({"n": "Credit spreads", "id": "BAMLH0A0HYM2", "detail": f"HY spread {v:.2f}%",
                        "status": "Wide" if v >= 5 else "OK", "kind": "warn" if v >= 5 else "ok"})
    if "ICSA" in raw:
        v = statistics.mean(x for _, x in raw["ICSA"][-4:]) / 1000
        signals.append({"n": "Jobless claims", "id": "ICSA", "detail": f"4-wk avg {v:.0f}K",
                        "status": "Rising" if v >= 250 else "OK", "kind": "warn" if v >= 250 else "ok"})
    infl = []
    for label, sid in (("Shelter", "CUSR0000SAH1"), ("Services ex-shelter", "CUSR0000SASL2RS"), ("Food", "CPIUFDSL"),
                       ("Core goods", "CUSR0000SACL1E"), ("All items", "CPIAUCSL"), ("Energy", "CPIENGSL")):
        if sid in raw:
            y = _yoy(raw[sid])
            infl.append({"n": label, "id": sid, "v": r(y[-1][1], 1), "period": y[-1][0]})
    labor = []
    for label, sid, f in (("Job openings", "JTSJOL", lambda v: f"{v / 1000:.1f}M"), ("Quits rate", "JTSQUR", lambda v: f"{v:.1f}%"),
                          ("Avg. hourly earnings (YoY)", "CES0500000003", None), ("Labor force participation", "CIVPART", lambda v: f"{v:.1f}%"),
                          ("Continuing claims", "CCSA", lambda v: f"{v / 1e6:.2f}M"), ("Prime-age employment ratio", "LNS12300060", lambda v: f"{v:.1f}%")):
        if sid not in raw:
            continue
        o = raw[sid] if f else _yoy(raw[sid])
        if f is None:
            f = lambda v: f"{v:+.1f}%"  # noqa: E731
        d1, v1 = o[-1]
        ago = min(o, key=lambda x: abs((date.fromisoformat(x[0]) - (date.fromisoformat(d1) - timedelta(days=365))).days))
        labor.append({"n": label, "id": sid, "now": f(v1), "prev": f(ago[1]), "period": d1})
    latest = []  # dashboard "economic data" table: newest releases first
    for label, sid, kind in (("CPI (YoY)", "CPIAUCSL", "yoy"), ("Core CPI (YoY)", "CPILFESL", "yoy"), ("Unemployment rate", "UNRATE", "lvl"),
                             ("Nonfarm payrolls", "PAYEMS", "diff"), ("Retail sales (MoM)", "RSAFS", "mom"), ("Initial jobless claims", "ICSA", "k"),
                             ("Consumer sentiment", "UMCSENT", "lvl1")):
        o = raw.get(sid)
        if not o or len(o) < 14:
            continue
        if kind == "yoy":
            y = _yoy(o)
            a, b, d1 = f"{y[-1][1]:.1f}%", f"{y[-2][1]:.1f}%", y[-1][0]
        elif kind == "mom":
            a, b, d1 = f"{(o[-1][1] / o[-2][1] - 1) * 100:+.1f}%", f"{(o[-2][1] / o[-3][1] - 1) * 100:+.1f}%", o[-1][0]
        elif kind == "diff":
            a, b, d1 = f"{o[-1][1] - o[-2][1]:+.0f}K", f"{o[-2][1] - o[-3][1]:+.0f}K", o[-1][0]
        elif kind == "k":
            a, b, d1 = f"{o[-1][1] / 1000:.0f}K", f"{o[-2][1] / 1000:.0f}K", o[-1][0]
        else:
            a, b, d1 = f"{o[-1][1]:.1f}" + ("%" if sid == "UNRATE" else ""), f"{o[-2][1]:.1f}" + ("%" if sid == "UNRATE" else ""), o[-1][0]
        latest.append({"n": label, "id": sid, "act": a, "prior": b, "period": d1})
    cal = attempt("fred release calendar", mi.fred_release_calendar, default=[]) or []
    cal = curate_calendar(cal, CONFIG.get("fomc_2026", []))
    fomc = next((d for d in CONFIG.get("fomc_2026", []) if d >= ds(today())), None)
    write("macro.json", {"updated": now_iso(), "keyed": bool(mi.FRED_KEY), "tiles": tiles, "history": history,
                         "recessions": recessions, "signals": signals, "infl": infl, "labor": labor, "latest": latest,
                         "calendar": cal[:14], "fomc": fomc,
                         "target": [last("DFEDTARL")[1], last("DFEDTARU")[1]] if "DFEDTARL" in raw else None})


def ticker_list():
    """Every SEC-registered company with a US ticker, for the site-wide search and on-demand quote pages."""
    j = get("https://www.sec.gov/files/company_tickers_exchange.json")
    f = j["fields"]
    rows = [dict(zip(f, x)) for x in j["data"]]
    out = sorted({(x["ticker"].upper().replace(".", "-"), x["name"], int(x["cik"]), x.get("exchange") or "") for x in rows if x.get("ticker")})
    write("tickers.json", {"updated": now_iso(), "fields": ["sym", "name", "cik", "exch"], "t": [list(x) for x in out]})
    return out


def daily():
    attempt("sec ticker list", ticker_list)
    mem = attempt("members (wikipedia)", build_members, default=None) or read("members.json", {}) or {}
    macro_ok = attempt("macro", macro)
    cal = attempt("earnings season", earnings, mem, default=[]) or []
    attempt("ipos", ipos)
    attempt("quote pages", quotes, mem, cal)
    return macro_ok


# =====================================================================================
# QUARTERLY: 13F ownership
# =====================================================================================

def quarterly():
    import os
    from . import own13f
    own13f.build(force=os.environ.get("RUN_13F") == "1")


# =====================================================================================
# ODDS + DIGEST (run with the hourly market job)
# =====================================================================================

def odds():
    """Prediction-market odds (Kalshi). Keeps the first reading of each UTC day as the 'previous day' baseline."""
    from . import src_odds
    groups = src_odds.all_groups()
    old = read("odds.json", {}) or {}
    day = today().isoformat()
    if old.get("baseDay") == day:
        base, base_day = old.get("base", {}), day
    else:  # new day: yesterday's last readings become the comparison
        base, base_day = old.get("current", {}), day
    current = {}
    for g in groups:
        for m in g["markets"]:
            current[m["id"]] = m["pct"]
            m["prev"] = base.get(m["id"])
    write("odds.json", {"updated": now_iso(), "source": "Kalshi", "groups": groups, "current": current, "base": base, "baseDay": base_day})


def _ct_now():
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/Chicago"))


# ---- rule-based daily story: fills the editorial slots from the numbers when no hand-written editorial exists for today (no AI, no cost) ----
_DEFENSIVE = {"Health Care", "Utilities", "Cons. Staples", "Real Estate"}
_RELEASE_WHY = (
    ("cpi", "Inflation is what the Fed watches most. A hotter reading raises rate-hike odds and pressures stock valuations; a cooler one does the opposite."),
    ("pce", "The Fed's preferred inflation gauge. It decides how long rates stay high."),
    ("nonfarm", "The jobs report. Strong hiring supports earnings but can keep the Fed hawkish; weak hiring raises recession fears."),
    ("payroll", "The jobs report. Strong hiring supports earnings but can keep the Fed hawkish; weak hiring raises recession fears."),
    ("jobless", "A weekly read on layoffs. A sustained rise is an early recession warning."),
    ("unemployment", "Labor-market slack. A rising rate is the first sign the jobs market is cooling."),
    ("retail", "Consumer spending is about two-thirds of the economy. A miss raises growth worries."),
    ("housing", "A read on rate-sensitive construction demand; mortgage rates drive it."),
    ("gdp", "The broadest measure of growth. The revision shifts recession and earnings expectations."),
    ("sentiment", "Consumer mood often leads spending. Inflation expectations inside the survey get Fed attention."),
    ("ism", "A survey of factory and service activity. Below 50 means contraction."),
    ("pmi", "A survey of business activity. Below 50 means contraction."),
    ("fomc", "The Fed's rate decision. Markets trade the statement and press conference as much as the rate itself."),
    ("fed", "Fed communication moves rate expectations, which move every asset price."),
    ("treasury", "Auction demand shows how hungry buyers are for government debt; weak auctions push yields up."),
)
_IND_WHY = {
    "CPIAUCSL": "Inflation sets the Fed's path. Faster price growth means higher-for-longer rates, which is a headwind for stock valuations.",
    "CPILFESL": "Core strips out food and energy and shows underlying price pressure, the part the Fed can actually influence.",
    "UNRATE": "A rising jobless rate shows demand for workers cooling. Modest rises ease inflation; fast rises signal recession risk.",
    "PAYEMS": "Hiring pace drives income and spending. Thin payroll growth raises recession odds even as it eases Fed pressure.",
    "RSAFS": "Retail sales track consumer demand, the largest part of GDP and a driver of company revenue.",
    "ICSA": "Weekly layoff filings are the fastest-moving labor indicator. Sustained increases warn of a turn.",
    "UMCSENT": "Consumer mood tends to lead spending. Low readings usually mean cautious shoppers.",
}


def _auto_story(day, tiles, dash, futures, levels, macro_, ups, rec, cal_today, heads, od, reads, auto_earn, es, tn):
    import re as _re
    pct = lambda k: (tiles.get(k) or {}).get("pct")  # noqa: E731
    f1 = lambda v: f"{v:+.1f}%"  # noqa: E731
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=36)).isoformat()
    pool = [h for h in heads.get("items", []) if (h.get("published") or "") >= cutoff and h.get("type") != "SEC filing"
            and not mi.is_junk(h["title"], h.get("source", ""))]
    pool_rel = [h for h in pool if digest_relevant(h)]
    secs = sorted(dash.get("sectors", []), key=lambda x: x.get("pct") or 0)
    spx, ixic, dji, rut = pct("spx"), pct("ixic"), pct("dji"), pct("rut")
    vx = tiles.get("vix") or {}
    br = dash.get("breadth") or {}
    # ---- headline + lede ----
    d = spx if spx is not None else (es or {}).get("pct")
    word = "little changed" if d is None or abs(d) < 0.15 else ("rise" if d > 0 else "fall") if abs(d) >= 0.6 else ("edge higher" if d > 0 else "edge lower")
    lead_sec = f", led by {secs[-1]['name']}" if secs and secs[-1].get("pct", 0) >= 0.8 and d and d > 0 else (f", with {secs[0]['name']} the weak spot" if secs and secs[0].get("pct", 0) <= -0.8 else "")
    headline = ("Stocks " + word if word != "little changed" else "Stocks little changed") + lead_sec
    if rut is not None and spx is not None and rut - spx >= 0.9:
        headline += "; small caps surge"
    elif rut is not None and spx is not None and spx - rut >= 0.9:
        headline += "; small caps lag"
    bits = []
    if spx is not None:
        bits.append(f"The S&P 500 is {f1(spx)}, the Nasdaq {f1(ixic)}, the Dow {f1(dji)} and the Russell 2000 {f1(rut)}." if None not in (ixic, dji, rut) else f"The S&P 500 is {f1(spx)}.")
    if br.get("n"):
        bits.append(f"{br['adv']} of {br['n']} S&P 500 stocks are up.")
    if es and es.get("pct") is not None:
        bits.append(f"Futures point {'higher' if es['pct'] > 0.15 else 'lower' if es['pct'] < -0.15 else 'flat'} ({es['pct']:+.2f}%).")
    lede = " ".join(bits)
    # ---- what's moving ----
    pts = []
    if None not in (spx, ixic, dji, rut):
        if rut - spx >= 0.7:
            read = "Small caps are outrunning large caps. That usually means falling yields or improving growth expectations, because small companies borrow more and are more rate-sensitive."
        elif spx - rut >= 0.7:
            read = "Large caps are beating small caps, a defensive tilt that often shows up when growth or funding worries rise."
        elif dji - ixic >= 0.7:
            read = "The Dow is beating the Nasdaq: money is rotating out of tech and AI names into cyclical and value stocks."
        elif ixic - dji >= 0.7:
            read = "The Nasdaq is beating the Dow: growth and AI names are leading while value lags."
        else:
            read = "The major indexes are moving together, so there is no strong rotation signal."
        pts.append({"lead": "Index read: " + f"S&P {f1(spx)}, Nasdaq {f1(ixic)}, Dow {f1(dji)}, Russell 2000 {f1(rut)}.", "body": read})
    if secs:
        dfn = [s["pct"] for s in secs if s["name"] in _DEFENSIVE]
        cyc = [s["pct"] for s in secs if s["name"] not in _DEFENSIVE]
        if dfn and cyc:
            gap = sum(dfn) / len(dfn) - sum(cyc) / len(cyc)
            tilt = (("Defensive and rate-sensitive sectors lead while small caps outperform, which fits easing yields more than a flight to safety." if (None not in (rut, spx) and rut - spx >= 0.7) else
                     "Defensive sectors (health care, utilities, staples, real estate) are beating cyclicals, a risk-off tilt.") if gap >= 0.6 else
                    "Cyclical sectors are beating defensives, a risk-on tilt." if gap <= -0.6 else "Defensives and cyclicals are moving together, so no clear risk-on or risk-off signal.")
            pts.append({"lead": f"Sectors: {secs[-1]['name']} leads ({f1(secs[-1]['pct'])}), {secs[0]['name']} lags ({f1(secs[0]['pct'])}).", "body": tilt})
    mv = (dash.get("movers") or {})
    named = []
    for side in ("gainers", "losers"):
        for m in (mv.get(side) or [])[:3]:
            if abs(m.get("pct") or 0) < 3:
                continue
            nm = _re.sub(r",?\s+(Inc|Corp|Corporation|Co|Company|Ltd|PLC|Holdings?|Group)\.?$", "", m.get("name") or "", flags=_re.I).strip()
            hit = None
            for h in pool:
                if m["sym"] in (h.get("tickers") or []) or (len(nm) >= 4 and _re.search(r"\b" + _re.escape(nm) + r"\b", h["title"], _re.I)):
                    hit = h
                    break
            named.append((m, hit))
    if named:
        counts = Counter(h["title"] for m, h in named[:4] if h)
        shared = [t for t, n in counts.items() if n > 1]
        parts = []
        for m, h in named[:4]:
            tag = f"{m['sym']} ({m.get('sector') or 'n/a'}, {f1(m['pct'])})"
            if h and h["title"] in shared:
                parts.append(tag + ": named in a movers roundup.")
            elif h:
                parts.append(tag + f": \"{h['title'][:110]}\" ({h['source']}).")
            else:
                parts.append(tag + ": no headline in our feed yet; check the company's filings for a catalyst.")
        body = " ".join(parts)
        for t in shared:
            body += f" Roundup: \"{t[:120]}\"."
        pts.append({"lead": "Biggest S&P 500 movers.", "body": body})
    macro_bits, rate_read = [], ""
    if tn and tn.get("chg") is not None:
        bp = tn["chg"] * 100
        if abs(bp) >= 3:
            rate_read = ("Falling yields ease pressure on rate-sensitive stocks like real estate, utilities and small caps." if bp < 0
                         else "Rising yields raise borrowing costs and pressure high-valuation growth stocks.")
        macro_bits.append(f"the 10-year yield is {tn['price']:.2f}% ({bp:+.0f} bp)")
    for k, nm, thr in (("dxy", "the dollar", 0.5), ("wti", "WTI crude", 1.5), ("gold", "gold", 1.0), ("btc", "Bitcoin", 3.0)):
        v = pct(k)
        if v is not None and abs(v) >= thr:
            macro_bits.append(f"{nm} is {f1(v)}")
    if vx.get("price") is not None:
        macro_bits.append(f"the VIX is {vx['price']:.1f} ({f1(vx.get('pct') or 0)})")
    if macro_bits:
        pts.append({"lead": "Rates, commodities and volatility: " + "; ".join(macro_bits) + ".", "body": rate_read or "No large cross-asset move is driving stocks today."})
    big = [e for e in rec if e.get("move") is not None and abs(e["move"]) >= 3]
    if big:
        pts.append({"lead": "Recent earnings reactions.", "body": " ".join(f"{e['sym']} {f1(e['move'])} ({'beat' if (e.get('surprisePct') or 0) >= 0 else 'missed'} by {abs(e.get('surprisePct') or 0):.1f}%)." for e in big[:5])})
    # ---- indicators ----
    rows, pos, neg = [], 0, 0
    names = {x["id"]: x["n"] for x in macro_.get("latest", [])}
    for rd in reads:
        rows.append({"n": names.get(rd["id"], rd["id"]), "read": rd["read"], "signal": rd["sig"], "why": _IND_WHY.get(rd["id"], "")})
        pos += rd["sig"] == "pos"
        neg += rd["sig"] == "neg"
    tilt = ("The economic readings lean negative." if neg > pos + 1 else "The economic readings lean positive." if pos > neg + 1 else "The economic readings are mixed.")
    bottom = f"{tilt} {pos} improved and {neg} worsened in the latest releases." + (" Readings that move prices and growth in the wrong direction at once (higher inflation with weaker hiring) are the hardest mix for the Fed and for stock valuations." if any(r["id"] in ("CPIAUCSL", "CPILFESL") and r["sig"] == "neg" for r in reads) and any(r["id"] in ("PAYEMS", "UNRATE") and r["sig"] == "neg" for r in reads) else "")
    # ---- earnings ----
    earn = []
    for e in ups[:4]:
        when = {"BMO": "Reports before the open", "AMC": "Reports after the close"}.get(e.get("when"), "Reports today")
        res = f"Consensus EPS {e['est']}" + (f", up from {e['lastYearEps']} a year ago" if e.get("lastYearEps") else "") + "." if e.get("est") is not None else "Consensus EPS not available."
        mc = f"${e['mcap'] / 1e9:,.0f}B market cap" if e.get("mcap") else "Large reporter"
        earn.append({"sym": e["sym"], "name": e.get("name", ""), "when": when, "result": res,
                     "why": f"{mc}, so the result and especially the outlook can move {e.get('sector') or 'its sector'} peers. Watch guidance more than the headline beat."})
    for e in rec[:6]:
        if e["sym"] in auto_earn:
            earn.append({"sym": e["sym"], "name": e.get("name", ""), "when": "Reported " + (date.fromisoformat(e["date"]).strftime("%a %b %-d") if e.get("date") else "recently"),
                         "result": f"EPS {e.get('eps')} vs. {e.get('est')} expected ({(e.get('surprisePct') or 0):+.1f}%); stock {f1(e['move'])}.", "why": auto_earn[e["sym"]]})
    # ---- what to watch ----
    watch = []
    for c in cal_today[:4]:
        low = c["name"].lower()
        why = next((w for k, w in _RELEASE_WHY if k in low), "Scheduled release; compare the number with the consensus forecast.")
        watch.append({"t": c.get("et", "") + " ET" if c.get("et") else "Today", "e": c["name"], "why": why})
    if ups:
        tops = ", ".join(f"{e['sym']} ({e.get('when') or 'today'})" for e in ups[:5])
        watch.append({"t": "Today", "e": f"{len(ups)} S&P 500 companies report", "why": f"Largest by market value: {tops}. Guidance and margins move stocks more than the headline EPS beat."})
    fomc = macro_.get("fomc")
    if fomc:
        days = (date.fromisoformat(fomc) - date.fromisoformat(day)).days
        if 0 <= days <= 21:
            watch.append({"t": date.fromisoformat(fomc).strftime("%b %-d"), "e": "Next FOMC decision" + (" is today" if days == 0 else f" in {days} days"),
                          "why": "Every inflation, jobs and yield move between now and then shifts what traders expect the Fed to do."})
    best = None
    for g in od.get("groups", []):
        for m in g.get("markets", []):
            if best is None or abs(m["pct"] - 50) < abs(best[1]["pct"] - 50):
                best = (g, m)
    if best and abs(best[1]["pct"] - 50) <= 35:
        g, m = best
        watch.append({"t": "Odds", "e": f"{g.get('event') or g['title']}: {m['label']} at {m['pct']:.0f}%", "why": "Prediction markets price this close to a coin flip, so a surprise in the data can swing it quickly (Kalshi)."})
    lvl_notes = []
    for l in levels:
        near = []
        if l.get("vs50") is not None and abs(l["vs50"]) <= 1:
            near.append(f"its 50-day average ({l['ma50']:,.0f})")
        if l.get("vs200") is not None and abs(l["vs200"]) <= 1.5:
            near.append(f"its 200-day average ({l['ma200']:,.0f})")
        if l.get("offHigh") is not None and abs(l["offHigh"]) <= 1:
            near.append("its 52-week high")
        if near:
            lvl_notes.append(f"{l['n']} near " + " and ".join(near))
    if lvl_notes:
        watch.append({"t": "Levels", "e": "Index levels in play: " + "; ".join(lvl_notes) + ".", "why": "Traders watch these lines for a break or a bounce; a close through one often changes the short-term trend."})
    # ---- anything wild ----
    wild = []
    if br.get("n") and br["adv"] / br["n"] >= 0.8:
        wild.append({"tag": "BREADTH", "h": f"{br['adv']} of {br['n']} S&P 500 stocks are rising", "body": "That is unusually broad participation. Moves with this many stocks up tend to reflect macro news (rates, oil, policy) more than individual company stories."})
    elif br.get("n") and br["adv"] / br["n"] <= 0.2:
        wild.append({"tag": "BREADTH", "h": f"Only {br['adv']} of {br['n']} S&P 500 stocks are rising", "body": "That is a very one-sided tape. Selling this broad is usually driven by macro fear, not stock-specific news."})
    top_mv = max([m for side in ("gainers", "losers") for m in (mv.get(side) or [])], key=lambda m: abs(m.get("pct") or 0), default=None)
    if top_mv and abs(top_mv["pct"]) >= 8:
        wild.append({"tag": "MOVER", "h": f"{top_mv['name']} ({top_mv['sym']}) is {f1(top_mv['pct'])}", "body": f"The largest one-day move in the S&P 500 today, in {top_mv.get('sector') or 'its sector'}. Moves this size for a large company usually come from earnings, guidance or a deal."})
    if None not in (rut, ixic) and abs(rut - ixic) >= 1.5:
        wild.append({"tag": "SPREAD", "h": f"A {abs(rut - ixic):.1f}-point gap between the Russell 2000 ({f1(rut)}) and the Nasdaq ({f1(ixic)})", "body": "Big gaps between index groups mark rotation days, when money moves between styles instead of in or out of stocks."})
    if tn and tn.get("price") is not None:
        hist = (macro_.get("history") or {}).get("DGS10") or []
        since = next((h for h in reversed(hist[:-1]) if h[1] is not None and h[1] >= tn["price"]), None)
        if tn["price"] >= 4.5:
            ago = None if since is None else (int(day[:4]) - int(since[0][:4])) * 12 + int(day[5:7]) - int(since[0][5:7])
            note = ("This is the highest monthly level in the roughly ten years of data on this site." if since is None else
                    "Yields have sat at or above this level for months." if ago <= 3 else f"The monthly reading was last this high in {date.fromisoformat(since[0][:7] + '-01').strftime('%b %Y')}.")
            wild.append({"tag": "RATES", "h": f"The 10-year Treasury yield is {tn['price']:.2f}%", "body": note + " High yields compete with stocks for money and raise borrowing costs across the economy."})
    for l in levels[:1]:
        if l.get("offHigh") is not None and l["offHigh"] <= -10:
            wild.append({"tag": "DRAWDOWN", "h": f"{l['n']} is {abs(l['offHigh']):.1f}% below its 52-week high", "body": "A drop of 10% or more from the high is the textbook definition of a market correction."})
    wild = wild[:4]
    srcs = [{"t": f"{h['source']}: {h['title'][:100]}", "u": h["link"]} for h in sorted([h for h in pool_rel if h.get("type") == "Publication" and h.get("source") != "Yahoo Finance"],
                                                                                            key=lambda h: h["published"], reverse=True)[:5]]
    return {"headline": headline, "lede": lede, "market": {"title": "What is moving the market", "points": pts},
            "data": {"bottom": bottom, "rows": rows}, "earnings": earn, "watch": watch, "wild": wild, "sources": srcs}


def digest():
    """Morning briefing built only from data the site already has plus futures, global indexes and index levels."""
    ct = _ct_now()
    day = ct.date().isoformat()
    dash, macro_, earn = read("dashboard.json", {}) or {}, read("macro.json", {}) or {}, read("earnings.json", {}) or {}
    heads, od = read("headlines.json", {}) or {}, read("odds.json", {}) or {}

    def quote(sym, name, tag, dec=2):
        ch = attempt(f"digest {sym}", mk.chart, sym, "1d", "5m")
        if not ch:
            return None
        q = mk.quote_from_chart(ch)
        return {"n": name, "tag": tag, "sym": sym, "price": q["price"], "chg": q["chg"], "pct": q["pct"], "dec": dec, "time": q["time"]}
    futures = [x for x in (quote("ES=F", "S&P 500", "FUT"), quote("NQ=F", "Nasdaq 100", "FUT"), quote("YM=F", "Dow Jones", "FUT"),
                           quote("RTY=F", "Russell 2000", "FUT")) if x]
    tiles = {t["id"]: t for t in dash.get("tiles", [])}
    macro_rows = []
    for tid, name, tag in (("tnx", "10Y Treasury yield", "YLD"), ("dxy", "US Dollar Idx", "SPOT"), ("wti", "WTI crude", "FUT"),
                           ("gold", "Gold", "FUT"), ("btc", "Bitcoin", "SPOT"), ("vix", "VIX", "IDX")):
        t = tiles.get(tid)
        if t:
            macro_rows.append({"n": name, "tag": tag, "price": t["price"], "chg": t["chg"], "pct": t["pct"], "dec": t.get("dec", 2)})
    world = [x for x in (quote("^STOXX50E", "Euro Stoxx 50", "EUROPE"), quote("^FTSE", "FTSE 100", "UK"), quote("^N225", "Nikkei 225", "JAPAN"),
                         quote("^HSI", "Hang Seng", "HK")) if x]
    # key levels: prior close vs 50- and 200-day averages and the 52-week range
    levels = []
    for sym, name in (("^GSPC", "S&P 500"), ("^IXIC", "Nasdaq Comp."), ("^RUT", "Russell 2000"), ("^DJI", "Dow Jones")):
        ch = attempt(f"levels {sym}", mk.chart, sym, "1y", "1d")
        if not ch or len(ch["c"]) < 60:
            continue
        c = ch["c"]
        px = c[-1]
        ma = lambda n: sum(c[-n:]) / n if len(c) >= n else None  # noqa: E731
        levels.append({"n": name, "price": r(px, 2), "ma50": r(ma(50), 2), "ma200": r(ma(200), 2), "hi52": r(max(c), 2), "lo52": r(min(c), 2),
                       "vs50": r((px / ma(50) - 1) * 100, 2) if ma(50) else None, "vs200": r((px / ma(200) - 1) * 100, 2) if ma(200) else None,
                       "offHigh": r((px / max(c) - 1) * 100, 2)})
    # economic calendar: today and the rest of the week (Central time)
    cal = macro_.get("calendar", [])
    end = (ct.date() + timedelta(days=7)).isoformat()
    cal_today = [c for c in cal if c["date"] == day]
    cal_week = [c for c in cal if day < c["date"] <= end]
    # earnings today, split by timing, plus reports that already landed in the last two days
    ups = [e for e in earn.get("upcoming", []) if e.get("date") == day]
    rec = [e for e in earn.get("recent", []) if e.get("date") >= (ct.date() - timedelta(days=2)).isoformat()]
    ups.sort(key=lambda e: -(e.get("mcap") or 0))
    rec.sort(key=lambda e: -(e.get("mcap") or 0))
    keep = ("sym", "name", "date", "when", "mcap", "est", "eps", "surprisePct", "move", "beat", "sector")
    trim = lambda e: {k: e.get(k) for k in keep}  # noqa: E731
    # headlines from the last 24 hours, notable first
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    spam = ("lost money", "who lost", "class action", "securities fraud", "law firm", "attorney", "investigation on behalf", "investors who", "lawsuit",
            "reminds investors", "deadline", "recover", "losses")
    pool = [h for h in heads.get("items", []) if (h.get("published") or "") >= cutoff and h.get("type") != "SEC filing"
            and not any(w in h["title"].lower() for w in spam) and mi.is_english(h["title"]) and not mi.is_junk(h["title"], h.get("source", "")) and digest_relevant(h)]
    # publications first (they decide what matters), then notable press releases; newest first within each
    pubs = sorted([h for h in pool if h.get("type") == "Publication"], key=lambda h: h["published"], reverse=True)
    rel = sorted([h for h in pool if h.get("type") != "Publication" and h.get("notable")], key=lambda h: h["published"], reverse=True)
    news = pubs[:6] + rel[:4]
    news.sort(key=lambda h: h["published"], reverse=True)
    # things to watch: FOMC proximity, today's releases, biggest reporters
    watch = []
    fomc = macro_.get("fomc")
    if fomc:
        days = (date.fromisoformat(fomc) - ct.date()).days
        watch.append({"t": date.fromisoformat(fomc).strftime("%b %-d"), "e": "Next FOMC decision" + (" is today" if days == 0 else f" in {days} days"), "why": f"Fed funds target now {macro_.get('target', ['—'])[0]}–{macro_.get('target', ['', '—'])[-1]}%" if macro_.get("target") else ""})
    for c in cal_today[:4]:
        watch.append({"t": "Today", "e": c["name"], "why": "Scheduled release"})
    for e in ups[:3]:
        watch.append({"t": e.get("when") or "Today", "e": f"{e['sym']} reports", "why": f"EPS estimate {e['est']}" if e.get("est") is not None else "Earnings"})
    # headline summary: plain statements generated from the numbers, no editorial
    top = []
    es = next((f for f in futures if f["sym"] == "ES=F"), None)
    if es and es["pct"] is not None:
        top.append({"lead": f"S&P futures are {'up' if es['pct'] >= 0 else 'down'} {abs(es['pct']):.2f}%.",
                    "rest": "Nasdaq 100 futures " + next((f"{f['pct']:+.2f}%" for f in futures if f["sym"] == "NQ=F" and f["pct"] is not None), "n/a") + "."})
    tn = tiles.get("tnx")
    if tn and tn.get("price") is not None:
        top.append({"lead": f"The 10-year yield is {tn['price']:.2f}%,", "rest": f"{'up' if (tn['chg'] or 0) >= 0 else 'down'} {abs((tn['chg'] or 0) * 100):.0f} bp on the day."})
    best = max(rec + ups, key=lambda e: abs(e.get("surprisePct") or 0), default=None)
    if best and best.get("surprisePct") is not None:
        top.append({"lead": f"{best['sym']} {'beat' if best['surprisePct'] >= 0 else 'missed'} by {abs(best['surprisePct']):.1f}%.",
                    "rest": f"EPS {best['eps']} vs. {best['est']} expected."})
    shift = None
    for g in od.get("groups", []):
        for m in g["markets"]:
            if m.get("prev") is not None and (shift is None or abs(m["pct"] - m["prev"]) > abs(shift[1]["pct"] - shift[1]["prev"])):
                shift = (g, m)
    if shift and abs(shift[1]["pct"] - shift[1]["prev"]) >= 3:
        g, m = shift
        top.append({"lead": f"Biggest odds move: {g.get('event') or g['title']} — {m['label']}.", "rest": f"{m['prev']:.0f}% → {m['pct']:.0f}% since the start of the day."})
    if news:
        top.append({"lead": "Top headline:", "rest": news[0]["title"]})
    # ---- rule-based commentary: plain-English reads generated from the numbers (no AI, no cost) ----
    def num(x):
        try:
            return float(str(x).replace("%", "").replace("K", "").replace("+", "").replace("M", ""))
        except ValueError:
            return None
    # polarity: +1 means a higher reading is good for markets/economy, -1 means higher is bad
    POL = {"CPIAUCSL": (-1, "Inflation", "inflation pressure rising", "inflation pressure easing"), "CPILFESL": (-1, "Core inflation", "underlying inflation pressure rising", "underlying inflation pressure easing"),
           "UNRATE": (-1, "Unemployment", "the labor market is loosening", "the labor market is tightening"), "PAYEMS": (1, "Hiring", "hiring picked up", "hiring slowed"),
           "RSAFS": (1, "Consumer spending", "spending picked up", "spending cooled"), "ICSA": (-1, "Layoff claims", "layoffs are rising", "layoffs are falling"),
           "UMCSENT": (1, "Consumer sentiment", "consumer mood is improving", "consumer mood is worsening")}
    reads = []
    for row in macro_.get("latest", []):
        pol = POL.get(row["id"])
        a, b = num(row["act"]), num(row["prior"])
        if not pol or a is None or b is None:
            continue
        diff = a - b
        if abs(diff) < 1e-9:
            sig, txt = "mix", f"Unchanged from {row['prior']}."
        else:
            good = (diff > 0) == (pol[0] > 0)
            sig = "pos" if good else "neg"
            phrase = pol[2] if diff > 0 else pol[3]
            txt = f"{phrase[0].upper() + phrase[1:]} ({'up' if diff > 0 else 'down'} from {row['prior']})."
        reads.append({"id": row["id"], "sig": sig, "read": txt})
    auto_earn = {}
    for e in rec:
        sp, mv = e.get("surprisePct"), e.get("move")
        if sp is None or mv is None:
            continue
        beat = sp >= 0
        size = "a big" if abs(sp) >= 10 else "a modest" if abs(sp) >= 3 else "a slim"
        if beat and mv < -1:
            txt = f"Beat by {sp:.1f}% but the stock fell {abs(mv):.1f}%: expectations were high, or guidance and the mix of results disappointed."
        elif beat and mv > 1:
            txt = f"{size.capitalize()} beat ({sp:+.1f}%), rewarded with a {mv:.1f}% gain."
        elif not beat and mv > 1:
            txt = f"Missed by {abs(sp):.1f}% yet rose {mv:.1f}%: the bar was low or the outlook helped."
        elif not beat and mv < -1:
            txt = f"{size.capitalize()} miss ({sp:+.1f}%), punished with a {abs(mv):.1f}% drop."
        else:
            txt = f"{'Beat' if beat else 'Missed'} by {abs(sp):.1f}%; the stock barely moved ({mv:+.1f}%)."
        auto_earn[e["sym"]] = txt
    tone_bits = []
    if es and es["pct"] is not None:
        p = es["pct"]
        tone_bits.append("S&P futures are " + ("sharply lower" if p <= -1 else "lower" if p <= -0.3 else "sharply higher" if p >= 1 else "higher" if p >= 0.3 else "little changed") + f" ({p:+.2f}%)")
    vx = tiles.get("vix")
    if vx and vx.get("pct") is not None:
        tone_bits.append(f"the VIX is {vx['price']:.1f} ({vx['pct']:+.1f}%), " + ("a sign of rising caution" if vx["pct"] > 5 else "a sign of calm" if vx["pct"] < -5 else "steady"))
    if tn and tn.get("chg") is not None:
        tone_bits.append(f"the 10-year yield is {tn['price']:.2f}% ({tn['chg'] * 100:+.0f} bp)")
    br2 = dash.get("breadth")
    if br2 and br2.get("n"):
        tone_bits.append(f"{br2['adv']} of {br2['n']} S&P 500 stocks are up")
    secs = sorted(dash.get("sectors", []), key=lambda x: x.get("pct") or 0)
    if len(secs) >= 2:
        tone_bits.append(f"{secs[-1]['name']} leads ({secs[-1]['pct']:+.1f}%) and {secs[0]['name']} lags ({secs[0]['pct']:+.1f}%)")
    lvl_reads = []
    for l in levels:
        v50, v200 = l.get("vs50"), l.get("vs200")
        if v50 is None or v200 is None:
            continue
        trend = ("above both averages: trend intact" if v50 > 0 and v200 > 0 else "below both averages: trend broken" if v50 < 0 and v200 < 0
                 else "below the 50-day but above the 200-day: pullback inside an uptrend" if v200 > 0 else "above the 50-day but below the 200-day: bouncing in a downtrend")
        lvl_reads.append({"n": l["n"], "read": f"{trend}; {abs(l['offHigh']):.1f}% below its 52-week high."})
    auto = {"tone": ("; ".join(tone_bits)[0].upper() + "; ".join(tone_bits)[1:] + ".") if tone_bits else "", "reads": reads, "earnings": auto_earn, "levels": lvl_reads}
    auto["story"] = attempt("auto story", _auto_story, day, tiles, dash, futures, levels, macro_, ups, rec, cal_today, heads, od, reads, auto_earn, es, tn, default=None)
    write("digest.json", {"auto": auto, "updated": now_iso(), "date": day, "top": top, "futures": futures, "macro": macro_rows, "world": world,
                          "levels": levels, "calToday": cal_today, "calWeek": cal_week[:14], "latest": macro_.get("latest", [])[:8],
                          "reportingToday": [trim(e) for e in ups[:14]], "reported": [trim(e) for e in rec[:10]], "news": news, "watch": watch,
                          "breadth": dash.get("breadth"), "odds": od.get("groups", [])})


SCREENER_MIN_ROWS = 500


def screener():
    """Stock screener table: price history for every listed stock with 13F coverage plus the S&P 1,500, joined to SEC fundamentals."""
    import glob as _glob
    import os as _os
    from . import src_screen as sc
    from .net import DATA
    today = _ct_now().date()
    mem = read("members.json", {}) or {}
    t = read("tickers.json", {}) or {}
    cols = t.get("fields") or ["sym", "name", "cik", "exch"]
    info = {row[cols.index("sym")]: row for row in t.get("t", [])}
    sp = {"sp500": set(mem.get("sp500", [])), "sp400": set(mem.get("sp400", [])), "sp600": set(mem.get("sp600", []))}
    owned = {_os.path.basename(f)[:-5] for f in _glob.glob(str(DATA / "ownership" / "*.json")) if not f.endswith("index.json")}
    universe = sorted((owned | sp["sp500"] | sp["sp400"] | sp["sp600"]) & set(info))
    hist, spark_fail = sc.spark_year(universe)
    failures = []
    fund = attempt("sec frames", sc.fundamentals, today, failures, default={}) or {}
    if not fund:
        failures.append("SEC frames returned nothing: no fundamentals, only price columns")
    g = lambda key, sub, cik: (fund.get(key) or {}).get(sub, {}).get(cik)  # noqa: E731
    shares_when = (fund.get("shares") or {}).get("when", {})
    earn = read("earnings.json", {}) or {}
    ecache = read("earnings_cache.json", {}) or {}
    nxt = {}
    for d, rows in sorted((ecache.get("days") or {}).items()):
        if d >= today.isoformat():
            for e in rows:
                nxt.setdefault(e["sym"], d)
    for e in earn.get("upcoming", []):
        nxt.setdefault(e["sym"], e["date"])
    rows = []
    for sym in universe:
        if sym not in hist:
            continue
        row = info[sym]
        cik = int(row[cols.index("cik")]) if row[cols.index("cik")] else None
        pf = sc.price_features(*hist[sym])
        own = read(f"ownership/{sym}.json", None) if sym in owned else None
        idx = (1 if sym in sp["sp500"] else 0) | (2 if sym in sp["sp400"] else 0) | (4 if sym in sp["sp600"] else 0)
        f = {k: g(k, "a", cik) for k in ("rev", "ni", "eps", "gp", "op", "ocf", "capex", "dps")} if cik else {}
        rev0, ni0, eps0 = (g("rev", "a0", cik), g("ni", "a0", cik), g("eps", "a0", cik)) if cik else (None, None, None)
        qr, qr0 = (g("rev", "q", cik), g("rev", "q0", cik)) if cik else (None, None)
        bs = {k: g(k, "v", cik) for k in ("assets", "liab", "equity", "cash", "shares")} if cik else {}
        so = (own or {}).get("so") or bs.get("shares")
        has_fund = any(v is not None for v in list(f.values()) + list(bs.values()))
        if not has_fund and not idx:
            continue  # ETFs, funds and trusts carry no company financials in the SEC data
        px = pf["px"]
        mcap = px * so / 1e6 if so and px else None
        pos = lambda x: x if (x is not None and x > 0) else None  # noqa: E731
        pct = lambda a, b: r(a / b * 100, 1) if (a is not None and b not in (None, 0)) else None  # noqa: E731
        fcf = (f.get("ocf") - f.get("capex")) if (f.get("ocf") is not None and f.get("capex") is not None) else None
        tr = ((own or {}).get("trend") or [{}])[-1] if own else {}
        tl = (own or {}).get("tiles") or {}
        out = {"sym": sym, "name": (mem.get("names", {}).get(sym) or row[cols.index("name")] or "")[:40], "exch": row[cols.index("exch")] or "",
               "sector": mem.get("sectors", {}).get(sym) or "", "idx": idx, **pf,
               "mcap": r(mcap, 0), "rev": r(f["rev"] / 1e6, 0) if f.get("rev") is not None else None,
               "revG": pct(f.get("rev") - rev0, abs(rev0)) if f.get("rev") is not None and rev0 else None,
               "qRevG": pct(qr - qr0, abs(qr0)) if qr is not None and qr0 else None,
               "gm": (lambda v: v if v is not None and -100 <= v <= 100 else None)(pct(f.get("gp"), f.get("rev")) if f.get("rev") and f.get("rev") > 0 else None),
               "om": pct(f.get("op"), f.get("rev")) if f.get("rev") and f.get("rev") > 0 else None,
               "nm": pct(f.get("ni"), f.get("rev")) if f.get("rev") and f.get("rev") > 0 else None,
               "roe": (lambda v: v if v is not None and abs(v) <= 300 else None)(pct(f.get("ni"), bs.get("equity")) if bs.get("equity") and bs["equity"] > 0 else None),
               "roa": pct(f.get("ni"), bs.get("assets")) if bs.get("assets") else None,
               "eps": r(f.get("eps"), 2), "epsG": pct(f.get("eps") - eps0, abs(eps0)) if f.get("eps") is not None and eps0 else None,
               "pe": r(px / f["eps"], 1) if f.get("eps") and f["eps"] > 0 and px else None,
               "ps": r(mcap / (f["rev"] / 1e6), 2) if mcap and f.get("rev") and f["rev"] > 0 else None,
               "pb": r(mcap / (bs["equity"] / 1e6), 2) if mcap and bs.get("equity") and bs["equity"] > 0 else None,
               "fcf": r(fcf / 1e6, 0) if fcf is not None else None,
               "fcfY": r(fcf / 1e6 / mcap * 100, 2) if fcf is not None and mcap else None,
               "divY": (lambda v: v if v is not None and v <= 25 else None)(r(f["dps"] / px * 100, 2) if f.get("dps") is not None and px and f["dps"] >= 0 else None),
               "debtEq": r(bs["liab"] / bs["equity"], 2) if bs.get("liab") is not None and bs.get("equity") and bs["equity"] > 0 else None,
               "cash": r(bs["cash"] / 1e6, 0) if bs.get("cash") is not None else None,
               "inst": tr.get("inst"), "holders": tr.get("holders"), "instChg": tl.get("instChg"),
               "earnDays": (date.fromisoformat(nxt[sym]) - today).days if sym in nxt else None}
        rows.append(out)
    if len(rows) < SCREENER_MIN_ROWS:
        raise RuntimeError(f"screener built only {len(rows)} rows; refusing to overwrite the last good file")
    keys = [k for k in rows[0]]
    table = {k: [row.get(k) for row in rows] for k in keys}
    fill = {k: sum(1 for v in table[k] if v not in (None, "")) for k in keys}
    write("screener.json", {"updated": now_iso(), "asOf": today.isoformat(), "n": len(rows), "cols": keys, "d": table, "fill": fill,
                            "fy": today.year - 1, "ql": (fund.get("rev") or {}).get("ql"), "sparkBatchFails": spark_fail,
                            "failures": failures[:40], "universe": {"owned": len(owned), "sp1500": len(sp["sp500"] | sp["sp400"] | sp["sp600"]), "priced": len(hist)}})
    return rows


def notes():
    """Monthly data notes (first week of each month): findings computed from the site's own data files."""
    from . import notes as _notes
    n = _notes.main()
    record("data notes", True, note=(n or {}).get("month") or "no note due")
