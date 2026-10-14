// Checks that trimming ESPN feeds in the Worker (worker/sports.js) changes nothing the pages show:
// fetches each feed straight from ESPN, runs the site's own normalizers (assets/sports-data.js) on the raw
// and on the trimmed copy, and compares the results. Then reports what the live proxy actually serves.
// Run in CI: node tools/verify-espn-trim.mjs
import { readFileSync } from "node:fs";
import { prune } from "../worker/sports.js";

globalThis.window = {};
let payload = null;
globalThis.fetch0 = globalThis.fetch;
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(payload)) });
new Function("window", readFileSync(new URL("../assets/sports-data.js", import.meta.url), "utf8"))(globalThis.window);
const SD = globalThis.window.SD;

const feeds = [
  ["scores", "nfl"], ["scores", "ncaaf"], ["scores", "nba"], ["scores", "nhl"], ["scores", "mlb"], ["scores", "ncaab"], ["scores", "ncaah"],
  ["scores", "epl"], ["scores", "ucl"], ["scores", "mls"], ["scores", "pga"], ["scores", "atp"], ["scores", "wta"],
  ["schedule", "nfl", "8"], ["schedule", "nhl", "5"], ["schedule", "nba", "8"], ["schedule", "mlb", "6"], ["schedule", "ncaaf", "127"],
];
let bad = 0;
for (const [fn, lg, id] of feeds) {
 try {
  const L = SD.LEAGUES[lg];
  let path = `site/v2/sports/${L.sport}/${L.slug}/` + (fn === "scores" ? "scoreboard" : `teams/${id}/schedule`);
  const q = fn === "scores" && L.groups ? `?groups=${L.groups}` + (["ncaaf", "ncaab"].includes(lg) ? "&limit=300" : "") : (["ncaah"].includes(lg) ? "?limit=300" : "");
  const raw = await (await realFetch(`https://site.api.espn.com/apis/${path}${q}`)).json();
  const trimmed = prune(raw);
  payload = raw;
  const a = JSON.stringify(fn === "scores" ? await SD.scores(lg) : await SD.schedule(lg, id));
  payload = trimmed;
  const b = JSON.stringify(fn === "scores" ? await SD.scores(lg) : await SD.schedule(lg, id));
  const live = await realFetch(`https://nathanskown.dev/api/espn/${path}${q}`);
  const liveBody = await live.text();
  const same = a === b;
  if (!same) bad++;
  const rawLen = JSON.stringify(raw).length, trimLen = JSON.stringify(trimmed).length;
  console.log(`::notice title=${same ? "same" : "DIFFERENT"} ${fn} ${lg}${id ? " " + id : ""}::raw ${rawLen}B -> trimmed ${trimLen}B (${Math.round(100 - trimLen / rawLen * 100)}% smaller); live proxy ${live.status} ${liveBody.length}B x-trim=${live.headers.get("x-trim")}`);
  if (!same) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) { console.log(`::warning title=diff ${lg}::` + a.slice(Math.max(0, i - 60), i + 60) + " || " + b.slice(Math.max(0, i - 60), i + 60)); break; }
  }
 } catch (e) {
  console.log(`::warning title=could not check ${fn} ${lg}${id ? " " + id : ""}::${String(e && e.stack || e).slice(0, 300).replace(/\n/g, " ")}`);
 }
}
if (bad) { console.log(`::error::${bad} feed(s) render differently after trimming`); process.exit(1); }
