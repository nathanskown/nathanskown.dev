// On-demand quote data for any US-listed ticker, served at /api/quote.
//   /api/quote?part=price&sym=AAPL           Yahoo prices, charts, stats, news       (cached 15 min)
//   /api/quote?part=fin&cik=320193           SEC XBRL quarterly financials, shares   (cached 12 h)
//   /api/quote?part=filings&cik=320193       SEC Form 4, 13D/G, 8-K                   (cached 1 h)
// The quote page calls all three in parallel and assembles the same shape the nightly
// pipeline writes for the core tickers. Three small calls keep each one inside the
// free plan's per-request limits (CPU time and 50 outbound requests).

const SEC_UA = "nathanskown.dev finance data bot skownclaude@agentmail.to";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const YAHOO = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const TTL = { price: 900, fin: 43200, filings: 3600 };

const r = (v, d = 2) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
const json = (obj, status = 200, ttl = 0) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": ttl ? `public, max-age=${ttl}` : "no-store",
      "access-control-allow-origin": "*",
    },
  });

async function getUp(url, { kind = "json", sec = false, cacheTtl = 0, timeout = 12000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const init = {
      headers: sec
        ? { "User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate" }
        : { "User-Agent": BROWSER_UA, Accept: "*/*", "Accept-Language": "en-US,en;q=0.9" },
      signal: ctl.signal,
    };
    if (cacheTtl) init.cf = { cacheTtl, cacheEverything: true };
    const res = await fetch(url, init);
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${url.slice(0, 100)}`);
      err.status = res.status;
      throw err;
    }
    return kind === "json" ? await res.json() : await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// run async jobs with limited concurrency (SEC asks for <= 10 requests a second)
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------- prices (Yahoo)
async function chart(sym, range, interval, events) {
  let last;
  for (const base of YAHOO) {
    try {
      const q = new URLSearchParams({ range, interval, includePrePost: "false" });
      if (events) q.set("events", events);
      const j = await getUp(`${base}/v8/finance/chart/${encodeURIComponent(sym)}?${q}`);
      const res = ((j.chart || {}).result || [])[0];
      if (!res) throw new Error(`no chart result for ${sym}`);
      const qt = ((res.indicators || {}).quote || [{}])[0];
      const t = [], c = [], v = [];
      (res.timestamp || []).forEach((ts, k) => {
        const close = (qt.close || [])[k];
        if (close === null || close === undefined) return;
        t.push(ts); c.push(close); v.push((qt.volume || [])[k] || 0);
      });
      const div = {};
      Object.values(((res.events || {}).dividends) || {}).forEach((d) => { div[d.date] = d.amount; });
      return { meta: res.meta || {}, t, c, v, div };
    } catch (e) { last = e; }
  }
  throw last;
}

function sliceSince(t, c, since) {
  let i = t.findIndex((x) => x >= since);
  if (i < 0) i = t.length;
  return [t.slice(i), c.slice(i)];
}

function rssItems(xml) {
  const clean = (s) => (s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ").trim();
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (name) => { const x = m[1].match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return x ? clean(x[1]) : ""; };
    const pub = tag("pubDate");
    const d = pub ? new Date(pub) : null;
    const item = { title: tag("title"), link: tag("link"), published: d && !isNaN(d) ? d.toISOString().replace(/\.\d{3}Z$/, "+00:00") : null };
    if (item.title && item.link) out.push(item);
  }
  return out;
}

async function partPrice(sym) {
  const [d1, d5, y5, spx, news] = await Promise.allSettled([
    chart(sym, "1d", "5m"), chart(sym, "5d", "30m"), chart(sym, "5y", "1d", "div"), chart("^GSPC", "5y", "1wk"),
    getUp(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=US&lang=en-US`, { kind: "text" }),
  ]);
  if (d1.status !== "fulfilled") throw new Error(`price unavailable: ${d1.reason && d1.reason.message}`);
  const m = d1.value.meta;
  const price = m.regularMarketPrice ?? d1.value.c[d1.value.c.length - 1] ?? null;
  const prev = m.chartPreviousClose ?? m.previousClose ?? null;
  const chg = price !== null && prev ? price - prev : null;
  const quote = {
    price: r(price, 4), prev: r(prev, 4), chg: r(chg, 4), pct: chg !== null && prev ? r((chg / prev) * 100, 3) : null,
    time: m.regularMarketTime ?? null, currency: m.currency ?? null, hi52: r(m.fiftyTwoWeekHigh, 4), lo52: r(m.fiftyTwoWeekLow, 4),
    name: m.longName || m.shortName || null, exch: m.fullExchangeName || m.exchangeName || null, type: m.instrumentType || null,
  };
  const pack = (t, c, step = 1) => ({ t: t.filter((_, k) => k % step === 0), c: c.filter((_, k) => k % step === 0).map((x) => r(x, 3)) });
  const charts = { "1D": pack(d1.value.t, d1.value.c) };
  if (d5.status === "fulfilled") charts["5D"] = pack(d5.value.t, d5.value.c);
  const stats = { hi52: quote.hi52, lo52: quote.lo52, divYield: 0, avgVol3m: null, beta: null };
  let ytd = null, y1 = null;
  if (y5.status === "fulfilled") {
    const { t, c, v, div } = y5.value;
    const now = Date.now() / 1000;
    const yearStart = Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000;
    for (const [key, days] of [["1M", 31], ["6M", 183], ["1Y", 366]]) charts[key] = pack(...sliceSince(t, c, now - days * 86400));
    charts.YTD = pack(...sliceSince(t, c, yearStart));
    charts["5Y"] = pack(t, c, 5);
    const k0 = t.findIndex((x) => x >= yearStart);
    const priorClose = k0 > 0 ? c[k0 - 1] : null;
    if (price && priorClose) ytd = (price / priorClose - 1) * 100;
    const [, c1] = sliceSince(t, c, now - 365 * 86400);
    if (c1.length && price) y1 = (price / c1[0] - 1) * 100;
    const divTtm = Object.entries(div).filter(([ts]) => +ts >= now - 365 * 86400).reduce((a, [, x]) => a + x, 0);
    stats.divYield = price && divTtm ? r((divTtm / price) * 100, 2) : 0;
    const vols = v.slice(-63).filter(Boolean);
    stats.avgVol3m = vols.length ? r(vols.reduce((a, x) => a + x, 0) / vols.length, 0) : null;
    if (spx.status === "fulfilled" && t.length > 300) {
      // weekly returns vs the S&P 500 over 5 years
      const sp = spx.value;
      const wk = [];
      for (let k = 0; k < t.length; k += 5) wk.push([t[k], c[k]]);
      const near = (ts) => { let best = 0; for (let j = 1; j < sp.t.length; j++) if (Math.abs(sp.t[j] - ts) < Math.abs(sp.t[best] - ts)) best = j; return best; };
      const pairs = [];
      for (let k = 1; k < wk.length; k++) {
        const a = near(wk[k - 1][0]), b = near(wk[k][0]);
        if (a !== b && sp.c[a] && sp.c[b]) pairs.push([wk[k][1] / wk[k - 1][1] - 1, sp.c[b] / sp.c[a] - 1]);
      }
      if (pairs.length > 30) {
        const mx = pairs.reduce((s, p) => s + p[1], 0) / pairs.length, my = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
        let cov = 0, vr = 0;
        for (const [y, x] of pairs) { cov += (x - mx) * (y - my); vr += (x - mx) ** 2; }
        stats.beta = vr ? r(cov / vr, 2) : null;
      }
    }
  }
  const newsItems = news.status === "fulfilled" ? rssItems(news.value).slice(0, 6) : [];
  return { sym, updated: nowIso(), quote, charts, stats, ytd: r(ytd, 2), y1: r(y1, 2), news: newsItems,
    errors: [d5, y5, news].filter((x) => x.status === "rejected").map((x) => String(x.reason && x.reason.message).slice(0, 140)) };
}

// ---------------------------------------------------------------- financials (SEC XBRL)
const REV = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
  "RevenuesNetOfInterestExpense", "RevenueFromContractWithCustomerIncludingAssessedTax"];
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

function quarters(units) {
  const q = {}, fy = {}, ytd9 = {};
  for (const f of units || []) {
    if (!f.start || !["10-Q", "10-K", "10-Q/A", "10-K/A"].includes(f.form)) continue;
    const n = days(f.start, f.end);
    if (n >= 80 && n <= 100) q[f.end] = f.val;
    else if (n >= 350 && n <= 380) fy[f.end] = [f.val, f.start];
    else if (n >= 260 && n <= 285) ytd9[f.end] = [f.val, f.start];
  }
  for (const [end, [val, start]] of Object.entries(fy)) {
    if (end in q) continue;
    const nine = Object.entries(ytd9).find(([e, [, s]]) => s === start && days(e, end) < 100);
    if (nine) q[end] = val - nine[1][0];
  }
  return q;
}

async function concept(cik, ns, tag) {
  try {
    const j = await getUp(`https://data.sec.gov/api/xbrl/companyconcept/CIK${String(cik).padStart(10, "0")}/${ns}/${tag}.json`,
      { sec: true, cacheTtl: 43200 });
    return j.units || {};
  } catch (e) {
    if (e.status === 404) return null; // company never reported this tag: normal
    throw e;
  }
}

async function partFin(cik) {
  // primary tags in parallel; fall back to older revenue tags only when needed
  const [rev1, rev2, gp, op, ni, eps, shares, dil] = await Promise.all([
    concept(cik, "us-gaap", REV[0]), concept(cik, "us-gaap", REV[1]), concept(cik, "us-gaap", "GrossProfit"),
    concept(cik, "us-gaap", "OperatingIncomeLoss"), concept(cik, "us-gaap", "NetIncomeLoss"),
    concept(cik, "us-gaap", "EarningsPerShareDiluted"), concept(cik, "dei", "EntityCommonStockSharesOutstanding"),
    concept(cik, "us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding"),
  ]);
  const merge = (...unitsList) => {
    const out = {};
    for (const u of unitsList) if (u) for (const [e, v] of Object.entries(quarters(u))) if (!(e in out)) out[e] = v;
    return out;
  };
  let revQ = merge(rev1 && rev1.USD, rev2 && rev2.USD);
  const latest = Object.keys(revQ).sort().pop();
  if (!latest || days(latest, new Date().toISOString().slice(0, 10)) > 400) {
    const more = await Promise.all(REV.slice(2).map((t) => concept(cik, "us-gaap", t)));
    revQ = merge(rev1 && rev1.USD, rev2 && rev2.USD, ...more.map((u) => u && u.USD));
  }
  let epsU = eps && eps["USD/shares"];
  if (!epsU) {
    const alt = await concept(cik, "us-gaap", "EarningsPerShareBasic");
    epsU = alt && alt["USD/shares"];
  }
  const series = { rev: revQ, gp: merge(gp && gp.USD), op: merge(op && op.USD), ni: merge(ni && ni.USD), eps: merge(epsU) };
  const ends = [...new Set([...Object.keys(series.rev), ...Object.keys(series.ni)])].sort().slice(-8);
  const qs = ends.map((e) => ({ end: e, rev: series.rev[e] ?? null, gp: series.gp[e] ?? null, op: series.op[e] ?? null, ni: series.ni[e] ?? null, eps: series.eps[e] ?? null }));
  const byEnd = Object.fromEntries(qs.map((x) => [x.end, x]));
  const fin = qs.slice(-5).map((x) => {
    const ya = Date.parse(x.end) - 365 * 86400000;
    let prev = null;
    for (const y of Object.values(byEnd)) if (!prev || Math.abs(Date.parse(y.end) - ya) < Math.abs(Date.parse(prev.end) - ya)) prev = y;
    const yoy = prev && Math.abs(Date.parse(prev.end) - ya) < 20 * 86400000 && prev.rev && x.rev ? (x.rev / prev.rev - 1) * 100 : null;
    return { end: x.end, rev: x.rev ? r(x.rev / 1e6, 1) : null, revYoY: r(yoy, 1), gm: x.gp && x.rev ? r((x.gp / x.rev) * 100, 1) : null,
      op: x.op ? r(x.op / 1e6, 1) : null, ni: x.ni ? r(x.ni / 1e6, 1) : null, eps: r(x.eps, 2) };
  });
  const eps4 = qs.slice(-4).map((x) => x.eps).filter((x) => x !== null);
  const ni4 = qs.slice(-4).map((x) => x.ni).filter((x) => x !== null);
  // shares: largest cover-page count on the latest date (multi-class filers report one line per class)
  let so = null, soEnd = null;
  for (const f of (shares && shares.shares) || []) {
    if (!soEnd || f.end > soEnd) { soEnd = f.end; so = f.val; } else if (f.end === soEnd) so = Math.max(so, f.val);
  }
  const dq = quarters((dil && dil.shares) || []);
  const dEnd = Object.keys(dq).sort().pop();
  return { cik, updated: nowIso(), fin, epsTTM: eps4.length === 4 ? r(eps4.reduce((a, x) => a + x, 0), 3) : null,
    niTTM: ni4.length === 4 ? ni4.reduce((a, x) => a + x, 0) : null, shares: so, sharesAsOf: soEnd, diluted: dEnd ? dq[dEnd] : null };
}

// ---------------------------------------------------------------- filings (SEC)
const CODES = { P: "Open-market buy", S: "Sale", M: "Option exercise", A: "Award / grant", F: "Tax withholding",
  G: "Gift", D: "Disposition to issuer", C: "Conversion", X: "Option exercise" };
const furl = (cik, acc, doc = "") => `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, "")}/${doc}`;
const xv = (s, path) => {
  // tiny XML reader for Form 4: path like "transactionCoding/transactionCode"
  let cur = s;
  for (const p of path.split("/")) {
    const m = cur.match(new RegExp(`<${p}(?:\\s[^>]*)?>([\\s\\S]*?)</${p}>`));
    if (!m) return null;
    cur = m[1];
  }
  const val = cur.match(/<value>([\s\S]*?)<\/value>/);
  return (val ? val[1] : cur).trim() || null;
};
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());

async function form4(cik, f) {
  const doc = f.primaryDocument.replace(/^xsl[^/]+\//, "");
  const x = await getUp(furl(cik, f.accessionNumber, doc), { kind: "text", sec: true, cacheTtl: 86400 * 30 });
  const owner = xv(x, "reportingOwner/reportingOwnerId/rptOwnerName") || "?";
  const rel = (x.match(/<reportingOwnerRelationship>([\s\S]*?)<\/reportingOwnerRelationship>/) || [])[1] || "";
  const yes = (t) => ["1", "true"].includes((xv(rel, t) || "").toLowerCase());
  const role = xv(rel, "officerTitle") || (yes("isDirector") ? "Director" : yes("isTenPercentOwner") ? "10% owner" : null);
  const foot = (x.match(/<footnote[^>]*>[\s\S]*?<\/footnote>/g) || []).join(" ").toLowerCase();
  const plan = ["1", "true"].includes((xv(x, "aff10b5One") || "").toLowerCase()) || foot.includes("10b5-1");
  const out = [];
  for (const m of x.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g)) {
    const t = m[1];
    const code = xv(t, "transactionCoding/transactionCode"), sh = xv(t, "transactionAmounts/transactionShares");
    if (!code || !sh) continue;
    const px = xv(t, "transactionAmounts/transactionPricePerShare");
    out.push({ name: titleCase(owner), role, code, type: CODES[code] || code, plan, shares: r(+sh, 0), price: px ? r(+px, 2) : null,
      ad: xv(t, "transactionAmounts/transactionAcquiredDisposedCode"), date: xv(t, "transactionDate"), filed: f.filingDate });
  }
  return out;
}

async function partFilings(cik) {
  const sub = await getUp(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, { sec: true, cacheTtl: 3600 });
  const rec = (sub.filings || {}).recent || {};
  const n = (rec.form || []).length;
  const filings = [];
  for (let k = 0; k < n; k++) filings.push({ form: rec.form[k], accessionNumber: rec.accessionNumber[k], filingDate: rec.filingDate[k],
    reportDate: rec.reportDate[k], primaryDocument: rec.primaryDocument[k], items: rec.items ? rec.items[k] : "" });
  const f4 = filings.filter((f) => f.form === "4").slice(0, 12);
  const big = filings.filter((f) => /^(SC 13[DG]|SCHEDULE 13[DG])/i.test(f.form)).slice(0, 8);
  const [txs, hdrs] = await Promise.all([
    pool(f4, 4, (f) => form4(cik, f)),
    pool(big, 3, (f) => getUp(furl(cik, f.accessionNumber, `${f.accessionNumber}-index-headers.html`), { kind: "text", sec: true, cacheTtl: 86400 * 30 })),
  ]);
  const ins = txs.flat().filter(Boolean).sort((a, b) => String(b.date || b.filed).localeCompare(String(a.date || a.filed)));
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const yr = ins.filter((x) => (x.date || x.filed) >= cutoff);
  const buys = yr.filter((x) => x.code === "P"), sells = yr.filter((x) => x.code === "S");
  const val = (xs) => xs.reduce((a, x) => a + (x.shares || 0) * (x.price || 0), 0);
  const holders5 = big.map((f, k) => {
    const m = (hdrs[k] || "").match(/FILED BY:[\s\S]*?COMPANY CONFORMED NAME:\s*([^\n<]+)/);
    return { form: f.form, date: f.filingDate, filer: m ? titleCase(m[1].trim()) : null, pct: null,
      activist: /13D/i.test(f.form), url: furl(cik, f.accessionNumber, f.primaryDocument) };
  });
  return {
    cik, updated: nowIso(), name: sub.name, sic: sub.sicDescription || null, tickers: sub.tickers || [], exchanges: sub.exchanges || [],
    insider: { rows: ins.filter((x) => ["P", "S", "M", "A", "F"].includes(x.code)).slice(0, 12), net: r(val(buys) - val(sells), 0),
      buyers: new Set(buys.map((x) => x.name)).size, sellers: new Set(sells.map((x) => x.name)).size,
      sales: sells.length, planSales: sells.filter((x) => x.plan).length, formsRead: f4.length },
    holders5,
    eightK: filings.filter((f) => f.form === "8-K").slice(0, 6).map((f) => ({ date: f.filingDate, items: f.items, url: furl(cik, f.accessionNumber, f.primaryDocument) })),
  };
}

// ---------------------------------------------------------------- handler
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const part = url.searchParams.get("part") || "";
  const sym = (url.searchParams.get("sym") || "").toUpperCase();
  const cik = url.searchParams.get("cik") || "";
  if (!(part in TTL)) return json({ error: "part must be price, fin or filings" }, 400);
  if (part === "price" && !/^[A-Z0-9^][A-Z0-9.\-=^]{0,11}$/.test(sym)) return json({ error: "bad sym" }, 400);
  if (part !== "price" && !/^\d{1,10}$/.test(cik)) return json({ error: "bad cik" }, 400);

  // one canonical cache key per part + symbol, so ?v= busters and param order don't fragment it
  const key = new Request(`${url.origin}/api/quote?part=${part}&${part === "price" ? "sym=" + sym : "cik=" + +cik}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const body = part === "price" ? await partPrice(sym) : part === "fin" ? await partFin(+cik) : await partFilings(+cik);
    const res = json(body, 200, TTL[part]);
    context.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (e) {
    return json({ error: String(e && e.message || e).slice(0, 200) }, 502);
  }
}
