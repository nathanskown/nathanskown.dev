# Music section for nathanskown.dev

Two guessing games, built to run in **mock mode** (placeholder songs and artists, nothing external called)
until you connect the APIs.

| Folder | What it is | Where it goes |
|---|---|---|
| `music/` | The website pages: hub, Guess the Track, Guess the Artist, shared styles, data | Your site folder, so it is served at `nathanskown.dev/music/` |
| `worker/music-api/` | A small Cloudflare Worker that looks up fresh Deezer preview links | Deployed separately on Cloudflare (not part of the site folder) |
| `tools/build-artist-catalog.mjs` | Builds the real artist and song data from Last.fm and MusicBrainz | Repo root, next to your site folder |
| `.github/workflows/refresh-artists.yml` | Button (and optional weekly schedule) that runs the build script on GitHub. When you click "Run workflow" it asks which branch to build into (default `music`), so your live site is untouched until you merge | Repo root |

## Try it now (no setup)
Open `music/index.html` in a browser. Everything works in mock mode. Tick "show dev tools" at the bottom of a
page to peek at answers while testing.

## Going live (see the walkthrough in the chat for step-by-step)
1. **Last.fm data (Guess the Artist):** get a Last.fm API key, add it to GitHub as a secret, run the workflow.
2. **Deezer previews (Guess the Track):** get Deezer's OK, deploy the Worker, paste its address into `music/assets/config.js`.
3. Set `MODE: "live"` in `music/assets/config.js`.
4. Replace the badge placeholders with the official logos, add a contact link to your site footer, remove the `noindex` tags.

## Settings
`music/assets/config.js` is the only file you edit to switch modes. The colors are variables at the top of `music/assets/music.css`.

## If your repo is laid out differently
The build script writes to `music/data` by default. If your site lives in a subfolder (for example `website/music`),
set `OUT_DIR` in the workflow's `env:` block (for example `OUT_DIR: website/music/data`) and change the two
`git add` paths in the workflow to match.

## Tests that were run on this code
Page play-throughs of all three pages (mock and live paths, with a stubbed Worker and audio), 17 Worker tests against a
stubbed Deezer, and 16 builder tests against fake Last.fm and MusicBrainz servers. None of these touched the real services;
the first run against them is yours, and the walkthrough has a check for each one.
