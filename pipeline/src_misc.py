"""Nasdaq earnings + IPO calendars, FRED economic data, RSS/Atom headlines."""
import csv
import html
import io
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

from .net import get, num

# ---------------- Nasdaq ----------------


def earnings_day(day):
    """Nasdaq earnings calendar for one date -> list of rows (past dates include actual EPS + surprise)."""
    j = get("https://api.nasdaq.com/api/calendar/earnings", params={"date": day})
    rows = ((j.get("data") or {}).get("rows")) or []
    out = []
    for row in rows:
        sym = (row.get("symbol") or "").upper().replace(".", "-").replace("/", "-")
        if not sym:
            continue
        when = (row.get("time") or "").lower()
        out.append({"sym": sym, "name": row.get("name"), "date": day,
                    "when": "BMO" if "pre" in when else ("AMC" if "after" in when else "—"),
                    "mcap": num(row.get("marketCap")), "est": num(row.get("epsForecast")),
                    "eps": num(row.get("eps")), "surprise": num(row.get("surprise")),
                    "nEst": num(row.get("noOfEsts")), "lastYearEps": num(row.get("lastYearEPS")),
                    "fq": row.get("fiscalQuarterEnding")})
    return out


def ipo_month(ym):
    """Nasdaq IPO calendar for YYYY-MM -> {priced, upcoming, filed, withdrawn}."""
    j = get("https://api.nasdaq.com/api/ipo/calendar", params={"date": ym})
    d = j.get("data") or {}

    def rows(block, *path):
        node = d.get(block) or {}
        for p in path:
            node = (node or {}).get(p) or {}
        return node.get("rows") or [] if isinstance(node, dict) else []
    return {"priced": rows("priced"), "upcoming": rows("upcoming", "upcomingTable"),
            "filed": rows("filed"), "withdrawn": rows("withdrawn")}


# ---------------- FRED ----------------
FRED_KEY = os.environ.get("FRED_API_KEY", "").strip()


def fred_series(sid, start="2015-01-01"):
    """[(date, value)] for a FRED series. Official API with a key; public CSV download without one."""
    if FRED_KEY:
        j = get("https://api.stlouisfed.org/fred/series/observations",
                params={"series_id": sid, "api_key": FRED_KEY, "file_type": "json", "observation_start": start})
        return [(o["date"], float(o["value"])) for o in j.get("observations", []) if o.get("value") not in (".", "", None)]
    text = get("https://fred.stlouisfed.org/graph/fredgraph.csv", params={"id": sid, "cosd": start}, kind="text")
    out = []
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 2 or not re.match(r"\d{4}-\d{2}-\d{2}", row[0]):
            continue
        try:
            out.append((row[0], float(row[1])))
        except ValueError:
            continue
    if not out:
        raise RuntimeError(f"no FRED data for {sid}")
    return out


def fred_release_calendar(days_ahead=21):
    """Upcoming release dates (needs a FRED API key)."""
    if not FRED_KEY:
        raise RuntimeError("FRED_API_KEY not set: release calendar needs a key")
    today = datetime.now(timezone.utc).date()
    j = get("https://api.stlouisfed.org/fred/releases/dates",
            params={"api_key": FRED_KEY, "file_type": "json", "realtime_start": today.isoformat(),
                    "include_release_dates_with_no_data": "true", "limit": 1000, "sort_order": "asc"})
    out = []
    for d in j.get("release_dates", []):
        dd = datetime.strptime(d["date"], "%Y-%m-%d").date()
        if 0 <= (dd - today).days <= days_ahead:
            out.append({"date": d["date"], "id": d["release_id"], "name": d.get("release_name")})
    return out


# ---------------- RSS / Atom ----------------
ATOM = "{http://www.w3.org/2005/Atom}"


def _clean(s):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    return re.sub(r"\s+", " ", s).strip()


def _when(s):
    if not s:
        return None
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def feed(url):
    """RSS 2.0 or Atom -> [{title, link, summary, published}]."""
    raw = get(url, kind="bytes")
    root = ET.fromstring(raw)
    items = []
    for it in root.iter("item"):
        items.append({"title": _clean(it.findtext("title")), "link": (it.findtext("link") or "").strip(),
                      "summary": _clean(it.findtext("description"))[:400], "published": _when(it.findtext("pubDate"))})
    for it in root.iter(ATOM + "entry"):
        link = it.find(ATOM + "link")
        items.append({"title": _clean(it.findtext(ATOM + "title")), "link": link.get("href") if link is not None else "",
                      "summary": _clean(it.findtext(ATOM + "summary"))[:400],
                      "published": _when(it.findtext(ATOM + "updated") or it.findtext(ATOM + "published"))})
    return [i for i in items if i["title"] and i["link"]]


# ---- English-only filter for headlines -----------------------------------------------------------------
_EN = set("the and of to in for on with at by from is are was were after new says say will its over as an has have that this his her their "
          "it be not but or up out more than into about how what why who when amid against could would may year q1 q2 q3 q4 reports announces "
          "announced announce launches shares stock stocks inc corp".split())
_FOREIGN = set("el la los las del y que para con por una un su se es al lo le les des du et pour dans une sur est qui der die das und mit "
               "für von den zu ist nicht auf ein eine im dem um da uma os não ao dos nas nos il di per che della degli sono gli i en een het "
               "van voor och att som på är med av ett de em na pela pelo anuncia resultados trimestre lucro dividendo banco acima esperado "
               "anuncian resultados empresa nuevo nueva primer segundo tercer cuarto trimestre ganancias".split()) - {"a", "i", "as", "an"}


def is_english(text):
    """Heuristic: True for English text. Rejects non-Latin scripts and text that reads as Spanish, French, German, Portuguese, Italian, Dutch or Swedish."""
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return True
    non_latin = sum(1 for c in letters if ord(c) > 0x024F)
    if non_latin / len(letters) > 0.2:
        return False
    accents = sum(1 for c in letters if 0xC0 <= ord(c) <= 0x24F)
    if accents / len(letters) > 0.06:
        return False
    words = re.findall(r"[a-zA-Zà-ÿ']+", text.lower())
    en = sum(1 for w in words if w in _EN)
    fo = sum(1 for w in words if w in _FOREIGN)
    if fo >= 2 and fo > en:
        return False
    if len(words) >= 5 and en == 0 and fo >= 1:
        return False
    return True
