"""SEC EDGAR: company facts, Form 4 insiders, 13D/13G holders, 13F data sets."""
import csv
import io
import re
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from datetime import date, datetime

from .net import get, r

_TICKERS = None


def tickers():
    """ticker -> (cik, title), all SEC-listed companies."""
    global _TICKERS
    if _TICKERS is None:
        j = get("https://www.sec.gov/files/company_tickers.json")
        _TICKERS = {v["ticker"].upper().replace(".", "-"): (int(v["cik_str"]), v["title"]) for v in j.values()}
    return _TICKERS


def cik_to_ticker():
    out = {}
    for t, (cik, _) in tickers().items():
        out.setdefault(cik, t)
    return out


def submissions(cik):
    return get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")


def recent_filings(sub):
    rec = sub["filings"]["recent"]
    keys = list(rec.keys())
    return [dict(zip(keys, vals)) for vals in zip(*[rec[k] for k in keys])]


def filing_url(cik, acc, doc=""):
    return f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/{doc}"


# ---------------- company facts -> quarterly financials ----------------
REV_TAGS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
            "RevenuesNetOfInterestExpense", "RevenueFromContractWithCustomerIncludingAssessedTax"]
TAGS = {"rev": REV_TAGS, "gp": ["GrossProfit"], "op": ["OperatingIncomeLoss"], "ni": ["NetIncomeLoss"],
        "eps": ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"]}


def _days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def _quarters(units):
    """Standalone quarterly values keyed by period end; Q4 derived as FY minus 9-month YTD when needed."""
    q, fy, ytd9 = {}, {}, {}
    for f in units:
        if "start" not in f or f.get("form") not in ("10-Q", "10-K", "10-Q/A", "10-K/A"):
            continue
        n = _days(f["start"], f["end"])
        key = f["end"]
        if 80 <= n <= 100:
            q[key] = (f["val"], f["filed"])
        elif 350 <= n <= 380:
            fy[key] = (f["val"], f["start"])
        elif 260 <= n <= 285:
            ytd9[key] = (f["val"], f["start"])
    for end, (val, start) in fy.items():
        if end in q:
            continue
        nine = [v for e, (v, s) in ytd9.items() if s == start and _days(e, end) < 100]
        if nine:
            q[end] = (val - nine[0], None)
    return {e: v for e, (v, _) in q.items()}


def financials(cik):
    facts = get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json")
    gaap = facts.get("facts", {}).get("us-gaap", {})
    out = {}
    for key, tags in TAGS.items():
        best = {}
        for tag in tags:
            units = gaap.get(tag, {}).get("units", {})
            vals = units.get("USD/shares" if key == "eps" else "USD") or []
            qs = _quarters(vals)
            if len(qs) > len(best) or (qs and best and max(qs) > max(best)):
                best = qs
        out[key] = best
    ends = sorted(out["rev"] or out["ni"], reverse=True)[:8]
    quarters = [{"end": e, **{k: out[k].get(e) for k in TAGS}} for e in sorted(ends)]
    shares = []
    for f in facts.get("facts", {}).get("dei", {}).get("EntityCommonStockSharesOutstanding", {}).get("units", {}).get("shares", []):
        shares.append((f["end"], f["val"]))
    shares.sort()
    eps4 = [q["eps"] for q in quarters[-4:] if q["eps"] is not None]
    return {"quarters": quarters, "shares": shares[-12:], "epsTTM": r(sum(eps4), 3) if len(eps4) == 4 else None}


def shares_at(fin, day):
    """Shares outstanding closest to (and not long after) a date."""
    best = None
    for end, val in fin.get("shares", []):
        if end <= day or best is None:
            best = val
    return best


# ---------------- Form 4 insider transactions ----------------
CODES = {"P": "Open-market buy", "S": "Sale", "M": "Option exercise", "A": "Award / grant", "F": "Tax withholding",
         "G": "Gift", "D": "Disposition to issuer", "C": "Conversion", "X": "Option exercise"}


def _t(node, path):
    el = node.find(path)
    return el.text.strip() if el is not None and el.text else None


def form4(cik, acc, doc):
    raw = re.sub(r"^xsl[^/]+/", "", doc)
    xml = get(filing_url(cik, acc, raw), kind="bytes")
    root = ET.fromstring(xml)
    owner = _t(root, "reportingOwner/reportingOwnerId/rptOwnerName") or "?"
    rel = root.find("reportingOwner/reportingOwnerRelationship")
    role = None
    if rel is not None:
        role = _t(rel, "officerTitle") or ("Director" if _t(rel, "isDirector") in ("1", "true") else None) or (
            "10% owner" if _t(rel, "isTenPercentOwner") in ("1", "true") else None)
    plan = (_t(root, "aff10b5One") or "") in ("1", "true")
    out = []
    for tx in root.findall("nonDerivativeTable/nonDerivativeTransaction"):
        code = _t(tx, "transactionCoding/transactionCode")
        sh = _t(tx, "transactionAmounts/transactionShares/value")
        px = _t(tx, "transactionAmounts/transactionPricePerShare/value")
        ad = _t(tx, "transactionAmounts/transactionAcquiredDisposedCode/value")
        if not code or not sh:
            continue
        foot = " ".join((f.text or "") for f in root.iter("footnote")).lower()
        out.append({"name": owner.title(), "role": role, "code": code, "type": CODES.get(code, code),
                    "plan": plan or "10b5-1" in foot, "shares": r(sh, 0), "price": r(px, 2) if px else None,
                    "ad": ad, "date": _t(tx, "transactionDate/value")})
    return out


def insiders(cik, filings, limit=30):
    rows = []
    for f in [x for x in filings if x["form"] == "4"][:limit]:
        try:
            for tx in form4(cik, f["accessionNumber"], f["primaryDocument"]):
                tx["filed"] = f["filingDate"]
                rows.append(tx)
        except Exception as e:  # one malformed filing should not sink the rest
            print("form4 skip", f["accessionNumber"], e)
    return rows


# ---------------- 13D / 13G (5%+ holders) ----------------
BIG = ("SC 13D", "SC 13G", "SCHEDULE 13D", "SCHEDULE 13G")


def big_holders(cik, filings, limit=8):
    out = []
    for f in [x for x in filings if x["form"].upper().startswith(BIG)][:limit]:
        acc = f["accessionNumber"]
        filer, pct = None, None
        try:
            hdr = get(filing_url(cik, acc, f"{acc}-index-headers.html"), kind="text")
            m = re.search(r"FILED BY:.*?COMPANY CONFORMED NAME:\s*([^\n<]+)", hdr, re.S)
            filer = m.group(1).strip().title() if m else None
        except Exception as e:
            print("13D header skip", acc, e)
        out.append({"form": f["form"], "date": f["filingDate"], "filer": filer, "pct": pct,
                    "activist": "13D" in f["form"].upper(), "url": filing_url(cik, acc, f["primaryDocument"])})
    return out


# ---------------- 13F data sets (quarterly institutional holdings) ----------------
DATASETS = "https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets"


def dataset_links():
    html = get(DATASETS, kind="text")
    links = sorted(set(re.findall(r'href="([^"]+form13f\.zip)"', html, re.I)))
    links = [("https://www.sec.gov" + l) if l.startswith("/") else l for l in links]
    if not links:
        raise RuntimeError("no 13F data set links found")

    def key(u):  # newest first; names look like 01jun2025-31aug2025_form13f.zip or 2023q4_form13f.zip
        name = u.rsplit("/", 1)[-1].lower()
        m = re.match(r"(\d{2}[a-z]{3}\d{4})-(\d{2}[a-z]{3}\d{4})", name)
        if m:
            return datetime.strptime(m.group(2), "%d%b%Y")
        m = re.match(r"(\d{4})q(\d)", name)
        return datetime(int(m.group(1)), int(m.group(2)) * 3, 28) if m else datetime(1900, 1, 1)
    return sorted(links, key=key, reverse=True)


def _tsv(zf, name):
    member = next(n for n in zf.namelist() if n.upper().endswith(name))
    with zf.open(member) as fh:
        yield from csv.DictReader(io.TextIOWrapper(fh, encoding="latin-1"), delimiter="\t")


def holdings_from_zip(blob, cusips):
    """-> {(cik, period): {"acc", "filed", "name", "pos": {cusip: shares}}} for 13F-HR filings."""
    zf = zipfile.ZipFile(io.BytesIO(blob))
    subs = {}
    for row in _tsv(zf, "SUBMISSION.TSV"):
        if row.get("SUBMISSIONTYPE", "").upper() != "13F-HR":
            continue
        try:
            period = datetime.strptime(row["PERIODOFREPORT"], "%d-%b-%Y").strftime("%Y-%m-%d")
            filed = datetime.strptime(row["FILING_DATE"], "%d-%b-%Y").strftime("%Y-%m-%d")
        except (KeyError, ValueError):
            continue
        subs[row["ACCESSION_NUMBER"]] = (int(row["CIK"]), period, filed)
    names = {row["ACCESSION_NUMBER"]: row.get("FILINGMANAGER_NAME", "") for row in _tsv(zf, "COVERPAGE.TSV")
             if row["ACCESSION_NUMBER"] in subs}
    pos = defaultdict(lambda: defaultdict(float))
    issuer = {}
    for row in _tsv(zf, "INFOTABLE.TSV"):
        cu = (row.get("CUSIP") or "").upper()
        if cu not in cusips or row["ACCESSION_NUMBER"] not in subs:
            continue
        if (row.get("PUTCALL") or "").strip() or (row.get("SSHPRNAMTTYPE") or "SH").upper() != "SH":
            continue
        try:
            pos[row["ACCESSION_NUMBER"]][cu] += float(row["SSHPRNAMT"])
        except ValueError:
            continue
        issuer.setdefault(cu, row.get("NAMEOFISSUER"))
    out = {}
    for acc, held in pos.items():
        cik, period, filed = subs[acc]
        prev = out.get((cik, period))
        if prev is None or filed > prev["filed"]:
            out[(cik, period)] = {"acc": acc, "filed": filed, "name": names.get(acc, ""), "pos": dict(held)}
    filers = defaultdict(set)  # every manager that filed for a period, holders or not
    for cik, period, _ in subs.values():
        filers[period].add(cik)
    return out, issuer, filers
