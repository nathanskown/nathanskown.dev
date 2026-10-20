"""Stock screener data: one-year price history (Yahoo spark, 20 symbols per call) and company fundamentals
from the SEC's XBRL "frames" API, which returns one concept for every filer in a single call
(about 40 calls cover the whole market instead of thousands of per-company requests)."""
from datetime import date

from .net import get, r
from .src_market import YAHOO

FRAMES = "https://data.sec.gov/api/xbrl/frames"

# (key, taxonomy, tags in priority order, unit, kind)  kind: "d" = duration over a period, "i" = instant at a date
CONCEPTS = [
    ("rev", "us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax",
                        "SalesRevenueGoodsNet", "RevenuesNetOfInterestExpense"], "USD", "d"),
    ("ni", "us-gaap", ["NetIncomeLoss", "ProfitLoss"], "USD", "d"),
    ("eps", "us-gaap", ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"], "USD-per-shares", "d"),
    ("gp", "us-gaap", ["GrossProfit"], "USD", "d"),
    ("op", "us-gaap", ["OperatingIncomeLoss"], "USD", "d"),
    ("ocf", "us-gaap", ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"], "USD", "d"),
    ("capex", "us-gaap", ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"], "USD", "d"),
    ("dps", "us-gaap", ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"], "USD-per-shares", "d"),
    ("assets", "us-gaap", ["Assets"], "USD", "i"),
    ("liab", "us-gaap", ["Liabilities"], "USD", "i"),
    ("equity", "us-gaap", ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], "USD", "i"),
    ("cash", "us-gaap", ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], "USD", "i"),
    ("shares", "dei", ["EntityCommonStockSharesOutstanding"], "shares", "i"),
]


def frame(tax, tag, unit, period):
    """{cik: value} for one concept and period, or {} when the SEC has no such frame."""
    try:
        j = get(f"{FRAMES}/{tax}/{tag}/{unit}/{period}.json", timeout=60)
    except RuntimeError as e:
        if "HTTP 404" in str(e):
            return {}
        raise
    return {int(x["cik"]): x["val"] for x in (j.get("data") or []) if x.get("val") is not None}


def merged(tax, tags, unit, period):
    out = {}
    for tag in tags:
        for cik, v in frame(tax, tag, unit, period).items():
            out.setdefault(cik, v)
    return out


def quarter_ids(today, n=5):
    """Newest-first calendar quarters that have fully ended: [(year, q), ...]."""
    y, q = today.year, (today.month - 1) // 3  # q = quarters completed this year
    out = []
    while len(out) < n:
        if q == 0:
            y, q = y - 1, 4
        out.append((y, q))
        q -= 1
    return out


def fundamentals(today, failures):
    """Per-CIK dict of the latest annual, quarterly and balance-sheet facts. failures collects frames that errored."""
    qs = quarter_ids(today)
    fy = today.year - 1
    data = {}

    def fetch(label, tax, tags, unit, period):
        try:
            return merged(tax, tags, unit, period)
        except Exception as e:  # noqa: BLE001
            failures.append(f"{label} {period}: {str(e)[:80]}")
            return {}

    for key, tax, tags, unit, kind in CONCEPTS:
        if kind == "d":
            a = fetch(key, tax, tags, unit, f"CY{fy}")
            a0 = fetch(key, tax, tags, unit, f"CY{fy - 1}") if key in ("rev", "ni", "eps") else {}
            # latest quarter with decent coverage versus the one before it, then the same quarter a year earlier
            q_new, q_old, qlabel = {}, {}, None
            if key in ("rev", "ni"):
                got = [(qq, fetch(key, tax, tags, unit, f"CY{qq[0]}Q{qq[1]}")) for qq in qs[:2]]
                best = got[0] if len(got[0][1]) >= 0.5 * max(len(got[1][1]), 1) else got[1]
                qlabel = f"{best[0][0]}Q{best[0][1]}"
                q_new = best[1]
                q_old = fetch(key, tax, tags, unit, f"CY{best[0][0] - 1}Q{best[0][1]}")
            data[key] = {"a": a, "a0": a0, "q": q_new, "q0": q_old, "ql": qlabel}
        else:
            vals, used = {}, {}
            for (yy, qq) in qs:  # newest first, older fills the gaps
                for cik, v in fetch(key, tax, tags, unit, f"CY{yy}Q{qq}I").items():
                    if cik not in vals:
                        vals[cik] = v
                        used[cik] = f"{yy}Q{qq}"
            data[key] = {"v": vals, "when": used}
    return data


def spark_year(symbols):
    """{sym: (closes[], timestamps[])} with one year of daily closes; 20 symbols per Yahoo call."""
    out, fails = {}, 0
    for i in range(0, len(symbols), 20):
        chunk = symbols[i:i + 20]
        j = None
        for base in YAHOO:
            try:
                j = get(f"{base}/v8/finance/spark", params={"symbols": ",".join(chunk), "range": "1y", "interval": "1d"}, timeout=40)
                break
            except Exception:
                j = None
        if not j:
            fails += 1
            continue
        items = []
        if isinstance(j, dict) and "spark" in j:
            for res in (j["spark"].get("result") or []):
                resp = (res.get("response") or [{}])[0]
                closes = ((resp.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
                items.append((res.get("symbol"), closes, resp.get("timestamp") or []))
        elif isinstance(j, dict):
            for sym, d in j.items():
                if isinstance(d, dict):
                    items.append((d.get("symbol") or sym, d.get("close") or [], d.get("timestamp") or []))
        for sym, closes, ts in items:
            pairs = [(c, t) for c, t in zip(closes, ts or [None] * len(closes)) if c]
            if len(pairs) >= 22:
                out[sym] = ([p[0] for p in pairs], [p[1] for p in pairs])
    if not out:
        raise RuntimeError("spark returned no one-year history")
    return out, fails


def price_features(closes, stamps):
    c = closes
    px = c[-1]
    pc = lambda k: r((px / c[-1 - k] - 1) * 100, 2) if len(c) > k and c[-1 - k] else None  # noqa: E731
    ma = lambda n: sum(c[-n:]) / n if len(c) >= n else None  # noqa: E731
    ytd = None
    if stamps and stamps[-1]:
        yr = date.fromtimestamp(stamps[-1]).year
        prior = [cc for cc, t in zip(c, stamps) if t and date.fromtimestamp(t).year < yr]
        ytd = r((px / prior[-1] - 1) * 100, 2) if prior else None  # needs last year's final close in the one-year window
    gains = [max(c[k] - c[k - 1], 0) for k in range(len(c) - 14, len(c))]
    losses = [max(c[k - 1] - c[k], 0) for k in range(len(c) - 14, len(c))]
    ag, al = sum(gains) / 14, sum(losses) / 14
    rsi = 100.0 if al == 0 and ag > 0 else (r(100 - 100 / (1 + ag / al), 1) if al else None)
    return {"px": r(px, 2), "d1": pc(1), "m1": pc(21), "m3": pc(63), "m6": pc(126), "y1": pc(len(c) - 1) if len(c) >= 240 else None, "ytd": ytd,
            "offHi": r((px / max(c) - 1) * 100, 2), "aboveLo": r((px / min(c) - 1) * 100, 2),
            "v50": r((px / ma(50) - 1) * 100, 2) if ma(50) else None, "v200": r((px / ma(200) - 1) * 100, 2) if ma(200) else None, "rsi": rsi}
