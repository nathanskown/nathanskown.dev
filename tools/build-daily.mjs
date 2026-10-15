// Builds music/data/daily.json: the frozen daily-challenge picks for Guess the Track and Guess the Artist.
//
// Why this exists: if the daily songs were picked from the live catalog each morning, rebuilding the
// catalog (Last.fm data changes weekly) would change today's challenge halfway through the day.
// Here every day is chosen once, written down, and never changed afterwards.
//
// - Days are keyed by Chicago's calendar date (the site and leaderboard use the same clock).
// - Existing days are never rewritten once they arrive, with one exception: a future day picked by an older
//   picking method (its "v" is below PICK_VERSION) is picked again. Today and past days are never touched.
// - Picks go through music/assets/variety.js (the same helper the pages use): genre families take turns,
//   no artist repeats, and back-to-back decades are avoided, so a day is not five pop songs.
// - Days older than KEEP_PAST_DAYS are dropped so the file stays small.
// - Track days draw only from songs of 1970 or later in Pop, Hip-Hop, R&B & Soul, Rock & Alt and Country & Folk.
//   THEMED lists one-off days with a fixed song list (2026-10-15 = well-known rock).
// - Each track day lists 8 songs: the game plays the first 5 that load, so a song Deezer cannot
//   play is skipped for everyone in the same order.
// - Each artist day stores the 5 full artist records plus the exact clue tracks ("picked").
//
// Run:  node tools/build-daily.mjs     (no packages, Node 18+). Env: MUSIC_DIR (default music), DAYS_AHEAD (30).
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";

const DIR = process.env.MUSIC_DIR || "music";
const DAYS_AHEAD = Number(process.env.DAYS_AHEAD || 30);
const KEEP_PAST_DAYS = 3;
const TRACKS_PER_DAY = 8, ARTISTS_PER_DAY = 5;
const PICK_VERSION = 3;

const load = file => {
  if (!existsSync(file)) return {};
  const w = {};
  new Function("window", readFileSync(file, "utf8"))(w);
  return w;
};

const V = load(join(DIR, "assets/variety.js")).MXV;
if (!V) { console.error("Missing " + DIR + "/assets/variety.js"); process.exit(1); }

/* same small helpers the pages use */
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\s[-–—]\s.*$/, " ").replace(/\b(feat|ft)\.?\s.*$/, " ")
  .replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const normArtist = s => norm(s).replace(/^the /, "");
function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const chicagoKey = d => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const addDays = (key, n) => { const d = new Date(key + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/* ---- inputs ---- */
const curated = load(join(DIR, "data/tracks.js")).TRACK_SEEDS || [];
const generated = load(join(DIR, "data/tracks-generated.js")).TRACK_SEEDS_GENERATED || [];
const seen = new Set(curated.map(s => norm(s.title) + "|" + normArtist(s.artist)));
const seeds = curated.concat(generated.filter(s => !seen.has(norm(s.title) + "|" + normArtist(s.artist))));
// One-off themed days: a fixed list of songs used instead of the random pick.
const R = (t, a, y) => ({ id: "rock-" + norm(t).replace(/ /g, ""), title: t, artist: a, year: y, genre: "Rock" });
const THEMED = {
  "2026-10-15": [R("Sweet Child o' Mine", "Guns N' Roses", 1987), R("Smells Like Teen Spirit", "Nirvana", 1991), R("Livin' on a Prayer", "Bon Jovi", 1986),
    R("Back in Black", "AC/DC", 1980), R("Mr. Brightside", "The Killers", 2003), R("Seven Nation Army", "The White Stripes", 2003),
    R("Don't Stop Believin'", "Journey", 1981), R("Hotel California", "Eagles", 1976)]   // today: well-known rock
};

const themedKeys = new Set(Object.values(THEMED).flat().map(x => norm(x.title) + "|" + normArtist(x.artist)));
// Guess the Track daily pool: songs from 1970 onward, in five broad genre families only. Songs that only have an
// artist-debut decade (no release year) use that decade. Only the most popular artists ("easy" tier, top third by
// Last.fm listeners) are used so every daily song is recognizable. Curated songs and data/tracks-2010s.js are included.
const FIVE = ["Pop", "Hip-Hop", "R&B & Soul", "Rock & Alt", "Country & Folk"];
const decade2010s = load(join(DIR, "data/tracks-2010s.js")).TRACK_SEEDS_2010S || [];
const tierOf = {}; ((load(join(DIR, "data/artists.js")).ARTIST_DATA || { artists: [] }).artists).forEach(a => { tierOf[normArtist(a.name)] = a.tier; });
const dseen = new Set();
const dailyPool = seeds.concat(decade2010s).filter(s => {
  if (themedKeys.has(norm(s.title) + "|" + normArtist(s.artist))) return false;   // themed songs are not reused in random days
  const k = norm(s.title) + "|" + normArtist(s.artist);
  if (dseen.has(k)) return false; dseen.add(k);
  if (String(s.id).startsWith("g") && tierOf[normArtist(s.artist)] !== "easy") return false;
  return (s.year || s.era) >= 1970 && FIVE.includes(V.family(s.genre));
});

const A = load(join(DIR, "data/artists.js")).ARTIST_DATA || { meta: {}, artists: [] };
const lesserFrom = (A.meta && A.meta.lesserFrom) || 3;
const leaks = (title, a) => norm(title).includes(normArtist(a.name));
const lesserOf = a => (a.tracks || []).filter((t, i) => i >= lesserFrom && !leaks(t.name, a));
const playable = A.artists.filter(a => a.tracks && a.tracks.length && lesserOf(a).length >= 3);

if (!seeds.length) { console.error("No songs found in " + DIR + "/data. Nothing to schedule."); process.exit(1); }
if (!playable.length) { console.error("No playable artists found in " + DIR + "/data/artists.js. Nothing to schedule."); process.exit(1); }

/* ---- existing schedule (kept as-is) ---- */
// daily.json is not published as a file: the site Worker bundles it and serves /music/data/daily.js with
// only today and past days, so future answers never reach a browser.
const out = join(DIR, "data/daily.json");
const legacy = join(DIR, "data/daily.js");
const days = (existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : (load(legacy).DAILY_SCHEDULE || {})).days || {};

const today = chicagoKey(new Date());
const first = addDays(today, -KEEP_PAST_DAYS);
for (const k of Object.keys(days)) if (k < first) delete days[k];

let added = 0;
for (let i = 0; i <= DAYS_AHEAD; i++) {
  const key = addDays(today, i);
  if (days[key] && (i === 0 || (days[key].v || 1) >= PICK_VERSION)) continue;   // never change today or an up-to-date day
  const rt = mulberry32(hashStr("daily-track-" + key)), ra = mulberry32(hashStr("daily-artist-" + key));
  const track = THEMED[key] ? shuffle(THEMED[key], rt) : V.spread(dailyPool, rt, { limit: TRACKS_PER_DAY });
  const artist = V.spread(playable, ra, { fam: a => V.familyOfTags(a.tags), artist: a => a.name, decade: a => a.debutDecade || null,
                                         limit: ARTISTS_PER_DAY }).map(a => {
    const picked = shuffle(lesserOf(a), ra).slice(0, 5).sort((x, y) => y.rank - x.rank).map(t => t.name);
    return { name: a.name, aliases: a.aliases || [], tier: a.tier, tags: a.tags || [], country: a.country || null,
             debutDecade: a.debutDecade || null, url: a.url || null, tracks: a.tracks, picked };
  });
  days[key] = { v: PICK_VERSION, track, artist };
  added++;
}

const sorted = {};
for (const k of Object.keys(days).sort()) sorted[k] = days[k];
const body = JSON.stringify({ generatedAt: new Date().toISOString(), days: sorted });
writeFileSync(out + ".tmp", body);
renameSync(out + ".tmp", out);
console.log("Daily schedule: " + Object.keys(sorted).length + " days (" + added + " added or re-picked), " + Object.keys(sorted)[0] + " to " + Object.keys(sorted).slice(-1)[0] + ". " + (body.length / 1024).toFixed(0) + " KB.");
