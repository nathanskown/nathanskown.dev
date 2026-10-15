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
    write("members.json", out)
    return out


NOTABLE = ("acquire", "acquisition", "merger", "to buy", "takeover", "guidance", "outlook", "bankrupt", "chapter 11",
           "ceo", "resign", "steps down", "buyback", "repurchase", "activist", "layoff", "recall", "fda", "downgrade",
           "upgrade", "record", "rate cut", "rate hike", "fomc", "tariff", "probe", "lawsuit", "settle", "13d")
ITEM_NOTABLE = ("1.01", "1.03", "2.01", "2.02", "2.05", "2.06", "4.02", "5.02")


def headlines():
    import re
    old = read("headlines.json", {}) or {}
    seen = {h["link"]: h for h in old.get("items", [])}
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
                notable = items_hit or any(k in low for k in NOTABLE)
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
    heads = attempt("headlines", headlines, default=[]) or (read("headlines.json", {}) or {}).get("items", [])
    asof = max([t.get("time") or 0 for t in tiles] or [0])
    write("dashboard.json", {"updated": now_iso(), "asOf": asof, "tiles": tiles, "sectors": sectors, "movers": movers,
                             "breadth": breadth, "curve": curve, "watch": watch, "headlines": heads[:8]})
    attempt("prediction-market odds", odds)
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


def earnings(mem):
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
            if key in cache.get("days", {}) and day < d0 - timedelta(days=3):
                days[key] = cache["days"][key]
            else:
                rows = attempt(f"nasdaq earnings {key}", mi.earnings_day, key, default=None)
                days[key] = rows if rows is not None else cache.get("days", {}).get(key, [])
        day += timedelta(days=1)
    record("nasdaq earnings calendar", True, n=sum(len(v) for v in days.values()))
    moves = cache.get("moves", {})
    rows = [x for v in days.values() for x in v if x["sym"] in sp]
    reported = [x for x in rows if x["date"] <= ds(d0) and x["eps"] is not None and x["est"] is not None]
    for x in reported:
        key = f"{x['sym']}:{x['date']}"
        if key in moves:
            continue
        try:
            ch = mk.chart(x["sym"], "3mo", "1d")
            dts = [datetime.fromtimestamp(ts, timezone.utc).date().isoformat() for ts in ch["t"]]
            if x["date"] in dts:
                i = dts.index(x["date"])
                a, b = (i - 1, i) if x["when"] == "BMO" else (i, i + 1)
                if a >= 0 and b < len(ch["c"]):
                    moves[key] = r((ch["c"][b] / ch["c"][a] - 1) * 100, 2)
        except Exception as e:
            print("move skip", key, e)
    beats = [x for x in reported if x["eps"] >= x["est"]]
    surpr = [(x["eps"] - x["est"]) / abs(x["est"]) * 100 for x in reported if x["est"]]
    growth = [(x["eps"] - x["lastYearEps"]) / abs(x["lastYearEps"]) * 100 for x in reported if x.get("lastYearEps")]
    mv_b = [moves[f"{x['sym']}:{x['date']}"] for x in beats if moves.get(f"{x['sym']}:{x['date']}") is not None]
    mv_m = [moves[f"{x['sym']}:{x['date']}"] for x in reported if x not in beats and moves.get(f"{x['sym']}:{x['date']}") is not None]
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
        recent_out.append({**x, "sector": sect.get(x["sym"]), "move": moves.get(key),
                           "beat": x["eps"] >= x["est"], "surprisePct": r((x["eps"] - x["est"]) / abs(x["est"]) * 100, 1) if x["est"] else None})
    upcoming = sorted([x for x in rows if ds(d0) <= x["date"] <= ds(d0 + timedelta(days=14))],
                      key=lambda x: (x["date"], -(x["mcap"] or 0)))
    # trim the upcoming table to the biggest names per day
    per_day = defaultdict(list)
    for x in upcoming:
        if len(per_day[x["date"]]) < 6:
            per_day[x["date"]].append({**x, "sector": sect.get(x["sym"])})
    themes = headline_themes()
    write("earnings_cache.json", {"days": {k: v for k, v in days.items()}, "moves": moves})
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
    week = [h for h in items if h["published"] >= cut]
    if not week:
        return None
    terms = {"tariff": r"tariff", "AI": r"\bai\b|artificial intelligence", "recession": r"recession", "layoffs": r"layoff|job cuts",
             "rate cut": r"rate cut|cut rates", "inflation": r"inflation"}
    import re
    out = []
    for name, pat in terms.items():
        n = sum(1 for h in week if re.search(pat, h["title"], re.I))
        out.append({"term": name, "n": n, "share": r(n / len(week) * 100, 1)})
    raised = sum(1 for h in week if re.search(r"(raises|raised|boosts|lifts).*(guidance|outlook|forecast)", h["title"], re.I))
    lowered = sum(1 for h in week if re.search(r"(lowers|cuts|reduces|slashes).*(guidance|outlook|forecast)", h["title"], re.I))
    return {"n": len(week), "terms": sorted(out, key=lambda x: -x["n"]), "raised": raised, "lowered": lowered}


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
    d1s = [x["d1"] for x in ytd if x["d1"] is not None]
    since = [x for x in ytd if x["since"] is not None]
    by_month = Counter(x["date"][:7] for x in ytd)
    lockups = []
    for x in priced:
        lu = date.fromisoformat(x["date"]) + timedelta(days=180)
        if d0 <= lu <= d0 + timedelta(days=60):
            lp = (latest.get(x["sym"]) or {}).get("price")
            lockups.append({**x, "lockup": ds(lu), "vsIpo": r((lp / x["price"] - 1) * 100, 1) if lp and x["price"] else None})
    lockups.sort(key=lambda x: x["lockup"])
    vs = Counter(x["vs"] for x in ytd if x["vs"])
    write("ipo_cache.json", {"ranges": ranges, "first": first})
    write("ipo.json", {
        "updated": now_iso(), "year": d0.year,
        "score": {"n": len(ytd), "proceeds": r(sum(x["proceeds"] or 0 for x in ytd), 0),
                  "avgD1": r(statistics.mean(d1s), 1) if d1s else None, "medD1": r(statistics.median(d1s), 1) if d1s else None,
                  "above": r(sum(1 for x in since if x["since"] > 0) / len(since) * 100, 0) if since else None,
                  "medSize": r(statistics.median([x["proceeds"] for x in ytd if x["proceeds"]]), 0) if ytd else None,
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
MAJOR = ("consumer price", "employment situation", "gross domestic", "personal income", "retail", "industrial production",
         "producer price", "job openings", "unemployment insurance", "new residential construction", "fomc", "existing home",
         "durable goods", "university of michigan")


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
    cal = [c for c in cal if any(k in (c["name"] or "").lower() for k in MAJOR)]
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
            and not any(w in h["title"].lower() for w in spam)]
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
    write("digest.json", {"updated": now_iso(), "date": day, "top": top, "futures": futures, "macro": macro_rows, "world": world,
                          "levels": levels, "calToday": cal_today, "calWeek": cal_week[:14], "latest": macro_.get("latest", [])[:8],
                          "reportingToday": [trim(e) for e in ups[:14]], "reported": [trim(e) for e in rec[:10]], "news": news, "watch": watch,
                          "breadth": dash.get("breadth"), "odds": od.get("groups", [])})
