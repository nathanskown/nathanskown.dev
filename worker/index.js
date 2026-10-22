// Site entry point on Cloudflare Workers. Static files (pages, data JSON) are served straight
// from the assets upload; only requests that match no file reach this code.
import { handleQuote } from "./quote.js";
import { handleEspn } from "./sports.js";
import { handleLive } from "./live.js";
import { handleMusic, serveDaily, MusicBoard } from "./music.js";

export { MusicBoard };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/quote") return handleQuote(request, env, ctx);
    if (url.pathname.startsWith("/api/espn/")) return handleEspn(request, ctx);
    if (url.pathname === "/api/live") return handleLive(request, env, ctx);
    if (url.pathname.startsWith("/api/music/")) return handleMusic(request, env);
    if (url.pathname === "/music/data/daily.js") return serveDaily();
    return env.ASSETS.fetch(request); // falls through to 404.html for unknown paths
  },
};
