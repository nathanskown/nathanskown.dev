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
import os
import pathlib
import tempfile
import time
import zipfile
from datetime import date
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from . import net as netmod
from . import src_sec as sec
from .net import CONFIG, attempt, get, now_iso, post_json, r, read, record, write

VERSION = 8          # bump when this logic changes so the next push rebuilds ownership
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
    frames, names = [], {}
    for path in paths:
        with zipfile.ZipFile(path) as zf:
            s = _tsv(zf, "SUBMISSION.TSV", ["ACCESSION_NUMBER", "SUBMISSIONTYPE", "PERIODOFREPORT", "FILING_DATE", "CIK"])
            s = s[s["SUBMISSIONTYPE"].str.upper() == "13F-HR"].copy()
            s["period"] = pd.to_datetime(s["PERIODOFREPORT"], format="%d-%b-%Y", errors="coerce").dt.strftime("%Y-%m-%d")
            s["filed"] = pd.to_datetime(s["FILING_DATE"], format="%d-%b-%Y", errors="coerce").dt.strftime("%Y-%m-%d")
            s["cik"] = pd.to_numeric(s["CIK"], errors="coerce")
            frames.append(s.dropna(subset=["period", "filed", "cik"])[["ACCESSION_NUMBER", "cik", "period", "filed"]])
            c = _tsv(zf, "COVERPAGE.TSV", ["ACCESSION_NUMBER", "FILINGMANAGER_NAME"])
            names.update(zip(c["ACCESSION_NUMBER"], c["FILINGMANAGER_NAME"]))
    subs = pd.concat(frames, ignore_index=True).drop_duplicates("ACCESSION_NUMBER")
    subs["cik"] = subs["cik"].astype("int64")
    # the latest filing for each manager and quarter wins (restatements replace originals)
    win = subs.sort_values("filed").drop_duplicates(["cik", "period"], keep="last")
    mgr = {}
    for acc, cik in zip(win["ACCESSION_NUMBER"], win["cik"]):
        if names.get(acc):
            mgr[int(cik)] = names[acc]
    return win, mgr


def _holdings(paths, win, detail_periods):
    """-> (agg: period,cusip -> holders, shares), detail rows for detail_periods, issuer names, dropped count."""
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
        details.append(pos[pos["period"].isin(detail_periods)])
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


def _shares_history(cik):
    """[(end, shares)]: the cover-page share count (largest class when several are reported); companies that
    only report it by share class fall back to balance-sheet or weighted-average share counts."""
    by_end = {}
    try:
        j = get(f"https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/dei/EntityCommonStockSharesOutstanding.json")
        for f in (j.get("units") or {}).get("shares", []):
            by_end[f["end"]] = max(by_end.get(f["end"], 0), f["val"])
    except RuntimeError as e:  # 404: tag not reported without a class dimension; anything else is retried
        if "HTTP 404" not in str(e):
            raise
    # fallbacks, best first: balance-sheet shares outstanding, then quarterly weighted-average shares
    for tag, quarterly in (("CommonStockSharesOutstanding", False), ("WeightedAverageNumberOfDilutedSharesOutstanding", True),
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
        agg, det, issuers, dropped = _holdings(paths, win[win["period"].isin(periods)], [L, P])
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
    record("13F shares outstanding", True, n=sum(1 for h in hist.values() if h),
           note=f"{len(ciks)} companies queried, {len(retry)} retried; errors: {dict(errs.most_common(4))}")

    agg_ix = agg.set_index(["cusip", "period"])
    cur_all = det[det["period"] == L].groupby("cusip")
    prv_all = det[det["period"] == P].groupby("cusip")
    empty = pd.DataFrame(columns=["cik", "sh"])
    diag = {"over150": [], "noShares": []}
    done_core, all_syms, n_ok = [], [], 0
    for sym, cu in sorted(best.items()):
        if not held.get(cu):
            continue
        try:
            q = read(f"quotes/{sym}.json") or {}
            class_so = (q.get("stats") or {}).get("shares") if universe.get(sym, {}).get("shareClass") else None
            h = hist.get(sym) or []

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
            fl, fp = filers.get(L, set()), filers.get(P, set())
            new = [c for c in cur if c not in prv and c in fp]
            closed = [c for c in prv if c not in cur and c in fl]
            px = (q.get("quote") or {}).get("price")
            top = sorted(cur.items(), key=lambda kv: -kv[1])[:10]
            name = lambda c: (mgr.get(c) or f"CIK {c}").title()  # noqa: E731
            passive_of = lambda c: any(k in (mgr.get(c) or "").upper() for k in idx_kw)  # noqa: E731
            top_rows = [{"n": name(c), "style": "Index" if passive_of(c) else "Active / other", "sh": sh,
                         "pct": r(sh / so * 100, 2) if so else None, "val": r(sh * px, 0) if px else None,
                         "chg": "New" if c not in prv else r((sh / prv[c] - 1) * 100 if prv[c] else None, 1)} for c, sh in top]
            delta = {c: cur.get(c, 0) - prv.get(c, 0) for c in set(cur) | set(prv) if c in fl and c in fp}
            buyers = sorted(((c, d) for c, d in delta.items() if d > 0), key=lambda x: -x[1])[:5]
            sellers = sorted(((c, d) for c, d in delta.items() if d < 0), key=lambda x: x[1])[:5]

            def mover(c, d):
                note = "New position" if c not in prv else ("Sold out" if c not in cur else f"{'Added' if d > 0 else 'Cut'} {abs(d / prv[c] * 100):.0f}%")
                return {"n": name(c), "sh": d, "note": note}
            passive = sum(v for c, v in cur.items() if passive_of(c))
            inst, inst0 = trend[-1]["inst"], trend[-2]["inst"]
            net = sum(cur.values()) - sum(prv.values())
            hold, hold0 = len(cur), len(prv)
            mood = "added to" if net > 0 else "trimmed"
            read_txt = f"Institutions {mood} {sym} last quarter: {abs(net) / 1e6:.1f}M shares net, {len(new)} new positions vs {len(closed)} closed."
            if so:
                read_txt += f" Index funds hold {passive / so * 100:.1f}% of shares outstanding."
            out = {"sym": sym, "name": q.get("name") or (tick.get(sym) or (None, issuers.get(cu) or sym))[1], "cusip": cu,
                   "issuer13f": issuers.get(cu), "period": L, "prior": P, "updated": now_iso(), "so": so, "price": px,
                   "tiles": {"inst": inst, "instChg": r(inst - inst0, 1) if inst is not None and inst0 is not None else None,
                             "holders": hold, "holdersChg": hold - hold0, "net": net, "new": len(new), "closed": len(closed),
                             "top10": r(sum(sh for _, sh in top) / so * 100, 1) if so else None,
                             "passive": r(passive / so * 100, 1) if so else None},
                   "trend": trend, "top": top_rows, "buyers": [mover(c, d) for c, d in buyers], "sellers": [mover(c, d) for c, d in sellers],
                   "mix": {"Index": r(passive / so * 100, 1) if so else None,
                           "Active / other": r((sum(cur.values()) - passive) / so * 100, 1) if so else None},
                   "read": read_txt}
            write(f"ownership/{sym}.json", out)
            all_syms.append(sym)
            n_ok += 1
            if sym in universe:
                done_core.append({"sym": sym, "name": out["name"], "issuer13f": issuers.get(cu), "inst": inst})
                record(f"13F {sym}", True, n=hold, note=f"cusip {cu} = {issuers.get(cu)}")
        except Exception as e:  # noqa: BLE001
            record(f"13F {sym}", False, error=f"{type(e).__name__}: {str(e)[:200]}")
    record("13F pages written", True, n=n_ok)
    with_cik = [x for x in diag["noShares"] if "(no CIK)" not in x]
    record("13F no share count", True, n=len(diag["noShares"]),
           note=f"{len(with_cik)} with an SEC CIK, e.g. {with_cik[:15]}")
    record("13F implausible share count", True, n=len(diag["over150"]), note=str(diag["over150"][:15]))
    index = {"updated": now_iso(), "v": VERSION, "latestSet": newest, "periods": periods,
             "tickers": sorted(done_core, key=lambda x: list(universe).index(x["sym"])), "all": sorted(all_syms)}
    write("ownership/index.json", index)
    return index


def attempt_quiet(fn, *args):
    try:
        return fn(*args)
    except Exception:  # noqa: BLE001 - a company without the cover-page tag just has no share count
        return []
