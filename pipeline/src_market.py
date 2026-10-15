"""Prices (Yahoo Finance chart API), Treasury yields (treasury.gov), index lists (Wikipedia)."""
import csv
import io
import re
from datetime import datetime, timezone
from html.parser import HTMLParser

from .net import get, r

YAHOO = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]


def chart(symbol, rng="1d", interval="5m", events=None):
    """One Yahoo chart call -> {meta, t[], c[], v[], div{}}."""
    params = {"range": rng, "interval": interval, "includePrePost": "false"}
    if events:
        params["events"] = events
    last = None
    for base in YAHOO:
        try:
            j = get(f"{base}/v8/finance/chart/{symbol}", params=params)
            res = (j.get("chart") or {}).get("result") or []
            if not res:
                raise RuntimeError(f"no chart result for {symbol}: {str(j)[:160]}")
            res = res[0]
            q = (res.get("indicators") or {}).get("quote") or [{}]
            t, c, v = [], [], []
            for ts, close, vol in zip(res.get("timestamp") or [], q[0].get("close") or [], q[0].get("volume") or [None] * 10**6):
                if close is None:
                    continue
                t.append(ts)
                c.append(close)
                v.append(vol or 0)
            div = {}
            for d in ((res.get("events") or {}).get("dividends") or {}).values():
                div[d["date"]] = d["amount"]
            return {"meta": res.get("meta") or {}, "t": t, "c": c, "v": v, "div": div}
        except Exception as e:  # try the second host before giving up
            last = e
    raise last


def quote_from_chart(ch):
    m = ch["meta"]
    price = m.get("regularMarketPrice") or (ch["c"][-1] if ch["c"] else None)
    prev = m.get("chartPreviousClose") or m.get("previousClose")
    chg = (price - prev) if (price is not None and prev) else None
    return {"price": r(price, 4), "prev": r(prev, 4), "chg": r(chg, 4),
            "pct": r(chg / prev * 100, 3) if chg is not None and prev else None,
            "time": m.get("regularMarketTime"), "currency": m.get("currency"),
            "hi52": r(m.get("fiftyTwoWeekHigh"), 4), "lo52": r(m.get("fiftyTwoWeekLow"), 4),
            "name": m.get("longName") or m.get("shortName"), "exch": m.get("fullExchangeName") or m.get("exchangeName")}


def spark(symbols):
    """Batch daily change for many symbols (S&P 500 movers): Yahoo spark endpoint, 20 per call."""
    out = {}
    for i in range(0, len(symbols), 20):
        chunk = symbols[i:i + 20]
        j = None
        for base in YAHOO:
            try:
                j = get(f"{base}/v8/finance/spark", params={"symbols": ",".join(chunk), "range": "1d", "interval": "1d"})
                break
            except Exception:
                j = None
        if not j:
            continue
        items = []
        if isinstance(j, dict) and "spark" in j:  # older shape
            for res in (j["spark"].get("result") or []):
                resp = (res.get("response") or [{}])[0]
                meta = resp.get("meta") or {}
                closes = ((resp.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
                items.append((res.get("symbol"), meta.get("regularMarketPrice") or (closes[-1] if closes else None),
                              meta.get("chartPreviousClose") or meta.get("previousClose")))
        elif isinstance(j, dict):  # newer shape: {SYM: {close: [...], chartPreviousClose: x}}
            for sym, d in j.items():
                if not isinstance(d, dict):
                    continue
                closes = [x for x in (d.get("close") or []) if x is not None]
                items.append((d.get("symbol") or sym, closes[-1] if closes else None, d.get("chartPreviousClose") or d.get("previousClose")))
        for sym, px, prev in items:
            if sym and px and prev:
                out[sym] = {"price": r(px, 4), "prev": r(prev, 4), "pct": r((px - prev) / prev * 100, 3)}
    if not out:
        raise RuntimeError("spark returned no prices")
    return out


def treasury_curve():
    """Daily par yield curve from treasury.gov: latest row and the row ~1 month earlier."""
    year = datetime.now(timezone.utc).year
    rows = []
    for y in (year - 1, year):
        url = (f"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{y}/all"
               f"?type=daily_treasury_yield_curve&field_tdr_date_value={y}&page&_format=csv")
        text = get(url, kind="text")
        rows += list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
    if not rows:
        raise RuntimeError("no treasury rows")

    def d(row):
        return datetime.strptime(row["Date"], "%m/%d/%Y")
    rows.sort(key=d)
    latest = rows[-1]
    target = d(latest).toordinal() - 30
    month_ago = min(rows, key=lambda row: abs(d(row).toordinal() - target))
    prev_day = rows[-2] if len(rows) > 1 else latest
    tenors = [("3M", "3 Mo"), ("2Y", "2 Yr"), ("5Y", "5 Yr"), ("10Y", "10 Yr"), ("30Y", "30 Yr")]

    def pick(row):
        return [r(row.get(col) or None, 3) for _, col in tenors]
    return {"date": d(latest).strftime("%Y-%m-%d"), "monthAgoDate": d(month_ago).strftime("%Y-%m-%d"),
            "tenors": [t for t, _ in tenors], "now": pick(latest), "prevDay": pick(prev_day), "monthAgo": pick(month_ago)}


class _Tables(HTMLParser):
    """Collect every <table> on a page as rows of cell text."""

    def __init__(self):
        super().__init__()
        self.tables, self._t, self._row, self._cell = [], None, None, None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._t = []
        elif tag == "tr" and self._t is not None:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(re.sub(r"\s+", " ", "".join(self._cell)).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None and self._t is not None:
            if self._row:
                self._t.append(self._row)
            self._row = None
        elif tag == "table" and self._t is not None:
            self.tables.append(self._t)
            self._t = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def index_members(page):
    """Wikipedia constituents table -> [{sym, name, sector}] (sym in Yahoo form)."""
    html = get(f"https://en.wikipedia.org/wiki/{page}", kind="text")
    p = _Tables()
    p.feed(html)
    for t in p.tables:
        head = [h.lower() for h in t[0]]
        si = next((i for i, h in enumerate(head) if h in ("symbol", "ticker symbol", "ticker")), None)
        sec = next((i for i, h in enumerate(head) if "gics sector" in h), None)
        name = next((i for i, h in enumerate(head) if h in ("security", "company")), None)
        if si is None or sec is None or len(t) < 100:
            continue
        out = []
        for row in t[1:]:
            if len(row) <= max(si, sec):
                continue
            sym = row[si].strip().replace(".", "-")
            if sym:
                out.append({"sym": sym, "name": row[name] if name is not None else sym, "sector": row[sec]})
        return out
    raise RuntimeError(f"no constituents table on {page}")


ISHARES = {
    "r1000": "https://www.ishares.com/us/products/239707/ishares-russell-1000-etf/1467271812596.ajax?fileType=csv&fileName=IWB_holdings&dataType=fund",
    "r2000": "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/1467271812596.ajax?fileType=csv&fileName=IWM_holdings&dataType=fund",
}
# iShares writes share classes without the dot (BRKB); Yahoo and the SEC list use BRK-B
ISHARES_FIX = {"BRKB": "BRK-B", "BFB": "BF-B", "BFA": "BF-A", "LENB": "LEN-B", "HEIA": "HEI-A", "MOGA": "MOG-A",
               "UHALB": "UHAL-B", "CWENA": "CWEN-A", "GEFB": "GEF-B", "CRDA": "CRD-A", "LGFA": "LGF-A", "LGFB": "LGF-B"}


def russell_members(key):
    """Russell 1000 / 2000 constituents from the iShares IWB / IWM daily holdings file -> [ticker]."""
    import csv as _csv
    text = get(ISHARES[key], kind="text", timeout=40).lstrip("\ufeff")
    lines = [ln.lstrip("\ufeff") for ln in text.splitlines()]
    start = next((i for i, ln in enumerate(lines) if re.match(r'^\s*"?Ticker"?\s*,', ln)), None)
    if start is None:
        raise RuntimeError(f"no holdings table in iShares {key} file; starts {text[:160]!r}")
    out = []
    for row in _csv.DictReader(lines[start:]):
        t = (row.get("Ticker") or "").strip().upper()
        if not t or t == "-" or (row.get("Asset Class") or "").strip() != "Equity":
            continue
        out.append(ISHARES_FIX.get(t, t.replace(".", "-")))
    if len(out) < (800 if key == "r1000" else 1500):
        raise RuntimeError(f"iShares {key} list looks short: {len(out)}")
    return sorted(set(out))
