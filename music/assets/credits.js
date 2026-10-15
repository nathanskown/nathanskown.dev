/* Sources & Credits panel + footer, rendered on every Music page.
   Usage: MX.renderCredits("credits", "track" | "artist" | "hub")
   The wording here is what visitors see. The "DEV NOTES" boxes only show when
   the "show dev tools" box in the footer is ticked. */
(function () {
  "use strict";

  const ABOUT =
    "<p><b>About.</b> The Music section is a free personal project. It has no ads, no paid features and no accounts. " +
    "Your personal bests stay in your own browser. If you choose to post a daily score to the leaderboard, the name you type " +
    "and your score are stored on Cloudflare and shown publicly (use any name you like, not your real one if you prefer); your " +
    "connection address is kept only as a one-way hash for about a day to limit spam. Nothing else is collected.</p>";

  const OWNERSHIP =
    "<p><b>Ownership.</b> Song titles, artist names, artwork and trademarks belong to their respective owners. " +
    "Deezer, Last.fm and MusicBrainz names and logos belong to them. This site is not affiliated with, sponsored by " +
    "or endorsed by Deezer, Last.fm, MusicBrainz or any artist, label or publisher.</p>";

  const REMOVE =
    "<p><b>Want something removed?</b> If you are an artist, label or rights holder and would like a song or artist " +
    "taken out, use the <a href='/#contact'>contact page</a> and it will be removed promptly.</p>";

  const AUDIO =
    "<p><b>Audio.</b> Song previews are 30-second clips streamed directly from Deezer's servers. " +
    "Streaming is for private, personal listening only. Clips are never downloaded, copied or stored on this site, " +
    "and every revealed song links back to Deezer.</p>";

  const DATA =
    '<p><b>Data.</b> Artist, track, genre-tag and ranking data comes from Last.fm. Release dates and countries come ' +
    "from MusicBrainz. Each revealed artist links back to its Last.fm page.</p>";

  const BADGES = {
    track: '<a class="badge" href="https://www.deezer.com" target="_blank" rel="noopener">Audio previews: Deezer</a>',
    artist: '<a class="badge" href="https://www.last.fm" target="_blank" rel="noopener">Data: Last.fm</a>',
    hub:
      '<a class="badge" href="https://www.deezer.com" target="_blank" rel="noopener">Audio previews: Deezer</a>' +
      '<a class="badge" href="https://www.last.fm" target="_blank" rel="noopener">Data: Last.fm</a>'
  };

  const DEV = {
    track:
      "<li><b>Get Deezer's OK in writing before launch.</b> Their terms limit use to non-commercial and to \"private use within a family scope\", " +
      "and say nothing about games. Anything they don't list needs their approval. Ask via developers.deezer.com/support and keep the reply.</li>" +
      "<li>Replace the Deezer placeholder with their official logo, used per their trademark guidelines.</li>" +
      "<li>Album art comes from Deezer's API. Ask about artwork in the same message, or set <code>SHOW_COVERS = false</code> in assets/sources.js.</li>",
    artist:
      "<li><b>Last.fm</b> allows non-commercial use only, requires a credit link, caps stored data at 100 MB, and must approve where the " +
      "\"powered by AudioScrobbler\" button appears. Request approval before launch.</li>" +
      "<li>Last.fm says cached data must follow the HTTP cache headers in its responses. Check them and keep the weekly refresh at least that frequent.</li>",
    hub:
      "<li>Remove the <code>noindex</code> tag from each page's head when you launch.</li>"
  };

  const COMMON_DEV =
    "<li>Every statement above must stay true to what you build. If you add analytics, cookies or the mailing list to these pages, update the About paragraph.</li>" +
    "<li>The site needs a real contact link in its footer for the takedown line to work.</li>";

  function build(kind) {
    let body = ABOUT;
    if (kind === "track" || kind === "hub") body += AUDIO;
    if (kind === "artist" || kind === "hub") body += DATA;
    body += OWNERSHIP + REMOVE;
    const live = (window.MUSIC_CONFIG || {}).MODE === "live";
    return (
      "<details open><summary>SOURCES &amp; CREDITS</summary>" + body +
      '<div class="credit">' + BADGES[kind] + "" + "</div>" +
      '<div class="devnote"><b>DEV NOTES · not shown on the live site</b><ul>' + DEV[kind] + (kind !== "hub" ? DEV.hub : "") + COMMON_DEV + "</ul></div>" +
      "</details>"
    );
  }

  MX.renderCredits = function (id, kind) {
    const el = MX.$(id);
    if (!el) return;
    el.className = "panel credits";
    el.innerHTML = build(kind);
  };

  MX.renderFooter = function (id) {
    const el = MX.$(id);
    if (!el) return;
    const dev = /[?&]dev(=|&|$)/.test(location.search);   // owner-only: add ?dev=1 to any music page's address
    const live = (window.MUSIC_CONFIG || {}).MODE === "live";
    el.className = "mx-status";
    el.innerHTML =
      '<span><span class="hi">&#9679;</span> LINK nathanskown.dev</span>' +
      "<span>MUSIC &middot; " + (live ? "LIVE" : "MOCK") + "</span>" +
      '<span><a href="/">&larr; Home</a> &middot; <a href="/music/">Music</a> &middot; <a href="/#contact">Contact</a></span>' +
      "<span>&copy; 2026 NATHAN SKOWN</span>" +
      (dev ? '<label><input type="checkbox" id="devToggle"> show dev tools</label>' : "");
    MX.initDevToggle();
  };
})();
