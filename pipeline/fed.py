"""Fed Day Redline: every FOMC statement compared with the one before it, plus how markets moved after the release.

Writes data/finance/fed.json:
  {"updated", "meetings": [{"date", "release" (UTC), "url", "vote": {"for", "against"} | None, "decision": {...},
     "paras": [statement paragraphs], "votes": "voting paragraph" | None, "prev": date of the previous statement | None,
     "ops": [["=" | "-" | "+", text], ...], "summary": {"headline", "points": [{"topic", "text"}]},
     "reaction": {...}}]}

Source: https://www.federalreserve.gov/newsevents/pressreleases/monetary{YYYYMMDD}a.htm (statements are cached in
fed.json, so a run only fetches statements that are not stored yet).

The summary is rule-based (a fixed topic list and word list), not an editorial reading of the statement: it says
which sentences were added, dropped or reworded and what the decision was. The redline itself is the full truth.

Market reaction is measured from the 2:00 p.m. ET release with Yahoo 5-minute bars, which exist for about 60 days.
A meeting is measured while its bars are still available and then stored for good; older meetings keep only the
full-day move. Moves: S&P 500 (^GSPC) and the dollar index (DX-Y.NYB) in percent, yields in basis points.
Yahoo has no usable intraday 2-year yield, so the 5- and 30-minute 2-year moves are implied from 2-year Treasury
note futures (ZT=F) with a fixed duration and marked approximate; the full-day 2-year move is the official Treasury
par yield change."""
import csv
import difflib
import html as htmllib
import io
import re
from datetime import datetime, time as dtime, timedelta, timezone
from zoneinfo import ZoneInfo

from .net import CONFIG, get, now_iso, read, record, write
from .src_market import chart

ET = ZoneInfo("America/New_York")
URL = "https://www.federalreserve.gov/newsevents/pressreleases/monetary{ymd}a.htm"
ZT_DURATION = 1.85            # modified duration used to turn a 2-year note futures price move into a yield move
INTRADAY_DAYS = 55            # Yahoo serves 5-minute bars for about 60 days
# key, label, Yahoo symbol, unit
ASSETS = [("spx", "S&P 500", "^GSPC", "pct"), ("us10y", "10-year yield", "^TNX", "bp"),
          ("us2y", "2-year yield", "ZT=F", "bp"), ("dxy", "US dollar index", "DX-Y.NYB", "pct")]


# ---------- statement text ----------

def parse_statement(raw):
    """Statement page HTML -> {"paras": [...], "votes": str | None, "vote": {"for", "against"} | None, "release": "HH:MM" | None}."""
    i = raw.find('hidden-sm"></div>')
    j = raw.find("For media inquiries", i)
    if i < 0 or j < 0:
        raise RuntimeError("statement markup not recognised (page layout changed?)")
    paras = []
    for p in re.findall(r"<p[^>]*>(.*?)</p>", raw[i:j], re.S):
        t = htmllib.unescape(re.sub(r"<[^>]+>", "", p)).replace("\xa0", " ")
        t = re.sub(r"\s+", " ", t).strip()
        t = re.sub(r"(\d)[‐-―−-](\d/\d)", r"\1-\2", t)       # 3‑3/4 -> 3-3/4
        if t:
            paras.append(t)
    vote = votes = None
    body = []
    for t in paras:
        m = re.search(r"approved the following statement.*?by an? (\d+)\D{1,4}(\d+) vote", t)
        if m:
            vote = {"for": int(m.group(1)), "against": int(m.group(2))}
        elif t.startswith("Voting for") or t.startswith("Voting against"):
            votes = t
        elif t.startswith("Implementation Note"):
            continue
        else:
            body.append(t)
    if len(body) < 2:
        raise RuntimeError(f"statement has {len(body)} paragraphs; expected a full statement")
    return {"paras": body, "votes": votes, "vote": vote}


def _frac(s):
    """'3-3/4' -> 3.75, '4' -> 4.0, '3-1/2' -> 3.5, '1/4' -> 0.25"""
    s = s.strip()
    m = re.fullmatch(r"(?:(\d+)-)?(\d+)/(\d+)", s)
    if m:
        return float(m.group(1) or 0) + int(m.group(2)) / int(m.group(3))
    return float(s)


def decision(paras):
    """The rate decision parsed from the statement itself: {"action", "range": [lo, hi], "bp"}."""
    text = " ".join(paras)
    m = re.search(r"target range for the federal funds rate(?: by [\d/\- ]+ percentage points?)?(?: to| at)\s+([\d/\-]+) to ([\d/\-]+) percent", text)
    if not m:
        return None
    lo, hi = _frac(m.group(1)), _frac(m.group(2))
    verb = re.search(r"decided to (maintain|raise|lower)", text)
    return {"action": {"maintain": "hold", "raise": "raise", "lower": "cut"}.get(verb.group(1) if verb else "maintain", "hold"),
            "range": [lo, hi]}


# ---------- redline ----------

TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’\-/.%]*[A-Za-z0-9%]|[A-Za-z0-9]|[^\sA-Za-z0-9]")
NOSPACE_BEFORE = set(".,;:)%?!")
NOSPACE_AFTER = set("(")
PARA = "¶"


def tokens(paras):
    out = []
    for k, p in enumerate(paras):
        if k:
            out.append(PARA)
        out += TOKEN.findall(p)
    return out


def _join(toks, prev):
    """Join tokens into text; a leading space is added when the first token needs one after `prev`."""
    s = ""
    for t in toks:
        if t == PARA:
            s += "\n\n"
        elif not s and (prev is None or prev == PARA or t in NOSPACE_BEFORE or prev in NOSPACE_AFTER):
            s += t
        elif s.endswith("\n\n") or t in NOSPACE_BEFORE or (s and s[-1] in NOSPACE_AFTER):
            s += t
        else:
            s += " " + t
        prev = t
    return s


def redline(old, new):
    """Word-level diff of two statements -> [["=" | "-" | "+", text], ...]. Joining the "=" and "+" ops gives the new statement."""
    a, b = tokens(old), tokens(new)
    ops = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            ops.append(["=", _join(b[j1:j2], b[j1 - 1] if j1 else None)])
        else:
            if i2 > i1:
                ops.append(["-", _join(a[i1:i2], a[i1 - 1] if i1 else None)])
            if j2 > j1:
                ops.append(["+", _join(b[j1:j2], b[j1 - 1] if j1 else None)])
    return ops


# ---------- plain-English summary ----------

TOPICS = [("Policy rate", r"target range|federal funds rate|decided to"),
          ("Balance sheet", r"balance sheet|reserve balances|ample reserves|securities|Treasury|mortgage"),
          ("Inflation", r"inflation|prices|price stability|price increases"),
          ("Jobs", r"\bjob|unemployment|labor market|employment|workforce|payroll"),
          ("Growth", r"economic activity|spending|growth|output|investment|productivity|consumer"),
          ("Risks and outlook", r"uncertain|risks?\b|outlook|geopolitic|conflict|downside|upside"),
          ("Policy guidance", r"adjust|extent and timing|incoming|assess|stance|monitor|determine|prepared")]
# word -> reading: +1 stronger / hotter, -1 weaker / cooler (used only to note direction on a one-word swap)
LEX = {"strong": 2, "robust": 2, "solid": 1, "expanding": 1, "resilient": 1, "moderate": 0, "moderated": -1, "slowed": -1, "slowing": -1,
       "softened": -1, "weakened": -1, "weak": -2, "elevated": 1, "somewhat": 0, "moved up": 1, "edged up": 1, "eased": -1, "declined": -1,
       "rose": 1, "increased": 1, "higher": 1, "lower": -1}
SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")


def _sentences(paras):
    out = []
    for p in paras:
        # a single capital + period is an initial (Lisa D. Cook), not a sentence end
        s = re.sub(r"\b([A-Z])\.\s", lambda m: m.group(1) + "\x00 ", p)
        out += [x.replace("\x00", ".").strip() for x in SENT.split(s) if x.strip()]
    return out


def _topic(s):
    for name, rx in TOPICS:
        if re.search(rx, s, re.I):
            return name
    return "Other"


def _swaps(a, b):
    """Phrase swaps inside one reworded sentence: [(old, new)]."""
    ta, tb, out = TOKEN.findall(a), TOKEN.findall(b), []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, ta, tb, autojunk=False).get_opcodes():
        if tag != "equal":
            out.append((_join(ta[i1:i2], None), _join(tb[j1:j2], None)))
    return out


def _clip(s, n=140):
    return s if len(s) <= n else s[:n - 1].rstrip() + "…"


def _bp(x):
    return f"{abs(x) * 100:.0f}"


def _range_text(r):
    return f"{r[0]:.2f}%–{r[1]:.2f}%"


def dissents(votes):
    """[(name, what they preferred)] from the 'Voting against ...' sentence."""
    if not votes or "Voting against" not in votes:
        return []
    tail = votes.split("Voting against", 1)[1]
    out = []
    for clause in tail.split(";"):
        m = re.search(r"(?:^|\bwere |\bwas |action,? )(.+?),? who preferred ([^;.]*)", clause)
        if not m:
            continue
        pref = m.group(2)
        kind = ("a bigger cut" if "lower" in pref and "1/2" in pref else "a cut" if "lower" in pref else "a hike" if "raise" in pref
                else "no change" if "no change" in pref else "a different move")
        names = re.sub(r"^and\s+", "", re.sub(r"^.*?\b(?:were|was)\s+", "", m.group(1).strip())).strip()
        for n in re.split(r",\s*(?:and\s+)?|\s+and\s+", names):
            n = n.strip()
            if n:
                out.append((n, kind))
    return out


def _sim(a, b):
    """Sentence similarity: the plain ratio, or how much of the shorter sentence survives in the longer one (a trimmed sentence)."""
    ta, tb = TOKEN.findall(a), TOKEN.findall(b)
    sm = difflib.SequenceMatcher(None, ta, tb, autojunk=False)
    matched = sum(x.size for x in sm.get_matching_blocks())
    short = min(len(ta), len(tb)) or 1
    return max(sm.ratio(), 0.7 if matched >= 3 and matched / short >= 0.85 else 0)


def summarize(prev, cur, pdec, cdec):
    """prev/cur: parsed statements. Returns {"headline", "points": [{"topic", "text"}]}."""
    points = []
    if cdec:
        if pdec and cdec["range"] != pdec["range"]:
            d = cdec["range"][1] - pdec["range"][1]
            word = "cut" if d < 0 else "raised"
            points.append({"topic": "Policy rate", "text": f"Rate {word} by {_bp(d)} basis points, to {_range_text(cdec['range'])} (from {_range_text(pdec['range'])})."})
        else:
            points.append({"topic": "Policy rate", "text": f"Rate held at {_range_text(cdec['range'])}."})
    # dissents
    dis = dissents(cur.get("votes"))
    if dis:
        who = [n for n, _ in dis]
        kinds = sorted({k for _, k in dis})
        tally = f" Vote {cur['vote']['for']}–{cur['vote']['against']}." if cur.get("vote") else ""
        points.append({"topic": "Dissents", "text": f"{len(who)} dissent{'s' if len(who) != 1 else ''} ({', '.join(who)}), preferring {' / '.join(kinds)}.{tally}"})
    elif cur.get("votes") or cur.get("vote"):
        points.append({"topic": "Dissents", "text": "No dissents." + (f" Vote {cur['vote']['for']}–{cur['vote']['against']}." if cur.get("vote") else "")})
    # wording
    if prev:
        ps, cs = _sentences(prev["paras"]), _sentences(cur["paras"])
        keep = {}
        for k, s in enumerate(cs):
            best = max(((_sim(p, s), j) for j, p in enumerate(ps) if j not in keep.values()), default=(0, None))
            if best[0] >= 0.55:
                keep[k] = best[1]
        used = set(keep.values())
        n_re = n_add = n_drop = 0
        for k, s in enumerate(cs):
            if k in keep:
                p = ps[keep[k]]
                if p == s or _topic(s) == "Policy rate" and cdec:
                    continue
                sw = _swaps(p, s)
                if not sw:
                    continue
                n_re += 1
                bits = []
                for o, n in sw[:3]:
                    tag = ""
                    lo, ln = LEX.get(o.lower()), LEX.get(n.lower())
                    if lo is not None and ln is not None and lo != ln:
                        tag = " (reads stronger)" if ln > lo else " (reads weaker)"
                    bits.append((f"removed “{_clip(o, 60)}”" if not n else f"added “{_clip(n, 60)}”" if not o else f"“{_clip(o, 60)}” became “{_clip(n, 60)}”") + tag)
                points.append({"topic": _topic(s), "text": "Reworded: " + "; ".join(bits) + "."})
            elif _topic(s) != "Policy rate":
                n_add += 1
                points.append({"topic": _topic(s), "text": f"New sentence: “{_clip(s)}”"})
        for j, p in enumerate(ps):
            if j not in used and _topic(p) != "Policy rate":
                n_drop += 1
                points.append({"topic": _topic(p), "text": f"Dropped: “{_clip(p)}”"})
        order = {t: i for i, (t, _) in enumerate([("Policy rate", 0), ("Dissents", 0)] + TOPICS)}
        points.sort(key=lambda x: order.get(x["topic"], 99))
        if not (n_re or n_add or n_drop):
            points.append({"topic": "Wording", "text": "No wording changes from the previous statement."})
        wording = f"{n_re} reworded, {n_add} added, {n_drop} dropped" if (n_re or n_add or n_drop) else "wording unchanged"
    else:
        wording = "first statement in this comparison"
    head = ""
    if cdec:
        verb = "cut" if pdec and cdec["range"][1] < pdec["range"][1] else "raised" if pdec and cdec["range"][1] > pdec["range"][1] else "held"
        head = f"Rate {verb} {'to' if verb != 'held' else 'at'} {_range_text(cdec['range'])}"
    return {"headline": f"{head}; {wording}." if head else f"{wording}.", "points": points[:9]}


# ---------- market reaction ----------

def _et(date, hh, mm=0):
    return datetime.combine(date, dtime(hh, mm), tzinfo=ET).astimezone(timezone.utc)


def price_at(t, c, when):
    """Close of the last 5-minute bar that has finished by `when` (UTC epoch seconds in t)."""
    ts = when.timestamp()
    best = None
    for k, start in enumerate(t):
        if start + 300 <= ts + 1:
            best = k
        else:
            break
    return (c[best], t[best] + 300) if best is not None and ts - (t[best] + 300) <= 1200 else (None, None)


def intraday_moves(t, c, release):
    """Moves from the release for one series: {"base", "m5", "m30", "close"} as (price levels) or None for a missing point."""
    base, _ = price_at(t, c, release)
    out = {"base": base}
    for key, when in (("p5", release + timedelta(minutes=5)), ("p30", release + timedelta(minutes=30)),
                      ("pc", _et(release.astimezone(ET).date(), 16, 0))):
        # a point in the future is not measured yet
        out[key] = price_at(t, c, when)[0] if when <= datetime.now(timezone.utc) else None
    return out


def _move(unit, base, p, kind):
    if base is None or p is None:
        return None
    if kind == "zt":                                     # futures price -> implied yield change, bp
        return round(-((p - base) / base) / ZT_DURATION * 10000, 1)
    if unit == "pct":
        return round((p / base - 1) * 100, 2)
    return round((p - base) * 100, 1)                    # yield in percent -> basis points


def daily_move(t, c, date, unit):
    """Close-to-close move on `date` from daily bars."""
    ds = [datetime.fromtimestamp(x, ET).date() for x in t]
    if date not in ds:
        return None
    k = ds.index(date)
    if k == 0:
        return None
    return _move(unit, c[k - 1], c[k], "")


def treasury_2y(year_list):
    rows = {}
    for y in year_list:
        url = (f"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{y}/all"
               f"?type=daily_treasury_yield_curve&field_tdr_date_value={y}&page&_format=csv")
        for row in csv.DictReader(io.StringIO(get(url, kind="text").lstrip("﻿"))):
            try:
                rows[datetime.strptime(row["Date"], "%m/%d/%Y").date()] = float(row["2 Yr"])
            except (KeyError, ValueError):
                pass
    return rows


def reaction(date, bars, daily, ty2, today):
    """Market reaction for one meeting. bars/daily: {symbol: chart dict or None}. Final once the day is over and every point is in."""
    release = _et(date, 14, 0)
    out = {"measured": now_iso(), "assets": {}, "intraday": True, "final": False}
    complete = True
    for key, label, sym, unit in ASSETS:
        a = {"label": label, "unit": unit}
        ch = bars.get(sym)
        kind = "zt" if key == "us2y" else ""
        if ch and ch["t"]:
            mv = intraday_moves(ch["t"], ch["c"], release)
            for k2, src in (("m5", "p5"), ("m30", "p30"), ("close", "pc")):
                a[k2] = _move(unit, mv["base"], mv[src], kind)
            if mv["base"] is None:
                out["intraday"] = False
        else:
            out["intraday"] = False
        if key == "us2y":
            prior = max((d for d in ty2 if d < date), default=None)
            a["day"] = round((ty2[date] - ty2[prior]) * 100, 1) if date in ty2 and prior else None
            a["approx"] = True                                             # 5/30 min and close come from futures
        else:
            d = daily.get(sym)
            a["day"] = daily_move(d["t"], d["c"], date, unit) if d else None
        if any(a.get(k) is None for k in ("m5", "m30", "close")):
            complete = False
        out["assets"][key] = a
    out["final"] = (date < today) and (complete or (today - date).days >= 2)   # a missing point is not retried forever
    if not out["intraday"] and date < today:
        out["note"] = "Intraday bars are no longer available for this meeting (the free source keeps about 60 days); only the full-day move is shown."
        out["final"] = True
    return out


# ---------- job ----------

def meetings_list():
    """FOMC decision dates up to today, with the baseline statement first."""
    today = datetime.now(ET).date()
    base = CONFIG.get("fomc_baseline")
    days = ([base] if base else []) + [d for d in CONFIG.get("fomc_2026", [])]
    return sorted({d for d in days if d <= today.isoformat()})


def job_fed():
    store = read("fed.json") or {}
    have = {m["date"]: m for m in store.get("meetings", [])}
    today = datetime.now(ET).date()
    dates = meetings_list()
    out = []
    for d in dates:
        m = have.get(d, {"date": d})
        if "paras" not in m:
            ymd = d.replace("-", "")
            raw = get(URL.format(ymd=ymd), kind="bytes")
            st = parse_statement(raw.decode("utf-8", "replace"))
            m.update(st, url=URL.format(ymd=ymd), release=_et(datetime.fromisoformat(d).date(), 14, 0).isoformat(),
                     decision=decision(st["paras"]))
        out.append(m)
    # redline + summary against the previous statement
    for k, m in enumerate(out):
        prev = out[k - 1] if k else None
        m["prev"] = prev["date"] if prev else None
        if prev:
            m["ops"] = redline(prev["paras"] + ([prev["votes"]] if prev.get("votes") else []), m["paras"] + ([m["votes"]] if m.get("votes") else []))
        else:
            m["ops"] = None
        m["summary"] = summarize(prev, m, prev.get("decision") if prev else None, m.get("decision")) if prev else None
    # market reaction for every meeting that is not final yet
    todo = [m for m in out if m["date"] != (CONFIG.get("fomc_baseline") or "") and not (m.get("reaction") or {}).get("final")]
    if todo:
        bars, daily = {}, {}
        for _, _, sym, _ in ASSETS:
            try:
                bars[sym] = chart(sym, "60d", "5m")
            except Exception as e:  # noqa: BLE001
                record(f"fed 5m {sym}", False, error=str(e)[:200])
            try:
                daily[sym] = chart(sym, "2y", "1d")
            except Exception as e:  # noqa: BLE001
                record(f"fed 1d {sym}", False, error=str(e)[:200])
        try:
            ty2 = treasury_2y(sorted({today.year, today.year - 1}))
        except Exception as e:  # noqa: BLE001
            ty2 = {}
            record("fed treasury 2Y", False, error=str(e)[:200])
        for m in todo:
            d = datetime.fromisoformat(m["date"]).date()
            old = (today - d).days > INTRADAY_DAYS
            m["reaction"] = reaction(d, {} if old else bars, daily, ty2, today)
    write("fed.json", {"updated": now_iso(), "meetings": out})
    return {"meetings": len(out), "measured": len(todo)}
