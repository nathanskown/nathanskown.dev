#!/usr/bin/env node
/* ============================================================
   Builds the Guess the Artist catalog from Last.fm and MusicBrainz.

   Writes two files (paths are relative to where you run it):
     music/data/artists.js            artists, ranked top tracks, tags, debut decade, country
     music/data/tracks-generated.js   extra songs for Guess the Track (top 3 of each artist)

   Settings come from environment variables:
     LASTFM_API_KEY   required   your Last.fm API key
     MB_CONTACT       required   an email or web address; MusicBrainz asks every app to identify itself
     ARTISTS          optional   how many artists to keep (default 600)
     OUT_DIR          optional   where to write (default music/data)
     CACHE_FILE       optional   progress file so re-runs only fetch new artists (default tools/.cache/artists-cache.json)
     CACHE_DAYS       optional   how long cached artists stay fresh (default 7)

   Needs Node 18 or newer. No packages to install.
   Run:  node tools/build-artist-catalog.mjs
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

const env = process.env;
const KEY = env.LASTFM_API_KEY;
const CONTACT = env.MB_CONTACT;
const N = Math.max(10, Number(env.ARTISTS || 600));
const LF_BASE = env.LASTFM_BASE || "https://ws.audioscrobbler.com/2.0/";
const MB_BASE = env.MB_BASE || "https://musicbrainz.org/ws/2";
const OUT_DIR = env.OUT_DIR || "music/data";
const CACHE_FILE = env.CACHE_FILE || "tools/.cache/artists-cache.json";
const CACHE_DAYS = Number(env.CACHE_DAYS || 7);
const LF_DELAY = Number(env.LASTFM_DELAY_MS || 250);   // be polite: about 4 requests a second
const MB_DELAY = Number(env.MB_DELAY_MS || 1100);       // MusicBrainz allows 1 request a second
const LESSER_FROM = 3;                                  // skip the top 3 tracks when picking "lesser-known" clues
const KEEP_TRACKS = 10, MIN_TRACKS = 8;

if (!KEY) { console.error("Missing LASTFM_API_KEY. Get a free key at https://www.last.fm/api/account/create"); process.exit(1); }
if (!CONTACT) { console.error("Missing MB_CONTACT. Set it to your email or website, e.g. you@example.com"); process.exit(1); }

/* ---------- helpers ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const limiter = ms => { let last = 0; return async () => { const w = Math.max(0, last + ms - Date.now()); if (w) await sleep(w); last = Date.now(); }; };
const lfWait = limiter(LF_DELAY), mbWait = limiter(MB_DELAY);
const redact = u => String(u).replace(/api_key=[^&]+/, "api_key=***");
const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);

async function getJson(url, wait, headers) {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    await wait();
    try {
      const r = await fetch(url, { headers: headers || {}, signal: AbortSignal.timeout(20000) });
      if (r.status === 429 || r.status >= 500) { lastErr = new Error("HTTP " + r.status); await sleep(3000 * (attempt + 1)); continue; }
      if (!r.ok) throw new Error("HTTP " + r.status + " for " + redact(url));
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (/^HTTP 4/.test(e.message)) throw e;       // a real 4xx will not fix itself
      await sleep(2000 * (attempt + 1));
    }
  }
  throw new Error("gave up on " + redact(url) + ": " + (lastErr && lastErr.message));
}

async function lf(method, params) {
  const q = new URLSearchParams(Object.assign({ method, api_key: KEY, format: "json" }, params));
  const d = await getJson(LF_BASE + "?" + q.toString(), lfWait);
  if (d && d.error) throw new Error("Last.fm error " + d.error + ": " + d.message);
  return d;
}
const mb = path => getJson(MB_BASE + path, mbWait, { "User-Agent": "nathanskown-dev-music/1.0 ( " + CONTACT + " )", Accept: "application/json" });

/* ---------- text cleaning ---------- */
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\s[-–—]\s.*$/, " ").replace(/&/g, " and ")
  .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const normArtist = s => norm(s).replace(/^the /, "");

const JUNK = "live|remix|demo|acoustic|karaoke|instrumental|version|remaster(?:ed)?|edit|mix|session|unplugged|bonus|mono|stereo|radio";
const JUNK_BRACKET = new RegExp("\\s*[\\(\\[][^\\)\\]]*\\b(?:" + JUNK + ")\\b[^\\)\\]]*[\\)\\]]\\s*$", "i");
const JUNK_DASH = new RegExp("\\s[-–—]\\s.*\\b(?:" + JUNK + ")\\b.*$", "i");
const SKIP_TITLE = /^(intro|outro|interlude|skit|untitled)$/i;

function cleanTracks(raw, artistName) {
  const seen = new Set(), out = [], a = normArtist(artistName);
  for (const t of raw) {
    let name = String(t.name || "").trim().replace(JUNK_BRACKET, "").replace(JUNK_DASH, "").trim();
    if (!name || SKIP_TITLE.test(name)) continue;
    const n = norm(name);
    if (!n || seen.has(n)) continue;
    if (a && n.includes(a)) continue;               // title gives the answer away
    seen.add(n);
    out.push({ name, rank: out.length + 1 });
    if (out.length >= KEEP_TRACKS) break;
  }
  return out;
}

const JUNK_TAGS = new Set(["seen live", "favorites", "favourites", "favorite", "favourite", "albums i own", "awesome", "all", "legend", "legends",
  "love", "male vocalists", "female vocalists", "male vocalist", "female vocalist", "american", "british", "english", "canadian", "swedish", "french",
  "australian", "irish", "german", "jamaican", "usa", "uk", "00s", "10s", "20s", "60s", "70s", "80s", "90s", "oldies", "classic", "good", "best",
  "cool", "beautiful", "amazing", "my music", "spotify", "singer", "singers", "band", "bands"]);
function cleanTags(raw) {
  const out = [];
  for (const t of raw) {
    const name = String(t.name || "").trim().toLowerCase();
    if (!name || JUNK_TAGS.has(name) || Number(t.count || 0) < 25) continue;
    if (/^\d{2,4}s?$/.test(name)) continue;
    if (out.includes(name)) continue;
    out.push(name);
    if (out.length >= 3) break;
  }
  return out;
}

const GENRE_NAMES = { "r&b": "R&B", "hip-hop": "Hip-Hop", "hip hop": "Hip-Hop", "rap": "Hip-Hop", "edm": "Electronic", "electronica": "Electronic" };
const titleCase = g => GENRE_NAMES[g] || g.replace(/\b[a-z]/g, c => c.toUpperCase());

const regionNames = (() => { try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; } })();
function countryName(code) {
  if (!code || !regionNames) return null;
  try { const n = regionNames.of(code); return n && n !== code ? n : null; } catch { return null; }
}

/* ---------- 1. the artist list ---------- */
async function chartArtists() {
  const out = [], seen = new Set();
  let page = 1, totalPages = 1;
  while (out.length < N * 1.4 && page <= totalPages && page <= 60) {
    const d = await lf("chart.gettopartists", { page, limit: 50 });
    const list = arr(d.artists && d.artists.artist);
    totalPages = Number(d.artists && d.artists["@attr"] && d.artists["@attr"].totalPages) || totalPages;
    if (!list.length) break;
    for (const a of list) {
      const key = normArtist(a.name || "");
      if (!key || seen.has(key) || /^various artists$/i.test(a.name)) continue;
      seen.add(key);
      out.push({ name: a.name, mbid: a.mbid || "", url: a.url || "" });
    }
    page++;
  }
  console.log("chart: " + out.length + " candidate artists");
  return out;
}

/* ---------- 2. details for one artist ---------- */
async function details(c) {
  const idParam = c.mbid ? { mbid: c.mbid } : { artist: c.name };
  const tt = await lf("artist.gettoptracks", Object.assign({ limit: 20, autocorrect: 1 }, idParam));
  const tracks = cleanTracks(arr(tt.toptracks && tt.toptracks.track), c.name);
  if (tracks.length < MIN_TRACKS) return null;
  const tg = await lf("artist.gettoptags", Object.assign({ autocorrect: 1 }, idParam));
  const tags = cleanTags(arr(tg.toptags && tg.toptags.tag));

  let country = null, debutDecade = null;
  if (c.mbid) {
    try {
      const a = await mb("/artist/" + encodeURIComponent(c.mbid) + "?fmt=json");
      country = countryName(a.country);
      const lifeBegin = parseInt(String(a["life-span"] && a["life-span"].begin || "").slice(0, 4), 10);
      const rg = await mb("/release-group?artist=" + encodeURIComponent(c.mbid) + "&type=" + encodeURIComponent("album|ep") + "&limit=100&fmt=json");
      const years = arr(rg["release-groups"]).map(g => parseInt(String(g["first-release-date"] || "").slice(0, 4), 10)).filter(y => y > 1900 && y < 2100);
      const first = years.length ? Math.min(...years) : (lifeBegin > 1900 ? lifeBegin : null);
      if (first) debutDecade = Math.floor(first / 10) * 10;
    } catch (e) {
      console.warn("  MusicBrainz skipped for " + c.name + ": " + e.message);
    }
  }
  return { name: c.name, url: c.url, mbid: c.mbid, tags, country, debutDecade, tracks, fetchedAt: Date.now() };
}

/* ---------- main ---------- */
function loadCache() {
  try { return existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {}; } catch { return {}; }
}
function writeFileAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

const cache = loadCache();
const fresh = e => e && Date.now() - e.fetchedAt < CACHE_DAYS * 86400000;
const candidates = await chartArtists();
const kept = [];
let fetched = 0;
for (const c of candidates) {
  if (kept.length >= N) break;
  const key = normArtist(c.name);
  let e = cache[key];
  if (!fresh(e)) {
    try { e = await details(c); } catch (err) { console.warn("skip " + c.name + ": " + err.message); continue; }
    cache[key] = e || { skipped: true, fetchedAt: Date.now() };
    if (++fetched % 10 === 0) { writeFileAtomic(CACHE_FILE, JSON.stringify(cache)); console.log("  ..." + kept.length + " kept, " + fetched + " fetched"); }
  }
  if (!e || e.skipped) continue;
  kept.push(e);
}
writeFileAtomic(CACHE_FILE, JSON.stringify(cache));

if (kept.length < 10) { console.error("Only " + kept.length + " usable artists. Not overwriting the catalog."); process.exit(1); }

const artists = kept.map((e, i) => ({
  name: e.name, aliases: [], country: e.country, debutDecade: e.debutDecade,
  tier: i < kept.length / 3 ? "easy" : i < kept.length * 2 / 3 ? "medium" : "hard",
  tags: e.tags, url: e.url, tracks: e.tracks
}));
const meta = { mode: "live", generatedAt: new Date().toISOString(), source: "Last.fm + MusicBrainz", lesserFrom: LESSER_FROM, count: artists.length };
writeFileAtomic(join(OUT_DIR, "artists.js"),
  "/* Generated by tools/build-artist-catalog.mjs. Do not edit by hand. */\n" +
  'window.ARTIST_DATA = {"meta":' + JSON.stringify(meta) + ',"artists":[\n' + artists.map(a => JSON.stringify(a)).join(",\n") + "\n]};\n");

const seeds = [];
for (const a of artists) {
  for (const t of a.tracks.slice(0, 3)) {
    seeds.push({ id: "g" + hash(norm(t.name) + "|" + normArtist(a.name)), title: t.name, artist: a.name, year: null, era: a.debutDecade,
      genre: a.tags[0] ? titleCase(a.tags[0]) : null });
  }
}
writeFileAtomic(join(OUT_DIR, "tracks-generated.js"),
  "/* Generated by tools/build-artist-catalog.mjs. Extra songs for Guess the Track. */\n" +
  "window.TRACK_SEEDS_GENERATED = [\n" + seeds.map(s => JSON.stringify(s)).join(",\n") + "\n];\n");

console.log("Done: " + artists.length + " artists, " + seeds.length + " songs -> " + OUT_DIR);
