# nathanskown.dev

A personal terminal for market analysis, sports and music. Plain HTML, CSS and JavaScript, served by a
Cloudflare Worker with static assets; every push to `main` deploys automatically.

## Sections

| Path | What it is | Color |
|---|---|---|
| `index.html`, `assets/landing.js`, `assets/site.css` | Landing page: command line, section cards, live "Right Now" panel | green |
| `finance/` | Market Analysis: dashboard, digest, headlines, quotes (any US ticker), 13F ownership, earnings, macro, IPOs | amber |
| `sports/` | Scores, game center, team pages, playoff odds, simulator, injuries, track record | cyan |
| `music/` | Guess the Track, Guess the Artist | purple |

## How pages are built

- `src/<section>/*.dc.html` are the page designs and the source of truth for `finance/` and `sports/`.
  After editing one, run `python3 tools/build_pages.py` and commit the result. Routes, titles and page
  descriptions live in `tools/build_pages.py`.
- `assets/dc-runtime.js` renders those designs in the browser: links, deep links (`?sym=AAPL`,
  `?lg=nfl&id=8`), formatters and the command line with type-ahead over every US ticker.

## Visitor settings

Nothing is tuned to one person. Choices are kept in the visitor's own browser (localStorage), so they
don't follow anyone to another device:

- Times show in the visitor's time zone; market hours and "today" for the exchanges stay on New York time.
- Sports: followed teams (★ FOLLOW on any team page) fill the favorites bar and lead the landing page's Right Now.
- Market Analysis: dashboard tiles, panel order, watchlist and start page (⚙ CUSTOMIZE); headline and earnings
  filters; recently viewed tickers.
- Music: pool filters (genre families and eras, multi-select) and recently played songs and artists, which
  random rounds skip. Rounds and daily challenges are spread across genres with `music/assets/variety.js`.
  The daily challenge rolls over at midnight US Central for everyone so the leaderboard is one shared day.
  It is scored on the Worker (`worker/music.js`, a Durable Object): answers and the schedule never reach the browser.

## Live data

- **Static data files** under `data/` are written by GitHub Actions and committed, which redeploys the site:
  - `refresh-finance.yml`: market data hourly in trading hours, daily quotes/earnings/IPOs/macro, monthly 13F check
  - `refresh-sports.yml`: hourly while games are on (9 AM to 1 AM Central) plus a daily run
  - `refresh-daily.yml`: picks missing upcoming daily-challenge days at random and uploads them privately to the Worker (never committed)
  - `stamp-updated.yml`: writes `data/lastupdated.json` after each site change (shown as LAST UPDATED on the homepage)
  - `refresh-artists.yml`: rebuilds the music catalog (manual, and once whenever the builder or genre mapping changes)
  - `history-sports.yml`: one-off sports history
- **On-demand APIs** run in the Worker (`worker/`, config in `wrangler.jsonc`):
  - `/api/quote`: prices (Yahoo), financials and filings (SEC) for any ticker outside the core list
  - `/api/espn/...`: cached, trimmed pass-through to ESPN's public scoreboards and schedules
- `smoke-api.yml` checks the live site after Worker changes deploy; results show as annotations on the run.

## Secrets (GitHub > Settings > Secrets and variables > Actions)

| Name | Needed for |
|---|---|
| `FRED_API_KEY` | Macro page (FRED blocks the keyless download from GitHub's servers) |
| `OPENFIGI_KEY` | Optional: faster CUSIP-to-ticker matching in the 13F build |
| `CFBD_KEY`, `ODDS_API_KEY` | Optional sports sources |
| `LASTFM_API_KEY` | Music catalog builder |
| `MUSIC_ADMIN_TOKEN` | Daily challenge: same value as the Worker secret of that name (`wrangler secret put MUSIC_ADMIN_TOKEN`), 24+ random characters |

## Editing what's tracked

`data/finance/config.json` holds the core watch list (quote pages built nightly), news feeds and index
fund managers. Any other ticker is fetched on demand, so it doesn't need to be listed there.
