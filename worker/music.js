// Music section endpoints that live on the site Worker.
//
//   GET  /music/data/daily.js           the daily-challenge schedule, today and past days only.
//                                       The full schedule (music/data/daily.json) is bundled into this
//                                       Worker and never published, so future answers stay private.
//   GET  /api/music/board?game=&scope=  daily leaderboard (today | alltime)
//   POST /api/music/score               {game, name, score, max, date}
//
// The leaderboard is stored in a Durable Object (SQLite-backed, created by the migration in
// wrangler.jsonc on deploy), so it needs no KV namespace or dashboard setup.
import { DurableObject } from "cloudflare:workers";
import schedule from "../music/data/daily.json";

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

/* ---------- daily schedule, trimmed to today and earlier ---------- */
export function serveDaily() {
  const today = chicagoDate();
  const days = {};
  for (const [k, v] of Object.entries((schedule && schedule.days) || {})) if (k <= today) days[k] = v;
  const body = "/* Daily challenges: today and past days only. */\nwindow.DAILY_SCHEDULE = " +
    JSON.stringify({ generatedAt: schedule && schedule.generatedAt, days }) + ";\n";
  return new Response(body, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      // short cache so the new day appears within a minute of midnight Central
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
}

/* ---------- leaderboard ---------- */
const GAMES = ["track", "artist"];
const BOARD_SIZE = 100, SHOW_TOP = 25, KEEP_DAYS = 14, MAX_POSTS_PER_DAY = 10;
const BLOCKED = ["fuck", "shit", "cunt", "nigg", "fagg", "retard", "nazi", "hitler", "whore", "slut", "bitch"];

function cleanName(raw) {
  const n = String(raw || "").normalize("NFKC").replace(/[^A-Za-z0-9 ._'-]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
  if (n.length < 2) return null;
  const flat = n.toLowerCase().replace(/0/g, "o").replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/4/g, "a")
    .replace(/[5$]/g, "s").replace(/@/g, "a").replace(/[^a-z]/g, "");
  if (BLOCKED.some(w => flat.includes(w))) return "blocked";
  return n;
}

async function hashIp(ip) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("nskn-lb|" + ip));
  return Array.from(new Uint8Array(d)).slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join("");
}

const byBest = (a, b) => (b.score / b.max) - (a.score / a.max) || b.score - a.score || a.t - b.t;
const publicEntry = e => ({ name: e.name, score: e.score, max: e.max, date: e.date });

export class MusicBoard extends DurableObject {
  async list(key) {
    const v = await this.ctx.storage.get(key);
    return Array.isArray(v) ? v : [];
  }

  async prune(today) {
    const cutoff = new Date(today + "T12:00:00Z");
    cutoff.setUTCDate(cutoff.getUTCDate() - KEEP_DAYS);
    const oldest = cutoff.toISOString().slice(0, 10);
    const stale = [];
    for (const k of (await this.ctx.storage.list({ prefix: "rl:" })).keys()) if (!k.endsWith(":" + today)) stale.push(k);
    for (const k of (await this.ctx.storage.list({ prefix: "d:" })).keys()) if (k.slice(-10) < oldest) stale.push(k);
    for (let i = 0; i < stale.length; i += 128) await this.ctx.storage.delete(stale.slice(i, i + 128));
  }

  async board(game, scope) {
    const date = chicagoDate();
    const list = await this.list(scope === "alltime" ? "a:" + game : "d:" + game + ":" + date);
    return { date, scope, entries: list.slice(0, SHOW_TOP).map(publicEntry) };
  }

  async score(b, ipHash) {
    const game = String(b.game || ""), date = chicagoDate();
    const { score, max } = b;
    if (!GAMES.includes(game)) return { status: 400, body: { error: "bad_game" } };
    if (!Number.isInteger(score) || !Number.isInteger(max) || max < 5 || max > 50 || max % 5 || score < 0 || score > max)
      return { status: 400, body: { error: "bad_score" } };
    if (b.date !== date) return { status: 400, body: { error: "wrong_day", today: date } };
    const name = cleanName(b.name);
    if (!name) return { status: 400, body: { error: "bad_name" } };
    if (name === "blocked") return { status: 400, body: { error: "name_not_allowed" } };

    const rlKey = "rl:" + ipHash + ":" + date;
    const used = (await this.ctx.storage.get(rlKey)) || 0;
    if (used >= MAX_POSTS_PER_DAY) return { status: 429, body: { error: "too_many" } };
    await this.ctx.storage.put(rlKey, used + 1);

    const now = Date.now(), who = name.toLowerCase();
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
    return { status: 200, body: { ok: true, rank: rank || null, updated: changed, top: trimmed.slice(0, 10).map(publicEntry) } };
  }
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

  if (url.pathname === "/api/music/score" && request.method === "POST") {
    const origin = request.headers.get("Origin");
    if (!origin || !ALLOWED_ORIGIN.test(origin)) return json({ error: "origin_not_allowed" }, 403);
    let b;
    try {
      const txt = await request.text();
      if (txt.length > 1000) throw new Error("too big");
      b = JSON.parse(txt);
    } catch (e) {
      return json({ error: "bad_json" }, 400);
    }
    const ipHash = await hashIp(request.headers.get("CF-Connecting-IP") || "unknown");
    const r = await stub.score(b, ipHash);
    return json(r.body, r.status);
  }

  return json({ error: "not_found" }, 404);
}
