// Site entry point on Cloudflare Workers. Static files (pages, data JSON) are served straight
// from the assets upload; only requests that match no file reach this code.
import { handleQuote } from "./quote.js";
import { handleEspn } from "./sports.js";
import { handleLive } from "./live.js";
import { handleMusic, MusicBoard } from "./music.js";

export { MusicBoard };

/* Security headers on every response. The pages use inline scripts and styles, so the policy allows them, but it
   pins down where scripts, connections, frames and forms may come from. Add a host here when the site starts using one. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https://music-api.nskown.workers.dev https://en.wikipedia.org",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const SECURITY = {
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "x-frame-options": "SAMEORIGIN",
};

/* Files are not renamed per deploy, so caching is short for code and longer for pictures. HTML is left alone
   (always revalidated). Data files are fetched with a ?v= that changes every 5 minutes, so 5 minutes is safe. */
function cacheRule(path) {
  if (/\.(?:png|jpe?g|webp|svg|ico|woff2?)$/i.test(path)) return "public, max-age=604800";
  if (/\.(?:css|js)$/i.test(path)) return "public, max-age=300, stale-while-revalidate=3600";
  if (path.startsWith("/data/") && path.endsWith(".json")) return "public, max-age=300";
  return null;
}

function finish(resp, url) {
  const h = new Headers(resp.headers);
  for (const [k, v] of Object.entries(SECURITY)) h.set(k, v);
  if ((h.get("content-type") || "").includes("text/html")) h.set("content-security-policy", CSP);
  if (resp.status === 200 && !url.pathname.startsWith("/api/") && /max-age=0/.test(h.get("cache-control") || "")) {
    // a ?v=<hash> URL changes whenever the file does (tools/stamp_assets.py), so it can be cached for a year
    const rule = /^[0-9a-f]{8}$/.test(url.searchParams.get("v") || "") && /\.(?:css|js)$/i.test(url.pathname)
      ? "public, max-age=31536000, immutable" : cacheRule(url.pathname);
    if (rule) h.set("cache-control", rule);
  }
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);

    // one canonical address: https, no www
    if (!local && (url.protocol === "http:" || url.hostname === "www.nathanskown.dev")) {
      url.protocol = "https:";
      url.hostname = "nathanskown.dev";
      return new Response(null, { status: 301, headers: { location: url.toString(), "strict-transport-security": SECURITY["strict-transport-security"] } });
    }

    let resp;
    if (url.pathname === "/api/quote") resp = await handleQuote(request, ctx);
    else if (url.pathname.startsWith("/api/espn/")) resp = await handleEspn(request, ctx);
    else if (url.pathname === "/api/live") resp = await handleLive(request, env, ctx);
    else if (url.pathname.startsWith("/api/music/")) resp = await handleMusic(request, env);
    else resp = await env.ASSETS.fetch(request); // falls through to 404.html for unknown paths
    return finish(resp, url);
  },
};
