/* ============================================================
   MUSIC SECTION SETTINGS  (the only file you edit to go live)

   MODE
     "mock" : placeholder songs and artists, synthesized stand-in audio.
              Nothing external is called. This is the safe default.
     "live" : Guess the Track plays real 30-second previews through your
              Cloudflare Worker (Deezer). Guess the Artist uses the
              catalog built from Last.fm (data/artists.js).

   WORKER_URL
     The address of your deployed Cloudflare Worker, with no trailing
     slash, e.g. "https://music-api.your-name.workers.dev".
     Only needed for Guess the Track in live mode.
   ============================================================ */
window.MUSIC_CONFIG = {
  MODE: "live",
  WORKER_URL: "https://music-api.nskown.workers.dev",   // Deezer preview lookups
  LB_URL: "/api/music",                                  // daily leaderboard, served by the site Worker
  ROUND_SIZE: 5,
  SUGGEST_MIN: 4   // autocomplete waits for this many characters (answers never depend on it)
};
