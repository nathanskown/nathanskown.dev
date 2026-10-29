// Site entry point on Cloudflare Workers. Static files (pages, data JSON) are served straight
// from the assets upload; only requests that match no file reach this code.
import { handleQuote } from "./quote.js";
import { handleEspn } from "./sports.js";
import { handleLive } from "./live.js";
import { handleMusic, serveDaily, MusicBoard } from "./music.js";

export { MusicBoard };

/* One canonical address: https://nathanskown.dev. www and plain http get a permanent redirect that keeps the path and query.
   Local development and the *.workers.dev preview address are left alone. */
const APEX = "nathanskown.dev";
export function canonicalRedirect(url) {
  const host = url.hostname.toLowerCase();
  const ours = host === APEX || host === "www." + APEX;
  if (!ours) return null;
  if (host === "www." + APEX || url.protocol === "http:") {
    const to = new URL(url.toString());
    to.protocol = "https:";
    to.hostname = APEX;
    to.port = "";
    return new Response(null, { status: 301, headers: { location: to.toString(), "cache-control": "public, max-age=3600" } });
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const moved = canonicalRedirect(url);
    if (moved) return moved;
    if (url.pathname === "/api/quote") return handleQuote(request, ctx);
    if (url.pathname.startsWith("/api/espn/")) return handleEspn(request, ctx);
    if (url.pathname === "/api/live") return handleLive(request, env, ctx);
    if (url.pathname.startsWith("/api/music/")) return handleMusic(request, env);
    if (url.pathname === "/music/data/daily.js") return serveDaily();
    return env.ASSETS.fetch(request); // falls through to 404.html for unknown paths
  },
};
