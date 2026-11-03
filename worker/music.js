// Music section endpoints that live on the site Worker.
//
//   POST /api/music/daily          {a, ...}  the whole daily challenge, played against the server:
//                                    a:"start", game            -> first song or artist
//                                    a:"guess", sid, guess      -> right or wrong, plus the next clue or the reveal
//                                    a:"more" | "skip" | "next" | "refresh" | "bad_clip", sid
//   POST /api/music/score          {sid, name, secret}  post a finished daily; the score comes from the server
//   GET  /api/music/board?game=&scope=     daily leaderboard (today | alltime)
//   PUT  /api/music/admin/schedule         (bearer MUSIC_ADMIN_TOKEN) store upcoming daily picks
//   GET  /api/music/admin/days             (bearer MUSIC_ADMIN_TOKEN) which dates are stored
//
// The answers never leave the Worker: the schedule lives in the Durable Object's private storage, guesses are
// checked here, and the score that reaches the leaderboard is the one counted here. A browser only ever sees a
// preview link or clue text, plus the answer for a song it has finished.
//
// The leaderboard and sessions are stored in a Durable Object (SQLite-backed, created by the migration in
// wrangler.jsonc on deploy), so no KV namespace is needed.
import { DurableObject } from "cloudflare:workers";
import { isTitleMatch, isArtistMatch } from "./match.js";
import { resolvePreview } from "./deezer.js";

const chicagoDate = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const ALLOWED_ORIGIN = /^https:\/\/(www\.)?nathanskown\.dev$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    }, extra),
  });
}

const GAMES = ["track", "artist"];
const TOTAL = 5;                              // songs or artists per daily
const TRACK_POINTS = [5, 3, 2, 1];            // clip stages 1s / 2s / 4s / 8s
const ARTIST_MAX = 5;                         // artist clue 1 is worth 5, then one less per clue, never below 1
const BOARD_SIZE = 100, SHOW_TOP = 25, KEEP_DAYS = 14;
const MAX_STARTS_PER_DAY = 12, MAX_POSTS_PER_DAY = 10, MAX_BAD_CLIPS = 2;
const BLOCKED = ["fuck", "shit", "cunt", "nigg", "fagg", "retard", "nazi", "hitler", "whore", "slut", "bitch"];

function cleanName(raw) {
  const n = String(raw || "").normalize("NFKC").replace(/[^A-Za-z0-9 ._'-]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
  if (n.length < 2) return null;
  const flat = n.toLowerCase().replace(/0/g, "o").replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/4/g, "a")
    .replace(/[5$]/g, "s").replace(/@/g, "a").replace(/[^a-z]/g, "");
  if (BLOCKED.some(w => flat.includes(w))) return "blocked";
  return n;
}

async function sha(text, bytes = 10) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).slice(0, bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
const hashIp = ip => sha("nskn-lb|" + ip);
const randomHex = n => Array.from(crypto.getRandomValues(new Uint8Array(n))).map(b => b.toString(16).padStart(2, "0")).join("");

function safeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

const byBest = (a, b) => (b.score / b.max) - (a.score / a.max) || b.score - a.score || a.t - b.t;
const publicEntry = e => ({ name: e.name, score: e.score, max: e.max, date: e.date });
const fail = (status, error, extra) => ({ status, body: Object.assign({ error }, extra) });
const ok = body => ({ status: 200, body });

/* ---------- clue stages for Guess the Artist (same ladder the page used to build) ---------- */
function artistStages(a) {
  const byName = n => (a.tracks || []).find(t => t.name === n);
  const picked = (a.picked || []).map(byName).filter(Boolean);
  const stages = [];
  stages.push(picked.slice(0, 3).map((t, i) => ({ k: "TRACK " + (i + 1), v: t.name })));
  for (let i = 3; i < picked.length; i++) stages.push([{ k: "TRACK " + (i + 1), v: picked[i].name }]);
  const meta = [];
  if (a.tags && a.tags.length) meta.push({ k: "GENRE", v: a.tags.slice(0, 3).join(" · ") });
  if (a.debutDecade) meta.push({ k: "STARTED", v: a.debutDecade + "s" });
  if (a.country) meta.push({ k: "FROM", v: a.country });
  if (meta.length) stages.push(meta);
  stages.push([{ k: "BIGGEST HIT", v: a.tracks[0].name }]);
  return stages;
}

const stagesTotal = (game, item) => (game === "track" ? TRACK_POINTS.length : artistStages(item).length);
const worth = (game, stage) => (game === "track" ? TRACK_POINTS[stage] : Math.max(1, ARTIST_MAX - stage));

function revealOf(game, item, cur) {
  if (game === "track") {
    return { title: item.title, artist: item.artist, year: item.year || null, era: item.era || null, genre: item.genre || null,
             link: (cur && cur.link) || "#", cover: (cur && cur.cover) || null };
  }
  return { name: item.name, tags: (item.tags || []).slice(0, 3), country: item.country || null, debutDecade: item.debutDecade || null,
           tracks: (item.tracks || []).slice(0, 5).map(t => t.name), url: item.url || null };
}

export class MusicBoard extends DurableObject {
  async list(key) {
    const v = await this.ctx.storage.get(key);
    return Array.isArray(v) ? v : [];
  }

  async prune(today) {
    const cutoff = new Date(today + "T12:00:00Z");
    cutoff.setUTCDate(cutoff.getUTCDate() - KEEP_DAYS);
    const oldest = cutoff.toISOString().slice(0, 10);
    const old = new Date(today + "T12:00:00Z"); old.setUTCDate(old.getUTCDate() - 3);
    const schedOldest = old.toISOString().slice(0, 10);
    const stale = [];
    for (const k of (await this.ctx.storage.list({ prefix: "rl:" })).keys()) if (!k.includes(":" + today + ":")) stale.push(k);
    for (const k of (await this.ctx.storage.list({ prefix: "d:" })).keys()) if (k.slice(-10) < oldest) stale.push(k);
    for (const k of (await this.ctx.storage.list({ prefix: "sched:" })).keys()) if (k.slice(6) < schedOldest) stale.push(k);
    const sess = await this.ctx.storage.list({ prefix: "sess:" });
    for (const [k, v] of sess) if (!v || v.date < schedOldest) stale.push(k);
    const names = await this.ctx.storage.list({ prefix: "nm:" });
    for (const [k, v] of names) if (!v || Date.now() - (v.t || 0) > 90 * 86400000) stale.push(k);
    for (let i = 0; i < stale.length; i += 128) await this.ctx.storage.delete(stale.slice(i, i + 128));
  }

  /* ---------- leaderboard reads ---------- */
  async board(game, scope) {
    const date = chicagoDate();
    const list = await this.list(scope === "alltime" ? "a:" + game : "d:" + game + ":" + date);
    return { date, scope, entries: list.slice(0, SHOW_TOP).map(publicEntry) };
  }

  /* ---------- schedule (admin) ---------- */
  async putSchedule(days, replaceFuture) {
    const today = chicagoDate();
    let stored = 0, skipped = 0;
    for (const [date, day] of Object.entries(days || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }
      const t = day && day.track, a = day && day.artist;
      const goodT = Array.isArray(t) && t.length >= TOTAL && t.every(x => x && typeof x.title === "string" && typeof x.artist === "string");
      const goodA = Array.isArray(a) && a.length >= TOTAL && a.every(x => x && typeof x.name === "string" && Array.isArray(x.tracks) && x.tracks.length && Array.isArray(x.picked));
      if (!goodT || !goodA) { skipped++; continue; }
      const key = "sched:" + date;
      const have = await this.ctx.storage.get(key);
      // today and past days are never replaced, so nobody's round changes under them
      if (have && (date <= today || !replaceFuture)) { skipped++; continue; }
      await this.ctx.storage.put(key, { track: t.slice(0, 8), artist: a.slice(0, TOTAL) });
      stored++;
    }
    return { stored, skipped };
  }

  async scheduleDays() {
    return Array.from((await this.ctx.storage.list({ prefix: "sched:" })).keys()).map(k => k.slice(6)).sort();
  }

  /* ---------- rate limit ---------- */
  async spend(kind, ipHash, date, max) {
    const key = "rl:" + ipHash + ":" + date + ":" + kind;
    const used = (await this.ctx.storage.get(key)) || 0;
    if (used >= max) return false;
    await this.ctx.storage.put(key, used + 1);
    return true;
  }

  /* ---------- the daily, played against the server ---------- */
  view(s, item) {
    const total = stagesTotal(s.game, item);
    const v = { sid: s.sid, game: s.game, n: s.n, total: TOTAL, stage: s.stage, stagesTotal: total, worth: worth(s.game, s.stage), score: s.score };
    if (s.game === "artist") v.clues = artistStages(item).slice(0, s.stage + 1);
    return v;
  }

  // Moves to the next playable song or artist. Returns false when the schedule has nothing left.
  async advance(s, day) {
    const list = day[s.game];
    while (s.p < list.length && s.n < TOTAL) {
      const i = s.p++;
      const item = list[i];
      let cur = { i };
      if (s.game === "track") {
        const hit = await resolvePreview(item.artist, item.title);
        if (!hit) continue;                              // unplayable: skip in the same order for everyone
        cur = { i, preview: hit.preview, link: hit.link, cover: hit.cover };
      }
      s.n++; s.stage = 0; s.done = false; s.cur = cur;
      return true;
    }
    return false;
  }

  finalize(s) {
    s.final = true; s.done = true;
    s.max = s.results.length * (s.game === "track" ? TRACK_POINTS[0] : ARTIST_MAX);
    return { final: true, score: s.score, max: s.max, rounds: s.results.length };
  }

  finishItem(s, item, got) {
    const pts = got ? worth(s.game, s.stage) : 0;
    s.score += pts; s.done = true;
    s.results.push({ got, pts, stage: s.stage });
    return { done: true, correct: got, pts, stage: s.stage, stagesTotal: stagesTotal(s.game, item), score: s.score,
             lastItem: s.n >= TOTAL, reveal: revealOf(s.game, item, s.cur) };
  }

  async daily(b, ipHash) {
    const a = String(b.a || "");
    const date = chicagoDate();

    if (a === "start") {
      const game = String(b.game || "");
      if (!GAMES.includes(game)) return fail(400, "bad_game");
      const day = await this.ctx.storage.get("sched:" + date);
      if (!day || !Array.isArray(day[game]) || day[game].length < TOTAL) return fail(503, "daily_unavailable");
      if (!(await this.spend("s", ipHash, date, MAX_STARTS_PER_DAY))) return fail(429, "too_many");
      const s = { sid: randomHex(12), game, date, p: 0, n: 0, stage: 0, done: true, score: 0, results: [], bad: 0, posted: false, final: false, cur: null, t: Date.now() };
      if (!(await this.advance(s, day))) return fail(503, "daily_unavailable");
      await this.ctx.storage.put("sess:" + s.sid, s);
      if (Math.random() < 0.05) await this.prune(date);
      const out = this.view(s, day[game][s.cur.i]);
      if (game === "track") out.previewUrl = s.cur.preview;
      return ok(out);
    }

    const sid = String(b.sid || "");
    if (!/^[0-9a-f]{24}$/.test(sid)) return fail(400, "bad_session");
    const s = await this.ctx.storage.get("sess:" + sid);
    if (!s) return fail(404, "session_expired");
    if (s.date !== date) return fail(400, "wrong_day", { today: date });
    const day = await this.ctx.storage.get("sched:" + s.date);
    if (!day) return fail(503, "daily_unavailable");
    const game = s.game;
    const item = s.cur ? day[game][s.cur.i] : null;
    const save = () => this.ctx.storage.put("sess:" + sid, s);

    if (a === "guess" || a === "more" || a === "skip") {
      if (s.final || s.done || !item) return fail(400, "not_playing");
      if (a === "guess") {
        const g = String(b.guess || "").trim();
        if (!g || g.length > 200) return fail(400, "bad_guess");
        const got = game === "track" ? isTitleMatch(g, item.title) : isArtistMatch(g, item);
        if (got) { const r = this.finishItem(s, item, true); await save(); return ok(r); }
        if (s.stage < stagesTotal(game, item) - 1) {
          s.stage++; await save();
          return ok({ done: false, correct: false, ...this.view(s, item) });
        }
        const r = this.finishItem(s, item, false); await save(); return ok(r);
      }
      if (a === "more") {
        if (s.stage >= stagesTotal(game, item) - 1) return fail(400, "no_more");
        s.stage++; await save();
        return ok({ done: false, ...this.view(s, item) });
      }
      const r = this.finishItem(s, item, false); await save(); return ok(r);
    }

    if (a === "next") {
      if (s.final) return ok({ final: true, score: s.score, max: s.max, rounds: s.results.length });
      if (!s.done) return fail(400, "not_finished_item");
      if (s.n >= TOTAL || !(await this.advance(s, day))) { const r = this.finalize(s); await save(); return ok(r); }
      await save();
      const out = this.view(s, day[game][s.cur.i]);
      if (game === "track") out.previewUrl = s.cur.preview;
      return ok(out);
    }

    if (a === "refresh") {                               // preview links expire, so hand out a fresh one
      if (game !== "track" || s.final || s.done || !item) return fail(400, "not_playing");
      const hit = await resolvePreview(item.artist, item.title);
      if (!hit) return fail(502, "clip_unavailable");
      s.cur.preview = hit.preview; await save();
      return ok({ previewUrl: hit.preview });
    }

    if (a === "bad_clip") {                              // the browser couldn't play this clip: swap in the next spare
      if (game !== "track" || s.final || s.done || s.stage > 0 || s.bad >= MAX_BAD_CLIPS) return fail(400, "not_allowed");
      s.bad++; s.n--;
      if (!(await this.advance(s, day))) { const r = this.finalize(s); await save(); return ok(r); }
      await save();
      const out = this.view(s, day[game][s.cur.i]);
      out.previewUrl = s.cur.preview;
      return ok(out);
    }

    return fail(400, "bad_action");
  }

  /* ---------- post a finished daily ---------- */
  async score(b, ipHash) {
    const date = chicagoDate();
    const sid = String(b.sid || "");
    if (!/^[0-9a-f]{24}$/.test(sid)) return fail(400, "bad_session");
    const s = await this.ctx.storage.get("sess:" + sid);
    if (!s) return fail(404, "session_expired");
    if (!s.final || !s.results.length) return fail(400, "not_finished");
    if (s.date !== date) return fail(400, "wrong_day", { today: date });
    if (s.posted) return fail(409, "already_posted");
    const name = cleanName(b.name);
    if (!name) return fail(400, "bad_name");
    if (name === "blocked") return fail(400, "name_not_allowed");
    const secret = String(b.secret || "");
    if (!/^[0-9a-f]{16,64}$/.test(secret)) return fail(400, "bad_secret");

    if (!(await this.spend("p", ipHash, date, MAX_POSTS_PER_DAY))) return fail(429, "too_many");

    // a name belongs to whoever posted under it first; later posts must come from the same browser secret
    const who = name.toLowerCase();
    const proof = await sha("nskn-name|" + secret, 16);
    const claim = await this.ctx.storage.get("nm:" + who);
    if (claim && !safeEqual(claim.h, proof)) return fail(409, "name_taken");
    await this.ctx.storage.put("nm:" + who, { h: proof, t: Date.now() });

    const game = s.game, score = s.score, max = s.max, now = Date.now();
    s.posted = true;
    await this.ctx.storage.put("sess:" + sid, s);

    const dayKey = "d:" + game + ":" + date;
    const day = await this.list(dayKey);
    const mine = day.find(e => e.name.toLowerCase() === who);
    let changed = false;
    if (!mine) { day.push({ name, score, max, date, t: now }); changed = true; }
    else if (score > mine.score) { Object.assign(mine, { score, max, name, t: now }); changed = true; }
    day.sort(byBest);
    const trimmed = day.slice(0, BOARD_SIZE);
    if (changed) {
      await this.ctx.storage.put(dayKey, trimmed);
      const allKey = "a:" + game;
      const all = await this.list(allKey);
      const at = all.find(e => e.name.toLowerCase() === who && e.date === date);
      if (!at) all.push({ name, score, max, date, t: now });
      else if (score > at.score) Object.assign(at, { score, max, name, t: now });
      all.sort(byBest);
      await this.ctx.storage.put(allKey, all.slice(0, BOARD_SIZE));
    }
    if (Math.random() < 0.1) await this.prune(date);
    const rank = trimmed.findIndex(e => e.name.toLowerCase() === who) + 1;
    return ok({ ok: true, rank: rank || null, updated: changed, top: trimmed.slice(0, 10).map(publicEntry) });
  }
}

/* ---------- request handling ---------- */
async function readJson(request, limit) {
  const txt = await request.text();
  if (txt.length > limit) throw new Error("too big");
  return JSON.parse(txt);
}

export async function handleMusic(request, env) {
  const url = new URL(request.url);
  if (!env.MUSIC_BOARD) return json({ error: "leaderboard_not_configured" }, 503);
  const stub = env.MUSIC_BOARD.get(env.MUSIC_BOARD.idFromName("global"));

  if (url.pathname === "/api/music/board" && request.method === "GET") {
    const game = url.searchParams.get("game");
    const scope = url.searchParams.get("scope") === "alltime" ? "alltime" : "today";
    if (!GAMES.includes(game)) return json({ error: "bad_game" }, 400);
    return json(await stub.board(game, scope), 200, { "cache-control": "public, max-age=15" });
  }

  /* schedule upload from the daily workflow: protected by a shared secret, never by the browser Origin header */
  if (url.pathname === "/api/music/admin/schedule" || url.pathname === "/api/music/admin/days") {
    const token = env.MUSIC_ADMIN_TOKEN;
    const given = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token || token.length < 24 || !safeEqual(given, token)) return json({ error: "unauthorized" }, 401);
    if (url.pathname === "/api/music/admin/days" && request.method === "GET") return json({ days: await stub.scheduleDays() });
    if (url.pathname === "/api/music/admin/schedule" && request.method === "PUT") {
      let b;
      try { b = await readJson(request, 1500000); } catch (e) { return json({ error: "bad_json" }, 400); }
      return json(await stub.putSchedule(b.days, b.replaceFuture === true));
    }
    return json({ error: "not_found" }, 404);
  }

  if ((url.pathname === "/api/music/daily" || url.pathname === "/api/music/score") && request.method === "POST") {
    const origin = request.headers.get("Origin");
    if (!origin || !ALLOWED_ORIGIN.test(origin)) return json({ error: "origin_not_allowed" }, 403);
    let b;
    try { b = await readJson(request, 2000); } catch (e) { return json({ error: "bad_json" }, 400); }
    if (!b || typeof b !== "object") return json({ error: "bad_json" }, 400);
    const ipHash = await hashIp(request.headers.get("CF-Connecting-IP") || "unknown");
    const r = url.pathname === "/api/music/daily" ? await stub.daily(b, ipHash) : await stub.score(b, ipHash);
    return json(r.body, r.status);
  }

  return json({ error: "not_found" }, 404);
}
