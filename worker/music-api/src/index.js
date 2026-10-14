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

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin");
    if (!originOk(origin)) return json({ error: "origin_not_allowed" }, 403, null);
    if (request.method === "OPTIONS") {
      const h = {
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
        "vary": "Origin"
      };
      if (origin) h["access-control-allow-origin"] = origin;
      return new Response(null, { status: 204, headers: h });
    }
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, origin);
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true }, 200, origin);
    if (url.pathname === "/resolve") return resolve(url, origin);
    return json({ error: "not_found" }, 404, origin);
  }
};
