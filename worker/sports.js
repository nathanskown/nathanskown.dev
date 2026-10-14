// Live sports data for the Sports pages: a thin, cached pass-through to ESPN's public site API.
//
//   /api/espn/site/v2/sports/football/nfl/scoreboard      -> https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
//   /api/espn/v2/sports/hockey/nhl/standings?level=3      -> https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings?level=3
//
// The Worker never parses the payload (the free plan's CPU limit is tight and some responses are
// over 1 MB); pages normalize it in the browser with assets/sports-data.js. Only an allowlist of
// paths and query parameters is forwarded, and every response is cached at the edge so a busy page
// costs ESPN one request per cache window, not one per visitor.

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

export async function handleEspn(request) {
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

  return new Response(up.body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${Math.min(ttl, 300)}`,
      "access-control-allow-origin": "*",
      "x-upstream": "espn",
    },
  });
}
