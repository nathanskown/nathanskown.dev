/* ============================================================
   music-api: a tiny Cloudflare Worker for Guess the Track.

   What it does: given an artist and a song title, it asks Deezer's
   public search for that song and hands back a FRESH 30-second preview
   link, a link to the track on Deezer, and album art. Your page then
   plays the preview straight from Deezer. The Worker never downloads,
   stores or re-serves any audio.

   Endpoints
     GET /health                          -> {"ok":true}
     GET /resolve?artist=...&title=...    -> {id,title,artist,preview,link,cover}
     POST /score, GET /board              -> optional daily leaderboard (see the LEADERBOARD section below)

   Edit ALLOWED_ORIGINS below if your site address changes.
   ============================================================ */

const ALLOWED_ORIGINS = [
  "https://nathanskown.dev",
  "https://www.nathanskown.dev"
];
// Cloudflare Pages preview deployments (branch previews) look like https://<something>.<project>.pages.dev
// Add your project's pages.dev address here if you want to test previews against the Worker, e.g.:
// "https://music.nathanskown-dev.pages.dev"

const DEEZER = "https://api.deezer.com/search";
const UPSTREAM_CACHE_SECONDS = 300;   // Deezer answers are reused for 5 minutes at Cloudflare's edge
const MAX_FIELD = 120;

const VERSION_WORDS = /\b(live|remix|acoustic|demo|unplugged|session|sessions|radio edit|mono)\b/i;
const BAD_WORDS = /\b(karaoke|tribute|cover|instrumental|originally performed|made famous|in the style of|8-bit|lullaby)\b/i;

function norm(s) {
  return String(s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\s[-–—]\s.*$/, " ")
    .replace(/\b(feat|ft)\.?\s.*$/, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ").trim();
}
const normArtist = s => norm(s).replace(/^the /, "");

function originOk(origin) {
  if (!origin) return true;                         // address-bar tests and curl send no Origin
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);   // local testing
}

function json(body, status, origin, extra) {
  const h = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "vary": "Origin"
  };
  if (origin && originOk(origin)) h["access-control-allow-origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers: Object.assign(h, extra || {}) });
}

async function deezerSearch(q, limit) {
  const url = DEEZER + "?q=" + encodeURIComponent(q) + "&limit=" + limit;
  const r = await fetch(url, {
    cf: { cacheTtl: UPSTREAM_CACHE_SECONDS, cacheEverything: true },
    signal: AbortSignal.timeout(6000)
  });
  if (!r.ok) throw Object.assign(new Error("deezer http " + r.status), { code: "upstream" });
  const d = await r.json();
  if (d && d.error) {
    const quota = /quota|limit/i.test(JSON.stringify(d.error));
    throw Object.assign(new Error("deezer error"), { code: quota ? "quota" : "upstream" });
  }
  return Array.isArray(d && d.data) ? d.data : [];
}

/* pick the best playable match: right title, right artist, not a karaoke/tribute version, most popular */
function pickBest(results, artist, title) {
  const wantT = norm(title), wantA = normArtist(artist);
  let best = null, bestScore = -1;
  for (const t of results) {
    if (!t || !t.preview) continue;
    const gotT = norm(t.title_short || t.title);
    const gotA = normArtist(t.artist && t.artist.name);
    if (gotT !== wantT) continue;
    if (!(gotA === wantA || gotA.includes(wantA) || wantA.includes(gotA))) continue;
    if (BAD_WORDS.test(t.title || "") || BAD_WORDS.test((t.album && t.album.title) || "")) continue;
    let score = 10 + Math.log10((t.rank || 0) + 1);
    if (gotA === wantA) score += 5;
    // prefer the original recording over live / remix / acoustic cuts that share the same short title
    const ver = (t.title_version || "") + " " + ((t.album && t.album.title) || "");
    if (VERSION_WORDS.test(ver) && !VERSION_WORDS.test(title)) score -= 3;
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}

function shape(t) {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist && t.artist.name,
    preview: t.preview,
    link: t.link,
    cover: (t.album && (t.album.cover_medium || t.album.cover)) || null
  };
}

async function resolve(url, origin) {
  const clean = v => String(v || "").replace(/["\\]/g, "").trim().slice(0, MAX_FIELD);
  const artist = clean(url.searchParams.get("artist"));
  const title = clean(url.searchParams.get("title"));
  if (!artist || !title) return json({ error: "need artist and title" }, 400, origin);
  try {
    let hit = pickBest(await deezerSearch('artist:"' + artist + '" track:"' + title + '"', 10), artist, title);
    if (!hit) hit = pickBest(await deezerSearch(artist + " " + title, 20), artist, title);
    if (!hit) return json({ error: "no_preview" }, 404, origin);
    return json(shape(hit), 200, origin);
  } catch (e) {
    if (e && e.code === "quota") return json({ error: "upstream_quota" }, 503, origin);
    return json({ error: "upstream_unavailable" }, 502, origin);
  }
}

/* ============================================================
   LEADERBOARD  (optional: needs a KV namespace bound to this Worker as  LB)
     POST /score   {game, name, score, max, date}   -> {ok, rank, top}
     GET  /board?game=track|artist&scope=today|alltime -> {date, scope, entries:[{name,score,max,date}]}
   Only the daily challenge is submitted (same songs for everyone). Scores are self-reported: the Worker checks
   that they are possible (0..max, whole numbers, today's Chicago date), screens names, allows one entry per name
   per day (keeping the best) and rate-limits by address (stored only as a one-way hash for about a day). It cannot prove a round was played honestly.
   To remove an entry: Cloudflare dashboard > Storage & Databases > KV > your namespace > edit/delete the key
   (d:<game>:<date> for a day, a:<game> for all-time).
   ============================================================ */
const GAMES = ["track", "artist"];
const BOARD_SIZE = 100, SHOW_TOP = 25, DAILY_KEEP_SECONDS = 14 * 86400, MAX_POSTS_PER_DAY = 10;
const BLOCKED = ["fuck", "shit", "cunt", "nigg", "fagg", "retard", "nazi", "hitler", "whore", "slut", "bitch"];

const chicagoDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function cleanName(raw) {
  const n = String(raw || "").normalize("NFKC").replace(/[^A-Za-z0-9 ._'-]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
  if (n.length < 2) return null;
  const flat = n.toLowerCase().replace(/0/g, "o").replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/[5$]/g, "s").replace(/@/g, "a").replace(/[^a-z]/g, "");
  if (BLOCKED.some(w => flat.includes(w))) return "blocked";
  return n;
}

async function hashIp(ip) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("nskn-lb|" + ip));
  return Array.from(new Uint8Array(d)).slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join("");
}

const byBest = (a, b) => (b.score / b.max) - (a.score / a.max) || b.score - a.score || a.t - b.t;
const publicEntry = e => ({ name: e.name, score: e.score, max: e.max, date: e.date });
async function readList(kv, key) {
  try { const v = await kv.get(key, "json"); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

async function postScore(request, env, origin) {
  if (!env || !env.LB) return json({ error: "leaderboard_not_configured" }, 503, origin);
  if (!origin) return json({ error: "origin_required" }, 403, origin);          // browsers always send one; address-bar tests cannot post
  let b;
  try { const txt = await request.text(); if (txt.length > 1000) throw new Error("big"); b = JSON.parse(txt); } catch (e) { return json({ error: "bad_json" }, 400, origin); }
  const game = String(b.game || ""), date = chicagoDate();
  const score = b.score, max = b.max;
  if (!GAMES.includes(game)) return json({ error: "bad_game" }, 400, origin);
  if (!Number.isInteger(score) || !Number.isInteger(max) || max < 5 || max > 50 || max % 5 || score < 0 || score > max) return json({ error: "bad_score" }, 400, origin);
  if (b.date !== date) return json({ error: "wrong_day", today: date }, 400, origin);
  const name = cleanName(b.name);
  if (!name) return json({ error: "bad_name" }, 400, origin);
  if (name === "blocked") return json({ error: "name_not_allowed" }, 400, origin);

  // the address is only used to limit spam, and is stored as a one-way hash for about a day
  const ip = await hashIp(request.headers.get("CF-Connecting-IP") || "unknown");
  const rlKey = "rl:" + ip + ":" + date;
  const used = parseInt(await env.LB.get(rlKey), 10) || 0;
  if (used >= MAX_POSTS_PER_DAY) return json({ error: "too_many" }, 429, origin);
  await env.LB.put(rlKey, String(used + 1), { expirationTtl: 90000 });

  const now = Date.now(), who = name.toLowerCase();
  const dayKey = "d:" + game + ":" + date;
  const day = await readList(env.LB, dayKey);
  const mine = day.find(e => e.name.toLowerCase() === who);
  let changed = false;
  if (!mine) { day.push({ name, score, max, date, t: now }); changed = true; }
  else if (score > mine.score) { mine.score = score; mine.max = max; mine.name = name; mine.t = now; changed = true; }
  day.sort(byBest);
  const trimmed = day.slice(0, BOARD_SIZE);
  if (changed) await env.LB.put(dayKey, JSON.stringify(trimmed), { expirationTtl: DAILY_KEEP_SECONDS });

  if (changed) {
    const allKey = "a:" + game;
    const all = await readList(env.LB, allKey);
    const k = e => e.name.toLowerCase() + "|" + e.date;
    const at = all.find(e => k(e) === who + "|" + date);
    if (!at) all.push({ name, score, max, date, t: now });
    else if (score > at.score) { at.score = score; at.max = max; at.name = name; at.t = now; }
    all.sort(byBest);
    await env.LB.put(allKey, JSON.stringify(all.slice(0, BOARD_SIZE)));
  }
  const rank = trimmed.findIndex(e => e.name.toLowerCase() === who) + 1;
  return json({ ok: true, rank: rank || null, updated: changed, top: trimmed.slice(0, 10).map(publicEntry) }, 200, origin);
}

async function getBoard(url, env, origin) {
  if (!env || !env.LB) return json({ error: "leaderboard_not_configured" }, 503, origin);
  const game = url.searchParams.get("game"), scope = url.searchParams.get("scope") === "alltime" ? "alltime" : "today";
  if (!GAMES.includes(game)) return json({ error: "bad_game" }, 400, origin);
  const date = chicagoDate();
  const list = await readList(env.LB, scope === "alltime" ? "a:" + game : "d:" + game + ":" + date);
  return json({ date, scope, entries: list.slice(0, SHOW_TOP).map(publicEntry) }, 200, origin, { "cache-control": "public, max-age=15" });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (!originOk(origin)) return json({ error: "origin_not_allowed" }, 403, null);
    if (request.method === "OPTIONS") {
      const h = {
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
        "vary": "Origin"
      };
      if (origin) h["access-control-allow-origin"] = origin;
      return new Response(null, { status: 204, headers: h });
    }
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/score") return postScore(request, env, origin);
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, origin);
    if (url.pathname === "/health") return json({ ok: true, leaderboard: !!(env && env.LB) }, 200, origin);
    if (url.pathname === "/resolve") return resolve(url, origin);
    if (url.pathname === "/board") return getBoard(url, env, origin);
    return json({ error: "not_found" }, 404, origin);
  }
};
