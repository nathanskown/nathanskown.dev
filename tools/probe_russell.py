"""Try every candidate source for Russell 1000/2000 membership and print what each one returns (run from Actions)."""
import csv, datetime, io, json, re, sys
import requests

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})


def show(name, r):
    ct = r.headers.get("content-type", "")
    body = r.text if hasattr(r, "text") else ""
    print(f"[{name}] HTTP {r.status_code} type={ct[:40]} bytes={len(r.content)} start={body[:100]!r}")
    return body


def ishares_rows(text):
    lines = [ln.lstrip("﻿") for ln in text.splitlines()]
    i = next((k for k, ln in enumerate(lines) if re.match(r'^\s*"?Ticker"?\s*,', ln)), None)
    if i is None:
        return None
    return [r for r in csv.DictReader(lines[i:]) if (r.get("Asset Class") or "").strip() == "Equity"]


def try_(name, fn):
    try:
        fn()
    except Exception as e:
        print(f"[{name}] ERROR {type(e).__name__}: {str(e)[:160]}")


def ishares(fund, pid, slug, file):
    base = f"https://www.ishares.com/us/products/{pid}/{slug}"
    ajax = f"{base}/1467271812596.ajax?fileType=csv&fileName={file}_holdings&dataType=fund"
    def plain():
        r = S.get(ajax, headers={"Referer": base, "X-Requested-With": "XMLHttpRequest"}, timeout=40)
        rows = ishares_rows(show(f"{fund} ishares plain", r)); print("   rows:", None if rows is None else len(rows))
    def cookie():
        s2 = requests.Session(); s2.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
        r0 = s2.get(base, timeout=40); print(f"[{fund} ishares product page] HTTP {r0.status_code} cookies={list(s2.cookies.keys())[:6]}")
        r = s2.get(ajax, headers={"Referer": base}, timeout=40)
        rows = ishares_rows(show(f"{fund} ishares with cookies", r)); print("   rows:", None if rows is None else len(rows))
    def dated():
        d = datetime.date.today() - datetime.timedelta(days=3)
        while d.weekday() > 4: d -= datetime.timedelta(days=1)
        r = S.get(ajax + "&asOfDate=" + d.strftime("%Y%m%d"), headers={"Referer": base}, timeout=40)
        rows = ishares_rows(show(f"{fund} ishares asOfDate", r)); print("   rows:", None if rows is None else len(rows))
    def js():
        r = S.get(f"{base}/1467271812596.ajax?tab=all&fileType=json", headers={"Referer": base}, timeout=40)
        show(f"{fund} ishares json", r)
    for n, f in [("plain", plain), ("cookie", cookie), ("dated", dated), ("json", js)]:
        try_(f"{fund} ishares {n}", f)


def vanguard(fund, ticker):
    for qs in ["", "?start=1&count=5000", ".json?start=1&count=5000"]:
        def f(qs=qs):
            u = f"https://investor.vanguard.com/investment-products/etfs/profile/api/{ticker}/portfolio-holding/stock{qs}"
            r = S.get(u, headers={"Referer": f"https://investor.vanguard.com/investment-products/etfs/profile/{ticker.lower()}", "Accept": "application/json"}, timeout=40)
            body = show(f"{fund} vanguard {ticker}{qs}", r)
            try:
                j = r.json(); ent = (j.get("fund") or {}).get("entity") or []
                print("   size:", j.get("size"), "entities:", len(ent), "sample:", [e.get("ticker") for e in ent[:5]])
            except Exception as e:
                print("   not json:", str(e)[:80])
        try_(f"{fund} vanguard{qs}", f)


ishares("r1000", 239707, "ishares-russell-1000-etf", "IWB")
ishares("r2000", 239710, "ishares-russell-2000-etf", "IWM")
vanguard("r1000", "VONE")
vanguard("r2000", "VTWO")
