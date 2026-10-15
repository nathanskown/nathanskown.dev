"""HTTP + file helpers shared by every data source.

Every fetch goes through get(): browser-like or SEC-compliant headers,
per-host pacing, retries with backoff. Every source reports into STATUS,
which run.py writes to data/finance/status.json so failures are visible
from the repo without opening GitHub Actions logs.
"""
import json
import pathlib
import threading
import time
import traceback
from datetime import datetime, timezone

import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "finance"
CONFIG = json.loads((DATA / "config.json").read_text())

BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/129.0 Safari/537.36")
# SEC asks automated clients to identify themselves with a contact address.
SEC_UA = "nathanskown.dev finance data bot skownclaude@agentmail.to"

# minimum seconds between requests to the same host (SEC allows 10/s; stay well under)
PACE = {"sec.gov": 0.15, "data.sec.gov": 0.15, "api.nasdaq.com": 0.4, "query1.finance.yahoo.com": 0.15,
        "query2.finance.yahoo.com": 0.15, "api.stlouisfed.org": 0.1, "fred.stlouisfed.org": 0.2}
_last = {}
_LOCK = threading.Lock()
_dead = {}  # host -> consecutive failed calls; after BREAK the host fails fast for the rest of the run
BREAK = 3
SESSION = requests.Session()

STATUS = {}


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _host(url):
    return url.split("/")[2]


def headers_for(url):
    host = _host(url)
    if host.endswith("sec.gov"):
        return {"User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate"}
    if host == "api.nasdaq.com":
        return {"User-Agent": BROWSER_UA, "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9", "Origin": "https://www.nasdaq.com",
                "Referer": "https://www.nasdaq.com/"}
    if host.endswith("ishares.com"):  # the holdings download serves an HTML page to requests that don't look like the site's own button
        return {"User-Agent": BROWSER_UA, "Accept": "text/csv,application/octet-stream,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9",
                "Referer": "https://www.ishares.com/us/products/239707/ishares-russell-1000-etf", "X-Requested-With": "XMLHttpRequest"}
    return {"User-Agent": BROWSER_UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9"}


def get(url, params=None, kind="json", tries=3, timeout=20, stream=False):
    host = _host(url)
    if _dead.get(host, 0) >= BREAK:
        raise RuntimeError(f"{host} skipped: {BREAK} straight failures this run")
    for key, gap in PACE.items():
        if host.endswith(key):
            with _LOCK:  # threads share the per-host pace
                wait = _last.get(key, 0) + gap - time.time()
                _last[key] = time.time() + max(wait, 0)
            if wait > 0:
                time.sleep(wait)
            break
    err = None
    for attempt in range(tries):
        try:
            r = SESSION.get(url, params=params, headers=headers_for(url), timeout=timeout, stream=stream)
            if r.status_code == 429 or r.status_code >= 500:
                err = f"HTTP {r.status_code}"
                time.sleep(2 * (attempt + 1) ** 2)
                continue
            if r.status_code != 200:
                if r.status_code in (401, 403):  # blocked, not just a missing document
                    _dead[host] = _dead.get(host, 0) + 1
                raise RuntimeError(f"HTTP {r.status_code} for {url[:120]}")
            out = r if stream else (r.json() if kind == "json" else (r.content if kind == "bytes" else r.text))
            _dead[host] = 0
            return out
        except (requests.RequestException, ValueError) as e:
            err = f"{type(e).__name__}: {str(e)[:160]}"
            time.sleep(1.5 * (attempt + 1))
    _dead[host] = _dead.get(host, 0) + 1
    raise RuntimeError(err or f"failed {url[:120]}")


def record(name, ok, n=None, error=None, note=None):
    STATUS[name] = {k: v for k, v in {"ok": ok, "n": n, "error": error, "note": note, "at": now_iso()}.items() if v is not None}


def attempt(name, fn, *args, default=None, **kw):
    """Run one source; record success/failure instead of crashing the job."""
    try:
        out = fn(*args, **kw)
        n = len(out) if hasattr(out, "__len__") else None
        record(name, True, n=n)
        return out
    except Exception as e:  # noqa: BLE001 — every source failure is reported, never fatal
        record(name, False, error=f"{type(e).__name__}: {str(e)[:300]}")
        print(f"[{name}] FAILED\n{traceback.format_exc()[-1500:]}")
        return default


def r(x, d=2):
    """Round floats for compact JSON."""
    if x is None:
        return None
    try:
        return round(float(x), d)
    except (TypeError, ValueError):
        return None


def write(name, obj):
    path = DATA / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False))


def read(name, default=None):
    path = DATA / name
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def num(s):
    """'$1,234.5' / '(0.12)' / '12%' / 'N/A' -> float or None."""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    t = str(s).strip().replace("$", "").replace(",", "").replace("%", "")
    neg = t.startswith("(") and t.endswith(")")
    t = t.strip("()")
    try:
        v = float(t)
    except ValueError:
        return None
    return -v if neg else v


def post_json(url, payload, headers=None, timeout=30, tries=3):
    """POST JSON, return parsed JSON (used for OpenFIGI's mapping API)."""
    err = None
    for attempt in range(tries):
        try:
            res = SESSION.post(url, json=payload, headers={"Content-Type": "application/json", **(headers or {})}, timeout=timeout)
            if res.status_code == 429:
                err = "HTTP 429"
                time.sleep(int(res.headers.get("ratelimit-reset", "0") or 0) + 6 * (attempt + 1))
                continue
            if res.status_code != 200:
                raise RuntimeError(f"HTTP {res.status_code} for {url}: {res.text[:120]}")
            return res.json()
        except requests.RequestException as e:
            err = f"{type(e).__name__}: {str(e)[:160]}"
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(err or f"failed {url}")
