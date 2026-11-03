"""HTTP + file helpers for the sports pipeline (kept separate from the finance helpers so the two
workflows never share state). Every fetch is paced per host and retried; every source reports into
STATUS, which run.py writes to data/sports/status.json."""
import json
import pathlib
import time
import traceback
from datetime import datetime, timezone

import requests

ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "sports"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
PACE = {"site.api.espn.com": 0.12, "sports.core.api.espn.com": 0.06, "api-web.nhle.com": 0.2, "statsapi.mlb.com": 0.15,
        "raw.githubusercontent.com": 0.2, "api.collegefootballdata.com": 0.3}
_last = {}
SESSION = requests.Session()
STATUS = {}
ESPN = "https://site.api.espn.com/apis/site/v2/sports/"
ESPN_V2 = "https://site.api.espn.com/apis/v2/sports/"


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def get(url, params=None, kind="json", tries=3, timeout=30, headers=None):
    host = url.split("/")[2]
    gap = PACE.get(host, 0.2)
    wait = _last.get(host, 0) + gap - time.time()
    if wait > 0:
        time.sleep(wait)
    _last[host] = time.time()
    err = None
    for attempt in range(tries):
        try:
            r = SESSION.get(url, params=params, headers={"User-Agent": UA, "Accept": "*/*", **(headers or {})}, timeout=timeout)
            if r.status_code == 429 or r.status_code >= 500:
                err = f"HTTP {r.status_code}"
                time.sleep(2 * (attempt + 1) ** 2)
                continue
            if r.status_code != 200:
                raise RuntimeError(f"HTTP {r.status_code} for {url[:140]}")
            return r.json() if kind == "json" else r.text
        except (requests.RequestException, ValueError) as e:
            err = str(e)
            time.sleep(1 + attempt)
    raise RuntimeError(f"failed after {tries} tries: {err} ({url[:140]})")


def write(rel, obj):
    p = DATA / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(obj, separators=(",", ":"), ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o))
    # same content in a different key order is not a change: leave the file alone so git sees nothing to commit
    try:
        if p.exists() and json.loads(p.read_text()) == json.loads(txt):
            return p
    except ValueError:
        pass
    p.write_text(txt)
    return p


def read(rel, default=None):
    p = DATA / rel
    try:
        return json.loads(p.read_text())
    except Exception:
        return default


def attempt(name, fn, *a, **kw):
    """Run one source; record success or the error, never raise."""
    t0 = time.time()
    try:
        out = fn(*a, **kw)
        STATUS[name] = {"ok": True, "seconds": round(time.time() - t0, 1)}
        return out
    except Exception as e:
        STATUS[name] = dict(getattr(e, "status", None) or {}, ok=False, error=str(e)[:300], seconds=round(time.time() - t0, 1))
        print("ERROR", name, e)
        traceback.print_exc()
        return None
