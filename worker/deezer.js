// Deezer preview lookup for the daily Guess the Track challenge, run on the site Worker so the
// browser is handed only an audio link and never the song's title or artist.
// (The standalone worker/music-api Worker still serves the practice mode.)
import { norm, normArtist } from "./match.js";

const SEARCH = "https://api.deezer.com/search";
const CACHE_SECONDS = 300;
const VERSION_WORDS = /\b(live|remix|acoustic|demo|unplugged|session|sessions|radio edit|mono)\b/i;
const BAD_WORDS = /\b(karaoke|tribute|cover|instrumental|originally performed|made famous|in the style of|8-bit|lullaby)\b/i;

async function search(q, limit) {
  const r = await fetch(SEARCH + "?q=" + encodeURIComponent(q) + "&limit=" + limit, {
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error("deezer http " + r.status);
  const d = await r.json();
  if (d && d.error) throw new Error("deezer error");
  return Array.isArray(d && d.data) ? d.data : [];
}

// best playable match: right title, right artist, not a karaoke or tribute cut, most popular
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
    const ver = (t.title_version || "") + " " + ((t.album && t.album.title) || "");
    if (VERSION_WORDS.test(ver) && !VERSION_WORDS.test(title)) score -= 3;
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}

const clean = v => String(v || "").replace(/["\\]/g, "").trim().slice(0, 120);

/* -> { preview, link, cover } or null when nothing playable is found */
export async function resolvePreview(artist, title) {
  const a = clean(artist), t = clean(title);
  if (!a || !t) return null;
  try {
    let hit = pickBest(await search('artist:"' + a + '" track:"' + t + '"', 10), a, t);
    if (!hit) hit = pickBest(await search(a + " " + t, 20), a, t);
    if (!hit) return null;
    return { preview: hit.preview, link: hit.link || "#", cover: (hit.album && (hit.album.cover_medium || hit.album.cover)) || null };
  } catch (e) {
    return null;
  }
}
