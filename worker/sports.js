// Live sports data for the Sports pages: a thin, cached pass-through to ESPN's public site API.
//
//   /api/espn/site/v2/sports/football/nfl/scoreboard      -> https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
//   /api/espn/v2/sports/hockey/nhl/standings?level=3      -> https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings?level=3
//
// Scoreboards and team schedules are trimmed here to the fields assets/sports-data.js actually reads
// (same ESPN shape, ~85-95% smaller), and the trimmed copy is cached at the edge, so the parse runs about
// once per cache window, not once per visitor. Very large responses skip the trim and pass straight
// through, to stay inside the free plan's per-request CPU limit. Other routes are passed through as-is.
// Only an allowlist of paths and query parameters is forwarded.

const UPSTREAM = "https://site.api.espn.com/apis/";
const SPORTS = "(?:football|baseball|hockey|basketball|soccer|golf|tennis)";
const LEAGUE = "[a-z0-9.\\-]{2,40}";
const TEAM = "[a-z0-9]{1,12}";

// [pattern, edge cache seconds]
const ROUTES = [
  [new RegExp(`^site/v2/sports/${SPORTS}/${LEAGUE}/scoreboard$`), 30],
  [new RegExp(`^site/v2/sports/${SPORTS}/${LEAGUE}/summary$`), 30],
  [new RegExp(`^site/v2/sports/${SPORTS}/${LEAGUE}/teams/${TEAM}/schedule$`), 300],
  [new RegExp(`^site/v2/sports/${SPORTS}/${LEAGUE}/teams/${TEAM}$`), 600],
  [new RegExp(`^site/v2/sports/${SPORTS}/${LEAGUE}/teams$`), 86400],
  [new RegExp(`^v2/sports/${SPORTS}/${LEAGUE}/standings$`), 900],
];
// Every key the browser-side normalizers read (scores(), schedule() in assets/sports-data.js).
// Pruning keeps these at any depth and drops everything else (logos, links, odds blobs, leaders...).
const KEEP = new Set(("events week season byeWeek team id date endDate name shortName number text type year seasonType " +
  "competitions groupings grouping displayName round status state completed shortDetail detail description period " +
  "displayClock neutralSite venue fullName address city broadcasts names media broadcast notes headline series summary " +
  "competitors homeAway winner score value displayValue records record curatedRank current linescores tiebreak " +
  "abbreviation shortDisplayName location color alternateColor recordSummary standingSummary athlete position thru order").split(" "));
const TRIM = [/\/scoreboard$/, /\/teams\/[a-z0-9]+\/schedule$/];
const TRIM_MAX = 1500000; // bytes: above this, pass through untrimmed (CPU limit)
const TRIM_VERSION = 1;   // bump when KEEP changes: new edge-cache namespace

export function prune(o) {
  if (Array.isArray(o)) return o.map(prune);
  if (o && typeof o === "object") {
    const out = {};
    for (const k in o) if (KEEP.has(k)) out[k] = prune(o[k]);
    return out;
  }
  return o;
}

const PARAMS = new Set(["dates", "week", "seasontype", "groups", "group", "limit", "event", "season", "level", "league"]);

function json(status, body, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

export async function handleEspn(request, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") return json(405, { error: "GET only" });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/espn\//, "").replace(/\/+$/, "");
  const route = ROUTES.find(([re]) => re.test(path));
  if (!route) return json(404, { error: "path not allowed", path });

  const qs = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (PARAMS.has(k) && /^[A-Za-z0-9,\-.]{1,40}$/.test(v)) qs.set(k, v);
  }
  qs.sort(); // stable cache key
  const target = UPSTREAM + path + (qs.toString() ? "?" + qs : "");
  const ttl = route[1];
  const trim = TRIM.some((re) => re.test(path));
  const cache = caches.default;
  const key = new Request(`${url.origin}/api/espn-trimmed/v${TRIM_VERSION}/${path}?${qs}`);
  if (trim) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }

  let up;
  try {
    up = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; nathanskown.dev sports pages)", Accept: "application/json" },
      cf: { cacheTtl: ttl, cacheEverything: true },
      signal: AbortSignal.timeout(12000),
    });
  } catch (e) {
    return json(502, { error: "upstream unreachable", detail: String(e && e.message || e) });
  }
  if (!up.ok) return json(up.status === 404 ? 404 : 502, { error: `upstream HTTP ${up.status}` }, 30);

  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": `public, max-age=${Math.min(ttl, 300)}`,
    "access-control-allow-origin": "*",
    "x-upstream": "espn",
  };
  const len = Number(up.headers.get("content-length") || 0);
  if (!trim || len > TRIM_MAX) return new Response(up.body, { status: 200, headers: { ...headers, "x-trim": len ? "skipped" : "off" } });

  const raw = await up.text();
  if (raw.length > TRIM_MAX) return new Response(raw, { status: 200, headers: { ...headers, "x-trim": "skipped" } });
  let body;
  try {
    body = JSON.stringify(prune(JSON.parse(raw)));
  } catch (e) {
    return new Response(raw, { status: 200, headers: { ...headers, "x-trim": "unparsed" } });
  }
  const res = new Response(body, { status: 200, headers: { ...headers, "x-trim": `${raw.length}>${body.length}` } });
  if (ctx) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
