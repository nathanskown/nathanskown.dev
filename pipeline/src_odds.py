"""Prediction-market odds from Kalshi's public market-data API (no key needed)."""
from .net import get, r

BASE = "https://api.elections.kalshi.com/trade-api/v2"

# series -> (group id, title, link to the market on kalshi.com)
SERIES = [
    ("KXFED", "fed", "Fed rate decision", "https://kalshi.com/markets/kxfed"),
    ("KXCPI", "cpi", "Next CPI report", "https://kalshi.com/markets/kxcpi"),
    ("KXRECSSNBER", "recession", "US recession this year", "https://kalshi.com/markets/kxrecssnber"),
]


def _cents(m, base):
    """Kalshi quotes either integer cents (last_price) or dollar strings (last_price_dollars); return cents or None."""
    for key in (base, base + "_dollars"):
        v = m.get(key)
        if v in (None, "", 0, "0", "0.0000"):
            continue
        try:
            x = float(v)
        except (TypeError, ValueError):
            continue
        return x * 100 if key.endswith("_dollars") else x
    return None


def market_pct(m):
    """Best estimate of the chance the market resolves yes: midpoint of bid/ask, else last trade."""
    bid, ask = _cents(m, "yes_bid"), _cents(m, "yes_ask")
    if bid is not None and ask is not None and ask >= bid:
        return r((bid + ask) / 2, 1)
    last = _cents(m, "last_price")
    return r(last, 1) if last is not None else None


def fetch_group(series, gid, title, link):
    j = get(f"{BASE}/events", params={"series_ticker": series, "status": "open", "with_nested_markets": "true", "limit": 20})
    events = [e for e in (j.get("events") or []) if e.get("markets")]
    if not events:
        raise RuntimeError(f"no open events for {series}")

    def close(e):
        return min((m.get("close_time") or m.get("expiration_time") or "9") for m in e["markets"])
    events.sort(key=close)
    ev = events[0]
    rows = []
    for m in ev["markets"]:
        p = market_pct(m)
        if p is None:
            continue
        label = m.get("yes_sub_title") or m.get("subtitle") or m.get("title") or m.get("ticker")
        rows.append({"id": m.get("ticker"), "label": str(label)[:80], "pct": p, "vol": m.get("volume") or m.get("volume_fp"),
                     "closes": m.get("close_time")})
    if not rows:
        raise RuntimeError(f"no priced markets for {series}")
    return {"id": gid, "title": title, "event": ev.get("title"), "link": link, "markets": rows}


def all_groups():
    from .net import attempt
    out = []
    for series, gid, title, link in SERIES:
        g = attempt(f"kalshi {series}", fetch_group, series, gid, title, link)
        if g:
            out.append(g)
    if not out:
        raise RuntimeError("no Kalshi groups")
    return out
