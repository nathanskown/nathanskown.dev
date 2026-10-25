"""Kalshi NFL player-prop markets (public market data, no key): the over/under price ladder for receiving yards,
rushing yards, passing yards and receptions, compared with the NFL board's own projected chance at each threshold.

Each market asks "will the player reach N+?" (floor_strike = N - 0.5). Its price is a probability: we use the midpoint of
the best bid and ask, and keep the bid-ask spread so thin markets can be ignored. Prices are snapshotted every run until
kickoff and frozen after, then graded from Kalshi's own settlement. A disagreement of EDGE or more between the board's
chance and the market's, on a market whose spread is at most MAX_SPREAD, is logged as a "flag" and scored as if bought
at the ask (a $1 contract pays 1 - ask on a win and loses the ask otherwise), so the record is what it would really have
earned. Internal files: data/sports/track/_kalshi_nfl.json (log), the board file carries the current ladder matches."""
from datetime import datetime, timedelta, timezone

from .common import get, now_iso, read, write

BASE = "https://api.elections.kalshi.com/trade-api/v2"
SERIES = {"KXNFLRECYDS": "rec_yds", "KXNFLREC": "receptions", "KXNFLRSHYDS": "rush_yds", "KXNFLPASSYDS": "pass_yds"}
EDGE, MAX_SPREAD = 0.10, 0.12


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _markets(series, status, min_close=None):
    out, cursor = [], None
    for _ in range(30):
        params = {"series_ticker": series, "status": status, "limit": "1000"}
        if cursor:
            params["cursor"] = cursor
        if min_close:
            params["min_close_ts"] = str(min_close)
        d = get(BASE + "/markets", params, timeout=60)
        out += d.get("markets") or []
        cursor = d.get("cursor")
        if not cursor:
            break
    return out


def _row(m, mk):
    name = (m.get("yes_sub_title") or m.get("title") or "").split(":")[0].strip()
    bid, ask = _f(m.get("yes_bid_dollars")), _f(m.get("yes_ask_dollars"))
    mid = (bid + ask) / 2 if bid is not None and ask is not None and ask > 0 else None
    return {"t": m.get("ticker"), "mk": mk, "name": name, "strike": _f(m.get("floor_strike")), "bid": bid, "ask": ask,
            "noAsk": _f(m.get("no_ask_dollars")), "mid": mid, "kick": (m.get("occurrence_datetime") or "")[:16], "result": m.get("result") or ""}


def fetch():
    """(pre-game ladders by (normalized name, market), settled results by ticker)."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")
    since = int((datetime.now(timezone.utc) - timedelta(days=12)).timestamp())
    ladders, settled, errors = {}, {}, []
    for series, mk in SERIES.items():
        try:
            for m in _markets(series, "open"):
                r = _row(m, mk)
                if r["kick"] and r["kick"] > now and r["strike"] is not None:
                    ladders.setdefault((_norm(r["name"]), mk), []).append(r)
            for m in _markets(series, "settled", since):
                settled[m.get("ticker")] = m.get("result") or ""
        except Exception as e:
            errors.append(f"{series}: {str(e)[:100]}")
    for v in ladders.values():
        v.sort(key=lambda r: r["strike"])
    return ladders, settled, errors


def _norm(s):
    import re
    return re.sub(r"[^a-z]", "", (s or "").lower().replace(" jr", "").replace(" iii", "").replace(" ii", ""))


def attach(rows, tables, week, season):
    """Add each board row's Kalshi ladder match (the threshold nearest the board's median), log flags, grade old ones.
    Returns (edges list for the board, summary of the graded record)."""
    try:
        ladders, settled, errors = fetch()
    except Exception as e:
        return [], {"error": str(e)[:160]}
    store = read("track/_kalshi_nfl.json") or {}
    if store.get("season") != season:
        store = {"season": season, "log": {}}
    log = store["log"]
    edges = []
    for r in rows:
        lad = ladders.get((_norm(r["player"]), r["market"]))
        if not lad or r["market"] not in tables:
            continue
        qs = tables[r["market"]]["ratio"][r["band"]]
        best = None
        for k in lad:
            if k["mid"] is None:
                continue
            ours = sum(1 for q in qs if r["mean"] * q > k["strike"]) / len(qs)
            spread = (k["ask"] - k["bid"]) if k["ask"] is not None and k["bid"] is not None else 1.0
            e = {"player": r["player"], "team": r["team"], "opp": r["opp"], "market": r["market"], "line": k["strike"] + 0.5,
                 "kalshi": round(k["mid"], 3), "ours": round(ours, 3), "edge": round(ours - k["mid"], 3), "spread": round(spread, 3),
                 "ask": k["ask"], "noAsk": k["noAsk"], "ticker": k["t"], "kick": k["kick"]}
            entry = log.get(k["t"], {})
            if "result" not in entry:                  # the last pre-game snapshot wins
                log[k["t"]] = {k2: e[k2] for k2 in ("player", "market", "line", "kalshi", "ours", "edge", "spread", "ask", "noAsk", "kick")} | {"wk": week}
            if best is None or abs(k["strike"] + 0.5 - r["median"]) < abs(best["line"] - r["median"]):
                best = e
            if abs(e["edge"]) >= EDGE and spread <= MAX_SPREAD:
                edges.append(e)
        if best:
            r["kalshi"] = {"line": best["line"], "p": best["kalshi"], "ours": best["ours"], "spread": best["spread"]}
    for t, res in settled.items():
        if t in log and "result" not in log[t] and res in ("yes", "no"):
            log[t]["result"] = res
    write("track/_kalshi_nfl.json", store)
    # the record: every pre-game flag that settled
    n = w = 0; profit = 0.0; brier_o = brier_k = 0.0; nb = 0
    for e in log.values():
        if e.get("result") not in ("yes", "no"):
            continue
        y = 1.0 if e["result"] == "yes" else 0.0
        brier_o += (e["ours"] - y) ** 2; brier_k += (e["kalshi"] - y) ** 2; nb += 1
        if abs(e["edge"]) >= EDGE and e["spread"] <= MAX_SPREAD:
            over = e["edge"] > 0
            price = e["ask"] if over else e["noAsk"]
            if price is None or price <= 0 or price >= 1:
                continue
            won = (y == 1.0) == over
            n += 1; w += won; profit += (1 - price) if won else -price
    summ = {"flags": n, "won": w, "profit": round(profit, 2), "roi": round(profit / n, 3) if n else None,
            "graded": nb, "brierOurs": round(brier_o / nb, 4) if nb else None, "brierKalshi": round(brier_k / nb, 4) if nb else None,
            "errors": errors[:3], "updated": now_iso()}
    edges.sort(key=lambda e: -abs(e["edge"]))
    return edges[:40], summ
