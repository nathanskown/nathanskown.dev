import json, re, sys
sys.path.insert(0, ".")
import requests
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"}
dates = ["20251210", "20260128", "20260318", "20260429", "20260617", "20260729", "20260916", "20261028"]
for d in dates:
    u = f"https://www.federalreserve.gov/newsevents/pressreleases/monetary{d}a.htm"
    try:
        r = requests.get(u, headers=H, timeout=30)
        print("STATUS", d, r.status_code, len(r.text))
        open(f"/tmp/fed_{d}.html", "w").write(r.text)
    except Exception as e:
        print("ERR", d, e)
for s in ["^GSPC", "^TNX", "DX-Y.NYB", "2YY=F", "^FVX", "ZT=F"]:
    for iv, rg in (("5m", "60d"), ("1m", "7d")):
        try:
            r = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{s}", params={"range": rg, "interval": iv}, headers=H, timeout=30)
            j = r.json()["chart"]["result"][0]
            ts = j["timestamp"]; c = j["indicators"]["quote"][0]["close"]
            print("YAHOO", s, iv, rg, r.status_code, len(ts), ts[0], ts[-1], [x for x in c if x][:2], j["meta"].get("exchangeTimezoneName"), j["meta"].get("regularMarketPrice"))
        except Exception as e:
            print("YAHOO ERR", s, iv, rg, str(e)[:120])
