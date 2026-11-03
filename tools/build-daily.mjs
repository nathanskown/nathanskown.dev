// Picks the upcoming daily-challenge songs and artists and uploads them PRIVATELY to the site Worker.
//
// Why private: the daily answers must never sit in the public repo or reach a browser before a player
// finishes a song. The Worker keeps the schedule in its own storage, checks guesses and counts the score.
//
// - Days are keyed by Chicago's calendar date (the site and leaderboard use the same clock).
// - Picks use real randomness (not a seeded generator), so a day cannot be recomputed from public code.
// - Only dates the Worker does not already hold are uploaded. The Worker never replaces today or a past day.
// - Picks go through music/assets/variety.js (the same helper the pages use): genre families take turns,
//   no artist repeats, and back-to-back decades are avoided, so a day is not five pop songs.
// - Track days draw only from songs of 1970 or later in Pop, Hip-Hop, R&B & Soul, Rock & Alt and Country & Folk.
//   THEMED lists one-off days with a fixed song list.
// - Each track day lists 8 songs: the game plays the first 5 that load, so a song Deezer cannot
//   play is skipped for everyone in the same order.
// - Each artist day stores the 5 full artist records plus the exact clue tracks ("picked").
//
// Run:  MUSIC_ADMIN_TOKEN=... node tools/build-daily.mjs        (no packages, Node 18+)
// Env:  MUSIC_ADMIN_TOKEN (required, same value as the Worker secret), MUSIC_API (default https://nathanskown.dev),
//       MUSIC_DIR (default music), DAYS_AHEAD (30), DRY_RUN=1 (print the dates, upload nothing).
import { readFileSync, existsSync } from "node:fs";
import { randomInt } from "node:crypto";
import { join } from "node:path";

const DIR = process.env.MUSIC_DIR || "music";
const DAYS_AHEAD = Number(process.env.DAYS_AHEAD || 30);
const TRACKS_PER_DAY = 8, ARTISTS_PER_DAY = 5;
const API = (process.env.MUSIC_API || "https://nathanskown.dev").replace(/\/+$/, "");
const TOKEN = process.env.MUSIC_ADMIN_TOKEN || "";
const DRY = process.env.DRY_RUN === "1";

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
const rnd = () => randomInt(0, 2 ** 32) / 2 ** 32;   // unpredictable: picks cannot be recomputed from the date
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

/* ---- what the Worker already holds ---- */
if (!DRY && TOKEN.length < 24) {
  console.error("MUSIC_ADMIN_TOKEN is not set (or is shorter than 24 characters). Set the same random value as a Worker secret and as a GitHub Actions secret; see README.");
  process.exit(1);
}
let have = new Set();
if (!DRY) {
  const r = await fetch(API + "/api/music/admin/days", { headers: { authorization: "Bearer " + TOKEN } });
  if (!r.ok) { console.error("Could not read the stored schedule: HTTP " + r.status + " (is MUSIC_ADMIN_TOKEN set on the Worker too?)"); process.exit(1); }
  have = new Set((await r.json()).days || []);
}

const today = chicagoKey(new Date());
const days = {};
for (let i = 0; i <= DAYS_AHEAD; i++) {
  const key = addDays(today, i);
  if (have.has(key)) continue;
  const track = THEMED[key] ? shuffle(THEMED[key], rnd) : V.spread(dailyPool, rnd, { limit: TRACKS_PER_DAY });
  const artist = V.spread(playable, rnd, { fam: a => V.familyOfTags(a.tags), artist: a => a.name, decade: a => a.debutDecade || null,
                                         limit: ARTISTS_PER_DAY }).map(a => {
    const picked = shuffle(lesserOf(a), rnd).slice(0, 5).sort((x, y) => y.rank - x.rank).map(t => t.name);
    return { name: a.name, aliases: a.aliases || [], tier: a.tier, tags: a.tags || [], country: a.country || null,
             debutDecade: a.debutDecade || null, url: a.url || null, tracks: a.tracks, picked };
  });
  days[key] = { track, artist };
}

const dates = Object.keys(days).sort();
if (!dates.length) { console.log("Daily schedule is already stocked through " + addDays(today, DAYS_AHEAD) + ". Nothing to upload."); process.exit(0); }
if (DRY) { console.log("Dry run: would upload " + dates.length + " days (" + dates[0] + " to " + dates[dates.length - 1] + ")."); process.exit(0); }

const res = await fetch(API + "/api/music/admin/schedule", {
  method: "PUT",
  headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" },
  body: JSON.stringify({ days })
});
const out = await res.json().catch(() => ({}));
if (!res.ok) { console.error("Upload failed: HTTP " + res.status + " " + JSON.stringify(out)); process.exit(1); }
console.log("Uploaded " + out.stored + " days (" + out.skipped + " skipped), " + dates[0] + " to " + dates[dates.length - 1] + ".");
