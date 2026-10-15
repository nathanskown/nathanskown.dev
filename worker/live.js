// Fresher-than-hourly market data and headlines, served at /api/live (routed from worker/index.js).
//   /api/live?part=tiles     index/commodity tiles, sectors and watchlist     (cached 60 s)
//   /api/live?part=movers    S&P 500 gainers, losers and breadth              (cached 90 s)
//   /api/live?part=news      feed items newer than the last hourly run        (cached 60 s)
// The output shapes match what the hourly pipeline writes (data/finance/dashboard.json and
// headlines.json), so the pages overlay these on top of the static files. If any call fails the
// page just keeps showing the hourly data.

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const SEC_UA = "nathanskown.dev finance data bot skownclaude@agentmail.to";
const YAHOO = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const API_VERSION = 1;
const TTL = { tiles: 60, movers: 90, news: 60 };

const TILES = [["spx", "^GSPC", "S&P 500", "", 2], ["ixic", "^IXIC", "Nasdaq Comp.", "", 2], ["dji", "^DJI", "Dow Jones", "", 2],
  ["rut", "^RUT", "Russell 2000", "", 2], ["vix", "^VIX", "VIX", "", 2], ["tnx", "^TNX", "US 10Y yield", "%", 2],
  ["dxy", "DX-Y.NYB", "US Dollar Idx", "", 2], ["wti", "CL=F", "WTI crude", "$", 2], ["gold", "GC=F", "Gold", "$", 2],
  ["btc", "BTC-USD", "Bitcoin", "$", 0]];
const SECTORS = [["XLK", "Technology"], ["XLE", "Energy"], ["XLC", "Communication"], ["XLF", "Financials"],
  ["XLY", "Cons. Discretionary"], ["XLI", "Industrials"], ["XLB", "Materials"], ["XLV", "Health Care"],
  ["XLRE", "Real Estate"], ["XLP", "Cons. Staples"], ["XLU", "Utilities"]];
const NOTABLE = ["acquire", "acquisition", "merger", "to buy", "buyout", "bankruptcy", "chapter 11", "guidance", "raises", "cuts", "recall",
  "investigation", "subpoena", "sec charges", "fda approv", "fda clear", "rate decision", "fomc", "tariff", "downgrade", "upgrade",
  "layoff", "ceo", "resign", "dividend", "buyback", "split", "ipo", "halt", "outage", "breach", "strike"];

const EN = new Set("the and of to in for on with at by from is are was were after new says say will its over as an has have that this his her their it be not but or up out more than into about how what why who when amid against could would may year q1 q2 q3 q4 reports announces announced announce launches shares stock stocks inc corp".split(" "));
const FOREIGN = new Set("el la los las del y que para con por una un su se es al lo le les des du et pour dans une sur est qui der die das und mit für von den zu ist nicht auf ein eine im dem um da uma os não ao dos nas nos il di per che della degli sono gli en een het van voor och att som på är med av ett de em na pela pelo anuncia resultados trimestre lucro dividendo banco acima esperado anuncian empresa nuevo nueva primer segundo tercer cuarto ganancias".split(" "));
// Heuristic: true for English text; rejects non-Latin scripts and text that reads as Spanish, French, German, Portuguese, Italian, Dutch or Swedish.
function isEnglish(text) {
  const letters = Array.from(text || "").filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return true;
  const nonLatin = letters.filter((c) => c.codePointAt(0) > 0x24f).length;
  if (nonLatin / letters.length > 0.2) return false;
  const accents = letters.filter((c) => { const k = c.codePointAt(0); return k >= 0xc0 && k <= 0x24f; }).length;
  if (accents / letters.length > 0.06) return false;
  if (letters.filter((c) => { const k = c.codePointAt(0); return k >= 0x100 && k <= 0x17f; }).length >= 2) return false;
  const words = (text.toLowerCase().match(/[a-zà-ÿ']+/g) || []);
  let en = 0, fo = 0;
  for (const w of words) { if (EN.has(w)) en++; if (FOREIGN.has(w)) fo++; }
  if (fo >= 2 && fo > en) return false;
  if (words.length >= 5 && en === 0 && fo >= 1) return false;
  return true;
}

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

async function getUp(url, { kind = "json", sec = false, timeout = 12000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: sec ? { "User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate" }
                   : { "User-Agent": BROWSER_UA, Accept: "*/*", "Accept-Language": "en-US,en;q=0.9" },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 90)}`);
    return kind === "json" ? await res.json() : await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function assetJson(env, path) {
  try {
    const res = await env.ASSETS.fetch(new Request(`https://assets.local${path}`));
    return res.ok ? await res.json() : null;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------- prices
async function chart(sym, rng = "1d", interval = "5m") {
  let last;
  for (const base of YAHOO) {
    try {
      const q = new URLSearchParams({ range: rng, interval, includePrePost: "false" });
      const j = await getUp(`${base}/v8/finance/chart/${encodeURIComponent(sym)}?${q}`);
      const res = ((j.chart || {}).result || [])[0];
      if (!res) throw new Error(`no chart result for ${sym}`);
      const qt = ((res.indicators || {}).quote || [{}])[0];
      const t = [], c = [];
      (res.timestamp || []).forEach((ts, k) => {
        const close = (qt.close || [])[k];
        if (close !== null && close !== undefined) { t.push(ts); c.push(close); }
      });
      return { meta: res.meta || {}, t, c };
    } catch (e) { last = e; }
  }
  throw last;
}

function quoteFromChart(ch) {
  const m = ch.meta;
  const price = m.regularMarketPrice || (ch.c.length ? ch.c[ch.c.length - 1] : null);
  const prev = m.chartPreviousClose || m.previousClose;
  const chg = price !== null && prev ? price - prev : null;
  return {
    price: r(price, 4), prev: r(prev, 4), chg: r(chg, 4), pct: chg !== null && prev ? r((chg / prev) * 100, 3) : null,
    time: m.regularMarketTime || null, currency: m.currency || null, hi52: r(m.fiftyTwoWeekHigh, 4), lo52: r(m.fiftyTwoWeekLow, 4),
    name: m.longName || m.shortName || null, exch: m.fullExchangeName || m.exchangeName || null,
  };
}

// Yahoo spark: daily change for up to 20 symbols per call
async function spark(symbols) {
  const chunks = [];
  for (let i = 0; i < symbols.length; i += 20) chunks.push(symbols.slice(i, i + 20));
  const out = {};
  await Promise.all(chunks.map(async (chunk) => {
    let j = null;
    for (const base of YAHOO) {
      try {
        j = await getUp(`${base}/v8/finance/spark?symbols=${encodeURIComponent(chunk.join(","))}&range=1d&interval=1d`);
        break;
      } catch (e) { j = null; }
    }
    if (!j) return;
    const items = [];
    if (j.spark) {
      for (const res of j.spark.result || []) {
        const resp = (res.response || [{}])[0] || {};
        const meta = resp.meta || {};
        const closes = (((resp.indicators || {}).quote || [{}])[0] || {}).close || [];
        items.push([res.symbol, meta.regularMarketPrice || closes[closes.length - 1], meta.chartPreviousClose || meta.previousClose]);
      }
    } else {
      for (const [sym, d] of Object.entries(j)) {
        if (!d || typeof d !== "object") continue;
        const closes = (d.close || []).filter((x) => x !== null && x !== undefined);
        items.push([d.symbol || sym, closes[closes.length - 1], d.chartPreviousClose || d.previousClose]);
      }
    }
    for (const [sym, px, prev] of items) {
      if (sym && px && prev) out[sym] = { price: r(px, 4), prev: r(prev, 4), pct: r(((px - prev) / prev) * 100, 3) };
    }
  }));
  if (!Object.keys(out).length) throw new Error("spark returned no prices");
  return out;
}

async function partTiles(env) {
  const cfg = (await assetJson(env, "/data/finance/config.json")) || {};
  const watchSyms = cfg.watchlist || [];
  const universe = cfg.universe || {};
  const [tileRes, sp] = await Promise.all([
    Promise.allSettled(TILES.map(([, sym]) => chart(sym))),
    spark([...SECTORS.map((s) => s[0]), ...watchSyms]).catch(() => ({})),
  ]);
  const tiles = [];
  tileRes.forEach((res, k) => {
    if (res.status !== "fulfilled") return;
    const [id, sym, name, unit, dec] = TILES[k];
    const ch = res.value;
    const step = Math.max(1, Math.floor(ch.c.length / 80));
    const q = quoteFromChart(ch);
    tiles.push({ id, sym, unit, dec, ...q, name: q.name || name,
      t: ch.t.filter((_, i) => i % step === 0), c: ch.c.filter((_, i) => i % step === 0).map((x) => r(x, 4)) });
  });
  if (!tiles.length) throw new Error("no tile prices");
  const sectors = SECTORS.filter(([s]) => sp[s]).map(([sym, name]) => ({ sym, name, pct: sp[sym].pct }));
  const watch = watchSyms.filter((s) => sp[s]).map((s) => ({ sym: s, name: s, price: sp[s].price, pct: sp[s].pct, inUniverse: s in universe }));
  const asOf = Math.max(0, ...tiles.map((t) => t.time || 0));
  return { updated: nowIso(), asOf, tiles, sectors, watch };
}

async function partMovers(env) {
  const mem = (await assetJson(env, "/data/finance/members.json")) || {};
  const syms = mem.sp500 || [];
  if (!syms.length) throw new Error("no S&P 500 member list");
  const px = await spark(syms);
  const rows = Object.entries(px).map(([s, v]) => ({ sym: s, name: (mem.names || {})[s] || s, sector: (mem.sectors || {})[s] || null, ...v }));
  rows.sort((a, b) => a.pct - b.pct);
  return {
    updated: nowIso(),
    movers: { gainers: rows.slice().reverse().slice(0, 8), losers: rows.slice(0, 8) },
    breadth: { adv: rows.filter((x) => x.pct > 0).length, dec: rows.filter((x) => x.pct < 0).length, n: rows.length },
  };
}

// ---------------------------------------------------------------- headlines
const decode = (s) => (s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/\s+/g, " ").trim();

function parseFeed(xml) {
  const out = [];
  const tag = (blk, name) => { const x = blk.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`)); return x ? decode(x[1]) : ""; };
  for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)) {
    const pub = tag(m[1], "pubDate") || tag(m[1], "dc:date");
    const d = pub ? new Date(pub) : null;
    out.push({ title: tag(m[1], "title"), link: tag(m[1], "link"), summary: tag(m[1], "description").slice(0, 400),
      published: d && !isNaN(d) ? d.toISOString().replace(/\.\d{3}Z$/, "+00:00") : null });
  }
  for (const m of xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/g)) {
    const href = (m[1].match(/<link[^>]*href="([^"]+)"/) || [])[1] || "";
    const pub = tag(m[1], "updated") || tag(m[1], "published");
    const d = pub ? new Date(pub) : null;
    out.push({ title: tag(m[1], "title"), link: href.replace(/&amp;/g, "&"), summary: tag(m[1], "summary").slice(0, 400),
      published: d && !isNaN(d) ? d.toISOString().replace(/\.\d{3}Z$/, "+00:00") : null });
  }
  return out.filter((i) => i.title && i.link);
}

async function partNews(env) {
  const cfg = (await assetJson(env, "/data/finance/config.json")) || {};
  const old = (await assetJson(env, "/data/finance/headlines.json")) || { items: [] };
  const seen = new Set((old.items || []).map((h) => h.link));
  const alias = [];
  for (const [t, info] of Object.entries(cfg.universe || {})) {
    for (const a of info.aliases || []) alias.push([new RegExp("\\b" + a.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b"), t]);
  }
  const jobs = [];
  for (const [kind, feeds] of Object.entries(cfg.feeds || {})) {
    if (kind === "SEC filing") continue; // 8-K items need the CIK-to-ticker map; the hourly job covers them
    for (const [src, url] of Object.entries(feeds)) jobs.push({ kind, src, url });
  }
  const results = await Promise.allSettled(jobs.map((j) => getUp(j.url, { kind: "text", timeout: 9000 })));
  const fresh = [];
  const now = nowIso();
  results.forEach((res, k) => {
    if (res.status !== "fulfilled") return;
    const { kind, src } = jobs[k];
    for (const it of parseFeed(res.value).slice(0, 60)) {
      if (seen.has(it.link)) continue;
      seen.add(it.link);
      if (!isEnglish(it.title)) continue;
      const low = it.title.toLowerCase();
      const tick = new Set();
      for (const m of (it.title + " " + it.summary).matchAll(/\((?:NYSE|NASDAQ|Nasdaq|NYSE American|Cboe)[^:)]*:\s*([A-Z.]{1,6})\)/g)) tick.add(m[1]);
      for (const m of it.title.matchAll(/\$([A-Z]{1,5})\b/g)) tick.add(m[1]);
      for (const [re, t] of alias) if (re.test(low)) tick.add(t);
      fresh.push({ title: it.title.slice(0, 240), link: it.link, source: src, type: kind, published: it.published || now, firstSeen: now,
        tickers: [...tick].map((t) => t.replace(".", "-")).sort().slice(0, 6), notable: NOTABLE.some((w) => low.includes(w)) });
    }
  });
  fresh.sort((a, b) => (a.published < b.published ? 1 : -1));
  return { updated: now, items: fresh.slice(0, 150) };
}

export async function handleLive(request, env, ctx) {
  if (request.method !== "GET") return json({ error: "GET only" }, 405);
  const url = new URL(request.url);
  const part = url.searchParams.get("part") || "";
  if (!(part in TTL)) return json({ error: "part must be tiles, movers or news" }, 400);
  const key = new Request(`${url.origin}/api/live?v=${API_VERSION}&part=${part}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const body = part === "tiles" ? await partTiles(env) : part === "movers" ? await partMovers(env) : await partNews(env);
    body.api = API_VERSION;
    const res = json(body, 200, TTL[part]);
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (e) {
    return json({ error: String((e && e.message) || e).slice(0, 200) }, 502);
  }
}
