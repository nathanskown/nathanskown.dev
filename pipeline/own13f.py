"""13F institutional ownership for every widely held US equity, from the SEC's quarterly 13F data sets.

Two passes over the data-set zips (saved to disk, not memory):
  1. SUBMISSION tables -> which filing counts for each manager and quarter (the latest one filed).
  2. INFOTABLE tables  -> per stock and quarter: holder count and total shares (all 8 quarters),
                          plus each manager's position for the latest two quarters only.
Keeping per-manager detail for two quarters (not eight) is what keeps memory in check: the full
history is ~25 million rows.

CUSIPs are matched to tickers with OpenFIGI (free; an OPENFIGI_KEY secret raises the rate limit) and the
matches are cached in data/finance/cusip_map.json, so only new securities are looked up each quarter.
"""
import csv
import io
import re
import os
import pathlib
import tempfile
import time
import zipfile
from datetime import date, timedelta
from collections import Counter
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from . import net as netmod
from . import src_sec as sec
from .net import CONFIG, attempt, get, now_iso, post_json, r, read, record, write

VERSION = 14          # bump when this logic changes so the next push rebuilds ownership
MIN_HOLDERS = 30     # a security needs this many 13F holders to get a page
FIGI_KEY = os.environ.get("OPENFIGI_KEY", "").strip()


def _tsv(zf, suffix, cols, dtypes=None):
    member = next(n for n in zf.namelist() if n.upper().endswith(suffix))
    with zf.open(member) as fh:
        head = fh.readline().decode("latin-1").rstrip("\r\n").split("\t")
    use = [c for c in cols if c in head]
    with zf.open(member) as fh:
        return pd.read_csv(io.TextIOWrapper(fh, encoding="latin-1"), sep="\t", usecols=use, dtype=dtypes or str,
                           quoting=csv.QUOTE_NONE, on_bad_lines="skip", low_memory=False)


def _download(links, folder):
    paths = []
    for url in links:
        name = url.rsplit("/", 1)[-1]
        resp = attempt(f"13F set {name}", get, url, stream=True, timeout=300)
        if not resp:
            continue
        path = pathlib.Path(folder) / name
        with open(path, "wb") as fh:
            for chunk in resp.iter_content(1 << 20):
                fh.write(chunk)
        paths.append(path)
    return paths


def _submissions(paths):
    """Which filings count for each manager and quarter.

    An original 13F-HR is the baseline. A 13F-HR/A amendment is one of two kinds, named on its cover page:
      RESTATEMENT   replaces everything filed before it for that quarter
      NEW HOLDINGS  adds positions the earlier filing left out, so it is counted together with the baseline
    Ignoring amendments (as earlier versions did) can make a manager look like it added or dropped a huge position
    when its restated or supplemental filing is simply missing from the quarter it belongs to. An amendment whose
    kind is not stated is skipped, since guessing wrong would swing positions either way."""
    frames, names, kinds = [], {}, {}
    for path in paths:
        with zipfile.ZipFile(path) as zf:
            s = _tsv(zf, "SUBMISSION.TSV", ["ACCESSION_NUMBER", "SUBMISSIONTYPE", "PERIODOFREPORT", "FILING_DATE", "CIK"])
            s = s[s["SUBMISSIONTYPE"].str.upper().isin(["13F-HR", "13F-HR/A"])].copy()
            s["amend"] = s["SUBMISSIONTYPE"].str.upper().str.endswith("/A")
            s["period"] = pd.to_datetime(s["PERIODOFREPORT"], format="%d-%b-%Y", errors="coerce").dt.strftime("%Y-%m-%d")
            s["filed"] = pd.to_datetime(s["FILING_DATE"], format="%d-%b-%Y", errors="coerce").dt.strftime("%Y-%m-%d")
            s["cik"] = pd.to_numeric(s["CIK"], errors="coerce")
            frames.append(s.dropna(subset=["period", "filed", "cik"])[["ACCESSION_NUMBER", "cik", "period", "filed", "amend"]])
            c = _tsv(zf, "COVERPAGE.TSV", ["ACCESSION_NUMBER", "FILINGMANAGER_NAME", "AMENDMENTTYPE"])
            names.update(zip(c["ACCESSION_NUMBER"], c["FILINGMANAGER_NAME"]))
            if "AMENDMENTTYPE" in c.columns:
                kinds.update(zip(c["ACCESSION_NUMBER"], c["AMENDMENTTYPE"]))
    subs = pd.concat(frames, ignore_index=True).drop_duplicates("ACCESSION_NUMBER")
    subs["cik"] = subs["cik"].astype("int64")
    kind = subs["ACCESSION_NUMBER"].map(kinds).fillna("").astype(str).str.upper()
    subs["restate"] = ~subs["amend"] | kind.str.startswith("RESTATEMENT")
    supplement = subs["amend"] & kind.str.startswith("NEW HOLDINGS")
    subs = subs[subs["restate"] | supplement].sort_values(["cik", "period", "filed", "ACCESSION_NUMBER"])
    subs["ord"] = subs.groupby(["cik", "period"]).cumcount()
    # the baseline is the latest original or restatement; everything after it is a supplement to count with it
    base = subs[subs["restate"]].groupby(["cik", "period"])["ord"].max().rename("base")
    subs = subs.join(base, on=["cik", "period"])
    win = subs[subs["base"].notna() & (subs["ord"] >= subs["base"])].drop(columns=["ord", "base", "amend", "restate"])
    mgr = {}
    for acc, cik in zip(win["ACCESSION_NUMBER"], win["cik"]):
        if names.get(acc):
            mgr[int(cik)] = names[acc]
    return win, mgr


def _holdings(paths, win, detail_periods, keep_ciks=()):
    """-> (agg: period,cusip -> holders, shares), detail rows for detail_periods (and for every quarter for keep_ciks,
    the index-family filers, so their trend can be drawn), issuer names, dropped count."""
    keep_ciks = list(keep_ciks)
    acc_info = win.set_index("ACCESSION_NUMBER")[["cik", "period"]]
    aggs, details, issuers, dropped = [], [], {}, 0
    for path in paths:
        with zipfile.ZipFile(path) as zf:
            it = _tsv(zf, "INFOTABLE.TSV", ["ACCESSION_NUMBER", "NAMEOFISSUER", "CUSIP", "VALUE", "SSHPRNAMT", "SSHPRNAMTTYPE", "PUTCALL"],
                      {"ACCESSION_NUMBER": "category", "NAMEOFISSUER": "category", "CUSIP": "category", "VALUE": str,
                       "SSHPRNAMT": str, "SSHPRNAMTTYPE": "category", "PUTCALL": "category"})
        it = it[it["ACCESSION_NUMBER"].isin(acc_info.index)]
        it = it[(it["SSHPRNAMTTYPE"].astype(str).str.upper().isin(["SH", "NAN"])) & (it["PUTCALL"].isna())]
        it = it.assign(cusip=it["CUSIP"].astype(str).str.upper().str.strip(), sh=pd.to_numeric(it["SSHPRNAMT"], errors="coerce"),
                       val=pd.to_numeric(it["VALUE"], errors="coerce").fillna(0))
        it = it[it["sh"] > 0].drop(columns=["CUSIP", "VALUE", "SSHPRNAMT", "SSHPRNAMTTYPE", "PUTCALL"])
        it["ACCESSION_NUMBER"] = it["ACCESSION_NUMBER"].astype(str)
        it = it.join(acc_info, on="ACCESSION_NUMBER")
        for cu, nm in it.drop_duplicates("cusip")[["cusip", "NAMEOFISSUER"]].itertuples(index=False):
            issuers.setdefault(cu, nm)
        # shares keyed in the wrong unit: implied price far from the median for that stock and quarter.
        # value-in-thousands filers are kept (their share counts are right).
        px = it["val"] / it["sh"]
        grp = it.assign(px=px).groupby(["cusip", "period"])["px"]
        med, cnt = grp.transform("median"), grp.transform("size")
        ok = (cnt < 20) | (it["val"] <= 0) | px.between(med / 3, med * 3) | (px * 1000).between(med / 3, med * 3)
        dropped += int((~ok).sum())
        it = it[ok]
        pos = it.groupby(["period", "cusip", "cik"], as_index=False)["sh"].sum()
        aggs.append(pos.groupby(["period", "cusip"]).agg(holders=("cik", "size"), shares=("sh", "sum")).reset_index())
        details.append(pos[pos["period"].isin(detail_periods) | pos["cik"].isin(keep_ciks)])
        del it, pos
    agg = pd.concat(aggs).groupby(["period", "cusip"], as_index=False).agg(holders=("holders", "sum"), shares=("shares", "sum"))
    det = pd.concat(details).groupby(["period", "cusip", "cik"], as_index=False)["sh"].sum()
    return agg, det, issuers, dropped


def _figi(cusips):
    """CUSIP -> ticker via OpenFIGI, cached across runs."""
    cache = read("cusip_map.json", {}) or {}
    todo = [c for c in cusips if c not in cache]
    batch = 100 if FIGI_KEY else 10
    gap = 0.25 if FIGI_KEY else 2.5  # 25 requests per 6 s with a key, 25 per minute without
    headers = {"X-OPENFIGI-APIKEY": FIGI_KEY} if FIGI_KEY else {}
    done, fails = 0, 0
    for i in range(0, len(todo), batch):
        chunk = todo[i:i + batch]
        try:
            res = post_json("https://api.openfigi.com/v3/mapping",
                            [{"idType": "ID_CUSIP", "idValue": c, "exchCode": "US"} for c in chunk], headers=headers)
        except Exception as e:  # noqa: BLE001
            fails += 1
            record("openfigi batch", False, error=str(e)[:200])
            if fails >= 3:
                break
            continue
        for c, item in zip(chunk, res):
            hit = next((d for d in item.get("data") or [] if d.get("marketSector") == "Equity" and d.get("ticker")), None)
            cache[c] = hit["ticker"].replace("/", "-").replace(".", "-").upper() if hit else ""
            done += 1
        time.sleep(gap)
    write("cusip_map.json", dict(sorted(cache.items())))
    record("openfigi cusip lookup", fails < 3, n=done, note=f"{len(todo)} new CUSIPs, {done} looked up, {len(cache)} cached")
    return cache


def _shares_history(cik, skip_cover=False):
    """[(end, shares)]: the cover-page share count (largest class when several are reported); companies that
    only report it by share class fall back to balance-sheet or weighted-average share counts."""
    by_end = {}
    try:
        if skip_cover:
            raise RuntimeError("HTTP 404 (skipped)")
        j = get(f"https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/dei/EntityCommonStockSharesOutstanding.json")
        for f in (j.get("units") or {}).get("shares", []):
            by_end[f["end"]] = max(by_end.get(f["end"], 0), f["val"])
    except RuntimeError as e:  # 404: tag not reported without a class dimension; anything else is retried
        if "HTTP 404" not in str(e):
            raise
    # fallbacks, best first: balance-sheet shares outstanding, then quarterly weighted-average shares
    for tag, quarterly in ((("CommonStockSharesOutstanding", False),) if not skip_cover else ()) + (("WeightedAverageNumberOfDilutedSharesOutstanding", True),
                           ("WeightedAverageNumberOfSharesOutstandingBasic", True),
                           ("WeightedAverageNumberOfShareOutstandingBasicAndDiluted", True)):
        if by_end:
            break
        try:
            j = get(f"https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/us-gaap/{tag}.json")
        except RuntimeError as e:
            if "HTTP 404" in str(e):
                continue
            raise
        for f in (j.get("units") or {}).get("shares", []):
            if not quarterly:
                by_end[f["end"]] = f["val"]
            elif f.get("start") and 80 <= (date.fromisoformat(f["end"]) - date.fromisoformat(f["start"])).days <= 100:
                by_end[f["end"]] = f["val"]
    return sorted(by_end.items())


def _at(hist, day):
    best = None
    for end, val in hist:
        if end <= day or best is None:
            best = val
    return best


# Managers that file under several legal entities are shown as one name, so an internal transfer between
# them (T. Rowe Price Associates -> T. Rowe Price Investment Management) doesn't show up as a buyer and a seller.
MANAGER_GROUPS = [
    ("T. ROWE PRICE", "T. Rowe Price"), ("PRICE T ROWE", "T. Rowe Price"),
    ("VANGUARD", "Vanguard"), ("BLACKROCK", "BlackRock"), ("STATE STREET", "State Street"),
    ("FMR LLC", "Fidelity (FMR)"), ("FIDELITY", "Fidelity (FMR)"), ("GEODE CAPITAL", "Geode Capital"),
    ("CAPITAL RESEARCH", "Capital Group"), ("CAPITAL INTERNATIONAL", "Capital Group"), ("CAPITAL WORLD", "Capital Group"),
    ("JPMORGAN", "JPMorgan Chase"), ("J P MORGAN", "JPMorgan Chase"), ("MORGAN STANLEY", "Morgan Stanley"),
    ("GOLDMAN SACHS", "Goldman Sachs"), ("WELLS FARGO", "Wells Fargo"), ("UBS ", "UBS"), ("INVESCO", "Invesco"),
    ("NORTHERN TRUST", "Northern Trust"), ("DIMENSIONAL", "Dimensional"), ("WELLINGTON", "Wellington"),
]
_SMALL = {"Llc": "LLC", "Llp": "LLP", "Lllp": "LLLP", "Pllc": "PLLC", "Lp": "LP", "L.P.": "LP", "Inc": "Inc.", "Inc.": "Inc.", "Ltd": "Ltd.",
          "Co": "Co.", "Corp": "Corp.", "N.A.": "N.A.", "Na": "N.A.", "Plc": "PLC", "Ag": "AG", "Gmbh": "GmbH", "Sa": "SA", "Nv": "NV", "Ab": "AB",
          "Asa": "ASA", "Se": "SE", "Sarl": "SARL", "Gp": "GP", "Fmr": "FMR", "Ubs": "UBS", "Bny": "BNY", "Jpmorgan": "JPMorgan",
          "Blackrock": "BlackRock", "Aqr": "AQR", "Ii": "II", "Iii": "III", "Iv": "IV", "Alliancebernstein": "AllianceBernstein",
          "Cloudalpha": "CloudAlpha", "Kkr": "KKR", "Tpg": "TPG", "Tcw": "TCW", "Mfs": "MFS", "Pnc": "PNC", "Hsbc": "HSBC", "Cibc": "CIBC",
          "Rbc": "RBC", "Bmo": "BMO", "Td": "TD", "Bnp": "BNP", "Abn": "ABN", "Amro": "AMRO", "Dnb": "DNB", "Ing": "ING", "Axa": "AXA",
          "Aig": "AIG", "Dws": "DWS", "Pimco": "PIMCO", "Lpl": "LPL", "Mml": "MML", "Hrt": "HRT", "Ark": "ARK", "Ssga": "SSGA", "Sei": "SEI"}
_LOWER_WORDS = {"Of", "And", "The", "For", "In", "De", "Du", "La", "Van", "Von", "Der", "Den", "Y", "E", "Et", "El", "Del", "Da", "Di"}


def pretty_manager(raw):
    """Readable manager name: drop SEC state suffixes (/Md/, /Adv), fix the casing title() gets wrong
    (LLP, HRT, UBS, "Bank of America"). Anything with no vowels and four letters or fewer is an acronym."""
    n = re.sub(r"\s*/[A-Za-z]{2,4}/?\s*$", "", str(raw or "").strip())
    n = re.sub(r"\s+", " ", n).strip(" ,")
    words = []
    for i, w in enumerate(n.title().split(" ")):
        comma = w.endswith(",")
        core = w.rstrip(",")
        bare = core.strip("()")
        if core in _SMALL:
            core = _SMALL[core]
        elif bare in _SMALL:
            core = core.replace(bare, _SMALL[bare])
        elif i and core in _LOWER_WORDS:
            core = core.lower()
        elif re.fullmatch(r"[A-Za-z]{1,4}", bare) and not re.search(r"[AEIOUYaeiouy]", bare):
            core = core.replace(bare, bare.upper())
        words.append(core + ("," if comma else ""))
    return " ".join(words).replace(", Inc.", " Inc.").replace(" Inc.,", " Inc.")


@lru_cache(maxsize=None)
def manager_group(raw):
    up = " " + str(raw or "").upper() + " "
    for key, label in MANAGER_GROUPS:
        if " " + key in up:
            return label
    return pretty_manager(raw)


def active_movers(delta, passive_grp, dprv, dcur, n=5):
    """Top buyers and sellers among actively managed holders: the big index families are left out, because an index
    fund moves with its benchmark and fund flows, not with a view on the company, so it cannot be persuaded.
    (13F filings do not label funds, so "active" here means every manager outside those index families.)"""
    act = {g: d for g, d in delta.items() if g not in passive_grp}

    def mover(g, d):
        note = "New position" if not dprv.get(g) else ("Sold out" if not dcur.get(g) else f"{'Added' if d > 0 else 'Cut'} {abs(d / dprv[g] * 100):.0f}%")
        return {"n": g, "sh": d, "note": note}
    buy = sorted(((g, d) for g, d in act.items() if d > 0), key=lambda x: -x[1])[:n]
    sell = sorted(((g, d) for g, d in act.items() if d < 0), key=lambda x: x[1])[:n]
    return [mover(g, d) for g, d in buy], [mover(g, d) for g, d in sell]


def passive_trend(by_period, periods, so_at, cap=0.3):
    """Index-fund holdings of one stock in each quarter: [{p, sh, pct}]. by_period: {period: {cik: shares}} for the
    index-family filers only. A single filer above `cap` of shares outstanding is a data error and is dropped, as in the
    main table. Quarters with no share count get a share total but no percentage."""
    out = []
    for p in periods:
        so = so_at(p)
        pos = by_period.get(p, {})
        if so:
            pos = {c: v for c, v in pos.items() if v <= cap * so}
        tot = float(sum(pos.values()))
        out.append({"p": p, "sh": tot, "pct": r(tot / so * 100, 1) if so and tot else (0.0 if so else None)})
    return out


def ir_extras(delta, dcur, dprv, passive_grp):
    """Who drove the quarter: net buying split into index funds and everyone else, and how much of the
    comparable holders' position changed hands (gross change over average holdings)."""
    idx = sum(d for g, d in delta.items() if g in passive_grp)
    net = sum(delta.values())
    gross = sum(abs(d) for d in delta.values())
    base = (sum(dcur.values()) + sum(dprv.values())) / 2
    return {"index": idx, "active": net - idx, "gross": gross, "turnover": r(gross / base * 100, 1) if base else None}


def peer_targets(holders, peer_sets, passive, n=10):
    """Managers who own many of a stock's sector peers but none of the stock: the classic IR target list.
    holders: groups owning the stock; peer_sets: one set of groups per peer; passive: index-fund groups (excluded,
    they own everything by rule). A manager needs at least 3 peers, and 40% of them, to count."""
    if len(peer_sets) < 5:
        return []
    cnt = Counter()
    for gs in peer_sets:
        cnt.update(gs)
    need = max(3, int(0.4 * len(peer_sets) + 0.999))
    hits = [(g, k) for g, k in cnt.items() if k >= need and g not in holders and g not in passive]
    hits.sort(key=lambda x: (-x[1], x[0]))
    return [{"n": g, "peers": k, "of": len(peer_sets)} for g, k in hits[:n]]


def comparable_filers(det, L, P):
    """Managers whose two filings can be compared position by position.

    A manager that filed in only one of the quarters, or whose filing in one quarter lists far fewer stocks
    than the other (a partial or mis-keyed filing), makes every holding look like a new position or a sale.
    Those managers still count as holders, but are left out of buying/selling, net flow and "New position" labels."""
    cl = det[det["period"] == L].groupby("cik").size().to_dict()
    cp = det[det["period"] == P].groupby("cik").size().to_dict()
    ok = set()
    for c in set(cl) & set(cp):
        a, b = cl[c], cp[c]
        if min(a, b) >= 0.5 * max(a, b) or abs(a - b) < 10:
            ok.add(int(c))
    return ok


def build(max_sets=9, force=False):
    links = sec.dataset_links()[:max_sets]
    old = read("ownership/index.json", {}) or {}
    newest = links[0].rsplit("/", 1)[-1]
    if not force and old.get("v") == VERSION and old.get("latestSet") == newest:
        record("13F build", True, note=f"skipped: no new data set since {newest}")
        return old
    universe = CONFIG["universe"]
    core = {v["cusip"].upper(): k for k, v in universe.items() if v.get("cusip")}
    idx_kw = [k.upper() for k in CONFIG.get("index_managers", [])]
    with tempfile.TemporaryDirectory() as tmp:
        paths = _download(links, tmp)
        if not paths:
            raise RuntimeError("no 13F data sets downloaded")
        win, mgr = _submissions(paths)
        filers = win.groupby("period")["cik"].apply(set).to_dict()
        big = max(len(s) for s in filers.values())
        periods = sorted(p for p, s in filers.items() if len(s) >= 0.6 * big)[-8:]
        L, P = periods[-1], periods[-2]
        record("13F periods", True, n=len(periods), note=", ".join(periods))
        pcik = sorted(int(c) for c, nm in mgr.items() if any(k in (nm or "").upper() for k in idx_kw))
        agg, det, issuers, dropped = _holdings(paths, win[win["period"].isin(periods)], [L, P], pcik)
        record("13F index-family filers", True, n=len(pcik))
    record("13F rows dropped (bad units)", True, n=dropped)
    latest = agg[agg["period"] == L]
    wanted = set(latest.loc[latest["holders"] >= MIN_HOLDERS, "cusip"]) | set(core)
    figi = _figi(sorted(wanted - set(core)))
    tick = sec.tickers()
    sym_of = {cu: core.get(cu) or figi.get(cu) for cu in wanted}
    sym_of = {cu: s for cu, s in sym_of.items() if s}
    # one page per ticker: if two CUSIPs map to one ticker, keep the more widely held
    held = dict(zip(latest["cusip"], latest["holders"]))
    best = {}
    for cu, s in sym_of.items():
        if s not in best or held.get(cu, 0) > held.get(best[s], 0) or cu in core:
            best[s] = cu
    record("13F tickers", True, n=len(best), note=f"{len(wanted)} CUSIPs with {MIN_HOLDERS}+ holders, {len(best)} matched to tickers")

    # shares outstanding, threaded but paced to SEC's limit by net.get
    ciks = {s: tick[s][0] for s in best if s in tick}
    errs = Counter()

    def fetch(c):
        try:
            return _shares_history(c)
        except Exception as e:  # noqa: BLE001
            errs[str(e)[:60]] += 1
            return None
    with ThreadPoolExecutor(4) as ex:
        hist = dict(zip(ciks, ex.map(fetch, ciks.values())))
    retry = [s for s, h in hist.items() if h is None]
    if retry:  # second, slower pass for anything that errored (rate limits, timeouts)
        time.sleep(30)
        netmod._dead.clear()
        for s in retry:
            hist[s] = fetch(ciks[s])
            time.sleep(0.2)
    # multi-class filers: the cover page may list only the smaller class, making 13F holdings look
    # like 150%+ of shares. Use the all-class weighted-average count for those instead.
    tot_latest = dict(zip(latest["cusip"], latest["shares"]))
    swapped = []
    for s, h in list(hist.items()):
        so = _at(h or [], L)
        if so and tot_latest.get(best[s], 0) > 1.5 * so:
            h2 = None
            try:
                h2 = _shares_history(ciks[s], skip_cover=True)
            except Exception as e:  # noqa: BLE001
                errs[str(e)[:60]] += 1
            if h2 and tot_latest.get(best[s], 0) <= 1.5 * (_at(h2, L) or 0):
                hist[s] = h2
                swapped.append(s)
    record("13F share count swapped to all-class", True, n=len(swapped), note=str(swapped[:20]))
    record("13F shares outstanding", True, n=sum(1 for h in hist.values() if h),
           note=f"{len(ciks)} companies queried, {len(retry)} retried; errors: {dict(errs.most_common(4))}")

    agg_ix = agg.set_index(["cusip", "period"])
    comp = comparable_filers(det, L, P)
    record("13F comparable managers", True, n=len(comp), note=f"of {len(filers.get(L, set()))} filing in {L}")
    pas_det = det[det["cik"].isin(pcik)]
    pas_all = {k: grp[["period", "cik", "sh"]] for k, grp in pas_det.groupby("cusip")}
    cur_all = det[det["period"] == L].groupby("cusip")
    prv_all = det[det["period"] == P].groupby("cusip")
    empty = pd.DataFrame(columns=["cik", "sh"])
    diag = {"over150": [], "noShares": [], "bigNew": []}
    stale_before = (date.fromisoformat(L) - timedelta(days=548)).isoformat()
    done_core, all_syms, n_ok = [], [], 0
    # sector peers for the IR target list: index members only (they carry a sector), most widely held first
    sectors = (read("members.json", {}) or {}).get("sectors") or {}
    by_sector = {}
    for s2, cu2 in best.items():
        if sectors.get(s2):
            by_sector.setdefault(sectors[s2], []).append((held.get(cu2, 0), s2))
    for v in by_sector.values():
        v.sort(reverse=True)
    passive_all = {manager_group(mgr.get(c) or f"CIK {c}") for c in mgr if any(k in (mgr.get(c) or "").upper() for k in idx_kw)}
    _gsets = {}

    def group_set(cu2):
        if cu2 not in _gsets:
            df = cur_all.get_group(cu2) if cu2 in cur_all.groups else empty
            _gsets[cu2] = {manager_group(mgr.get(int(c)) or f"CIK {int(c)}") for c in df["cik"]}
        return _gsets[cu2]
    for sym, cu in sorted(best.items()):
        if not held.get(cu):
            continue
        try:
            q = read(f"quotes/{sym}.json") or {}
            class_so = (q.get("stats") or {}).get("shares") if universe.get(sym, {}).get("shareClass") else None
            h = hist.get(sym) or []
            if h and h[-1][0] < stale_before:  # filer stopped using the standard tag: don't trust an old count
                h = []

            def so_at(p):
                return class_so or _at(h, p)
            trend = []
            for p in periods:
                row = agg_ix.loc[(cu, p)] if (cu, p) in agg_ix.index else None
                tot, n = (float(row["shares"]), int(row["holders"])) if row is not None else (0.0, 0)
                so = so_at(p)
                trend.append({"p": p, "inst": r(tot / so * 100, 1) if so else None, "holders": n, "shares": tot, "so": so})
            # a share count that makes ownership look impossible is the wrong class or unit: don't show that %
            for t in trend:
                if (t["inst"] or 0) > 150:
                    diag["over150"].append(f"{sym}:{t['p'][:7]}:{t['so']:.0f}:{t['shares']:.0f}")
                    t["inst"], t["so"] = None, None
            if not h and not class_so:
                diag["noShares"].append(sym if sym in ciks else f"{sym}(no CIK)")
            so = trend[-1]["so"]
            cur_df = cur_all.get_group(cu) if cu in cur_all.groups else empty
            prv_df = prv_all.get_group(cu) if cu in prv_all.groups else empty
            cur = dict(zip(cur_df["cik"].astype(int), cur_df["sh"]))
            prv = dict(zip(prv_df["cik"].astype(int), prv_df["sh"]))
            if so:  # no single 13F filer holds 30% of a widely held stock: a data-entry error
                cur = {c: v for c, v in cur.items() if v <= 0.3 * so}
                prv = {c: v for c, v in prv.items() if v <= 0.3 * so}
            # latest two quarters: use the screened per-manager positions so the trend matches the tables
            for t, pos in ((trend[-1], cur), (trend[-2], prv)):
                if t["so"] is None:
                    t["shares"], t["holders"] = float(sum(pos.values())), len(pos)
                    continue
                t["shares"], t["holders"] = float(sum(pos.values())), len(pos)
                t["inst"] = r(t["shares"] / t["so"] * 100, 1) if t["so"] else None
            # holders: every manager. New/closed are plain set differences, so holders change = new - closed.
            new = [c for c in cur if c not in prv]
            closed = [c for c in prv if c not in cur]
            px = (q.get("quote") or {}).get("price")
            # top holders and movers are grouped by manager family (several legal entities, one firm)
            grp_cur, grp_prv, grp_names = {}, {}, {}
            for c, v in cur.items():
                g = manager_group(mgr.get(c) or f"CIK {c}")
                grp_cur[g] = grp_cur.get(g, 0) + v
                grp_names.setdefault(g, []).append(c)
            for c, v in prv.items():
                g = manager_group(mgr.get(c) or f"CIK {c}")
                grp_prv[g] = grp_prv.get(g, 0) + v
                grp_names.setdefault(g, []).append(c)
            passive_of = lambda c: any(k in (mgr.get(c) or "").upper() for k in idx_kw)  # noqa: E731
            passive_grp = {g for g, cs in grp_names.items() if any(passive_of(c) for c in cs)}
            top = sorted(grp_cur.items(), key=lambda kv: -kv[1])[:10]
            top_rows = [{"n": g, "style": "Index" if g in passive_grp else "Active / other", "sh": sh,
                         "pct": r(sh / so * 100, 2) if so else None, "val": r(sh * px, 0) if px else None,
                         "chg": (r((sh / grp_prv[g] - 1) * 100, 1) if grp_prv.get(g)
                                 else "New" if any(c in comp for c in grp_names[g]) else None)} for g, sh in top]
            # buying and selling: only managers whose two filings are comparable
            dcur, dprv = {}, {}
            for c in set(cur) | set(prv):
                if c not in comp:
                    continue
                g = manager_group(mgr.get(c) or f"CIK {c}")
                dcur[g] = dcur.get(g, 0) + cur.get(c, 0)
                dprv[g] = dprv.get(g, 0) + prv.get(c, 0)
            delta = {g: dcur[g] - dprv[g] for g in dcur}
            # A brand-new (or fully sold) stake above 0.5% of a widely held stock is almost always a filing gap
            # (a quarter missing from the data), not a real trade: AAPL showed JPMorgan "new" with $79B.
            if so and len(cur) >= 1000:
                for g in [g for g, d in delta.items() if (not dprv[g] or not dcur[g]) and abs(d) > 0.005 * so]:
                    diag["bigNew"].append(f"{sym}:{g}")
                    del delta[g]
            buyers = sorted(((g, d) for g, d in delta.items() if d > 0), key=lambda x: -x[1])[:5]
            sellers = sorted(((g, d) for g, d in delta.items() if d < 0), key=lambda x: x[1])[:5]
            buyers_a, sellers_a = active_movers(delta, passive_grp, dprv, dcur)

            def mover(g, d):
                note = "New position" if not dprv.get(g) else ("Sold out" if not dcur.get(g) else f"{'Added' if d > 0 else 'Cut'} {abs(d / dprv[g] * 100):.0f}%")
                return {"n": g, "sh": d, "note": note}
            passive = sum(v for c, v in cur.items() if passive_of(c))
            inst, inst0 = trend[-1]["inst"], trend[-2]["inst"]
            net = sum(delta.values())
            hold, hold0 = len(cur), len(prv)
            mood = "added to" if net > 0 else "trimmed"
            read_txt = (f"Institutions {mood} {sym} last quarter: {abs(net) / 1e6:.1f}M shares net among managers that filed both "
                        f"quarters. {len(new)} managers opened a position and {len(closed)} closed one.")
            if so:
                read_txt += f" Index funds hold {passive / so * 100:.1f}% of shares outstanding."
            out = {"sym": sym, "name": q.get("name") or (tick.get(sym) or (None, issuers.get(cu) or sym))[1], "cusip": cu,
                   "issuer13f": issuers.get(cu), "period": L, "prior": P, "updated": now_iso(), "so": so, "price": px,
                   "tiles": {"inst": inst, "instChg": r(inst - inst0, 1) if inst is not None and inst0 is not None else None,
                             "holders": hold, "holdersChg": hold - hold0, "net": net, "new": len(new), "closed": len(closed),
                             "top10": r(sum(sh for _, sh in top) / so * 100, 1) if so else None,
                             "passive": r(passive / so * 100, 1) if so else None},
                   "trend": trend, "top": top_rows, "buyers": [mover(g, d) for g, d in buyers], "sellers": [mover(g, d) for g, d in sellers],
                   "buyersActive": buyers_a, "sellersActive": sellers_a,
                   "mix": {"Index": r(passive / so * 100, 1) if so else None,
                           "Active / other": r((sum(cur.values()) - passive) / so * 100, 1) if so else None},
                   "read": read_txt}
            try:  # IR view extras never block the base page
                # IR view extras: top 25, who drove the quarter, and managers to approach
                top25 = sorted(grp_cur.items(), key=lambda kv: -kv[1])[:25]
                out["top25"] = [{"n": g, "style": "Index" if g in passive_grp else "Active / other", "sh": sh,
                                 "pct": r(sh / so * 100, 2) if so else None, "val": r(sh * px, 0) if px else None,
                                 "chg": (r((sh / grp_prv[g] - 1) * 100, 1) if grp_prv.get(g)
                                         else "New" if any(c in comp for c in grp_names[g]) else None),
                                 "dsh": (sh - grp_prv.get(g, 0)) if g in dcur else None} for g, sh in top25]
                out["tiles"]["top25"] = r(sum(sh for _, sh in top25) / so * 100, 1) if so else None
                out["flows"] = ir_extras(delta, dcur, dprv, passive_grp)
                # index-fund trend: the families' share of the company, quarter by quarter, and who moved this quarter
                by_p = {}
                rows_p = pas_all.get(cu)
                if rows_p is not None:
                    for pp, cc, sh in zip(rows_p["period"], rows_p["cik"], rows_p["sh"]):
                        by_p.setdefault(pp, {})[int(cc)] = float(sh)
                ptr = passive_trend(by_p, periods, so_at)
                fams = [{"n": g, "sh": sh, "pct": r(sh / so * 100, 2) if so else None,
                         "dsh": (sh - grp_prv.get(g, 0)) if g in dcur else None,
                         "chg": (r((sh / grp_prv[g] - 1) * 100, 1) if grp_prv.get(g) and g in dcur else None)}
                        for g, sh in sorted(grp_cur.items(), key=lambda kv: -kv[1]) if g in passive_grp][:5]
                out["passive"] = {"trend": ptr, "families": fams, "net": out["flows"]["index"],
                                  "netPct": r(out["flows"]["index"] / so * 100, 2) if so else None}
                sec_name = sectors.get(sym)
                if sec_name:
                    peers = [s2 for _, s2 in by_sector.get(sec_name, []) if s2 != sym][:25]
                    out["sector"] = sec_name
                    out["peers"] = peers
                    out["targets"] = peer_targets(set(grp_cur), [group_set(best[s2]) for s2 in peers], passive_all)
            except Exception as e:  # noqa: BLE001
                diag.setdefault("irErr", []).append(f"{sym}:{type(e).__name__}:{str(e)[:60]}")
            write(f"ownership/{sym}.json", out)
            all_syms.append(sym)
            n_ok += 1
            if sym in universe:
                done_core.append({"sym": sym, "name": out["name"], "issuer13f": issuers.get(cu), "inst": inst})
                record(f"13F {sym}", True, n=hold, note=f"cusip {cu} = {issuers.get(cu)}")
        except Exception as e:  # noqa: BLE001
            record(f"13F {sym}", False, error=f"{type(e).__name__}: {str(e)[:200]}")
    record("13F pages written", True, n=n_ok)
    record("13F IR extras failed", not diag.get("irErr"), n=len(diag.get("irErr", [])), note=str(diag.get("irErr", [])[:10]))
    with_cik = [x for x in diag["noShares"] if "(no CIK)" not in x]
    record("13F no share count", True, n=len(diag["noShares"]),
           note=f"{len(with_cik)} with an SEC CIK, e.g. {with_cik[:15]}")
    record("13F implausible share count", True, n=len(diag["over150"]), note=str(diag["over150"][:15]))
    record("13F implausible new/closed stakes skipped", True, n=len(diag["bigNew"]), note=str(diag["bigNew"][:15]))
    index = {"updated": now_iso(), "v": VERSION, "latestSet": newest, "periods": periods,
             "tickers": sorted(done_core, key=lambda x: list(universe).index(x["sym"])), "all": sorted(all_syms)}
    write("ownership/index.json", index)
    return index
