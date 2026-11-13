# nathanskown.dev: rules for this site

NSKN Terminal: markets, sports and music in one retro trading-terminal site. Plain HTML/CSS/JS served by a
Cloudflare Worker. **Every push to `main` is live within a minute or two**, and data bots push to `main` every hour.
The owner is not a programmer: explain changes in plain words, one sentence each.

## How pages are made
- `finance/` and `sports/` pages are **generated**. Edit the design in `src/<section>/*.dc.html`, register routes,
  titles and descriptions in `tools/build_pages.py`, then run `python3 tools/build_pages.py`. Never hand-edit
  `finance/**/index.html` or `sports/**/index.html`.
- Home, About, Career, Under the Hood, Status, Editions and `music/` are hand-written HTML.
- After changing anything in `assets/` or `music/assets/`, run `python3 tools/stamp_assets.py` (build_pages does it for you).
- `data/` is written by GitHub Actions (`pipeline/`, `.github/workflows/`). Don't hand-edit data files. The one
  exception is `data/finance/editorial.json` (see Sources).
- Anything that shouldn't be served as a public file goes in `.assetsignore`.

## Look (every page, no exceptions)
Terminal style everywhere, including one-off pages like About and Career:
- Black background, glowing monospace text: **IBM Plex Mono** for text, **VT323** for big numbers and headlines.
  No other fonts. No light mode, no rounded cards, no gradients-as-decoration, no stock photos.
- Terminal chrome: title bar (`1-NSKN` brand, live dot, clock), command line, colored function-key bar,
  section sub-bar, numbered panels with a colored header band. Scanlines as a `body::after` overlay.
- Reuse the section's stylesheet and classes. Don't invent new chrome:
  Markets and Sports use `assets/finance.css` / `assets/sports.css` (`.t-*` classes), home and story pages use
  `assets/site.css` (`.nk-*`), Music uses `music/assets/music.css` (`.mx-*`).
- Phone: works at 375px wide with no sideways scrolling, tap targets at least 44px, inputs at 16px (stops iOS zoom).

## Type (text sizes)
- **Use the named sizes, never a raw pixel size under 16px.** They're defined at the top of each section stylesheet
  (and in the `<style>` of the standalone pages: About, Under the Hood, Status, Career, Editions):

  | Name | Desktop | Phone (≤760px) | Use for |
  |---|---|---|---|
  | `var(--fs-xs)` | 12px | 12px | tiny keys and badges only (`GO`, `START HERE`) |
  | `var(--fs-sm)` | 13px | 13.5px | secondary notes, captions |
  | `var(--fs)` | 14px | 15px | body text, table rows, most labels |
  | `var(--fs-md)` | 15px | 16px | panel titles, emphasized lines |
  | `var(--fs-lg)` | 16px | 17px | lead sentences |

  16px and up (inputs, headlines, VT323 big numbers) may stay as fixed sizes.
- **Nothing under 12px**, ever. Relative sizes (`.82em`, `<small>`) are written as `max(var(--fs-xs), .82em)`.
- **Wide letter-spacing** (`.08em` and up, mostly on uppercase labels) is written `calc(.12em*var(--ls,1))` so it
  tightens on phones (`--ls` is .55 there) instead of wrapping.
- **Glow**: body and table text gets only a faint 3px glow, so small text stays sharp. Headlines (`h1`) and big numbers
  (`.big`) keep the full glow. Scanlines stay light (about 9-10% dark).
- **Fonts**: buttons and form fields inherit the page font. Markets and Sports set this with
  `:where(.t) :where(button,input,select,textarea){font-family:inherit…}`, so nothing falls back to Arial.
- Text meant to be read must contrast at least 4.5:1 with its background. Decoration-only shades (`--deco` in Music,
  `--mute` in Home/Markets/Sports) are never used for text people need to read.

## Colors (locked)
| Section | Main color | Where |
|---|---|---|
| Home, About, Career, Under the Hood, Status, 404 | green `#8dff9c` | `assets/site.css` `--g` |
| Markets (`finance/`) | amber `#ffb84d` | `assets/finance.css` `--a` |
| Sports (`sports/`) | cyan `#66e6f2` | `assets/sports.css` `--a` |
| Music (`music/`) | purple `#d58bff` | `music/assets/music.css` `--g` |

- Shades (highlight, dim, lines, bands) are always derived from the section color, never picked freely.
- Up / good = green `#4ade80`. Down / bad = red `#ff5f56`. Warning = `#ffb84d`. Same on every page.
- Music keeps green/red only for correct/wrong answers.
- When a page links to another section (homepage cards, Under the Hood tiles), that link uses the other section's color.
- Known strays to fix when you touch those files: `#3df2ff` (Under the Hood sports color, should be `#66e6f2`) and
  `#ffbf3a` (homepage and About markets color, should be `#ffb84d`).

## Data sources
- **Every number on a page is read from a file in `data/` or an `/api/` call when the page loads.** No numbers typed
  into HTML or JS, not even as "fallback" starting values.
  - Only exception: written editorial (`data/finance/editorial.json`). Hand-typed numbers are allowed there only
    with a source link beside them and the date it was written shown on the page.
- Approved sources: SEC EDGAR, FRED, Yahoo Finance, U.S. Treasury, Nasdaq, Kalshi, iShares, Wikipedia (index lists),
  ESPN public API, MLB Stats API, MoneyPuck, nflverse, CollegeFootballData, The Odds API, SportsGameOdds,
  Deezer, Last.fm, MusicBrainz.
- **New source → stop and ask the owner first.** If approved, it must be free and public, its terms must allow
  automated use, and it gets added to the "Sources and what they feed" table on `under-the-hood/index.html` in
  the same change (plus the CSP `connect-src` in `worker/index.js` if the browser calls it directly).
- A new data file needs a check in `tools/validate_data.py`, so bad data is held back instead of published.
- Every data panel shows its source and when it was last updated. Labels stay true: market prices "delayed
  ~15 min", 13F "lags a quarter".

## Data freshness (what "today" means)
Stale numbers shown as current are the most common way this site is wrong. These rules hold on every page.
- **Markets run on New York time.** "Today" is the current NYSE session. Before 9:30 AM ET, on weekends and on
  holidays, every move on the site is the **prior session's**: label it as the prior close (e.g. "Mon close"),
  never as today's, and never under today's date as if it were live.
- **Every number shows its as-of time**: date and time in the visitor's zone, from the data itself (`updated`,
  `asOf`, a quote's trade time), not a generic "updated hourly".
- **Digest**: an edition appears only under the date it was written for. The hand-written edition
  (`editorial.json`) shows only when its date matches today's digest; otherwise the auto story, or "loading" while
  `digest.json` loads. Never paint an old edition first. No pre-market wording ("futures point", "before the open")
  after 9:30 ET; before the open, describe the prior session in past tense and lead with futures.
- **Earnings**: a company leaves "Upcoming" once its report time has passed (before-the-open names at 9:30 ET,
  after-the-close names by about 5:30 PM ET), even if the EPS hasn't arrived yet: show "reported, results pending".
- **Nightly files are prior-session numbers.** `data/finance/quotes/index.json` (written ~6 AM CT) may be used for
  first paint only, labeled as the prior close, until live data replaces it. Same for the dashboard watchlist.
- **After the close**, the homepage and dashboard (both read `data/finance/dashboard.json`) must show the closing
  numbers, not an intraday snapshot.
- **When a source fails**, keep the last good value with its real date. Never re-date old data, never guess.
- **Check it**: run `python3 tools/check_freshness.py` (`/check-data`) after changing finance pages, `pipeline/` or
  a workflow, and before every `/ship`. Anything STALE blocks shipping unless the owner says to go ahead.
  The NYSE holiday list in that script covers 2026-2027; extend it each December.

## Must never appear
On any page:
- **Investment advice**: no buy/sell/hold calls, price targets or "you should". Market pages say "Not investment advice."
- **Unlabeled delayed or stale data**: delays are labeled, and every panel shows when it was last updated.
- **Placeholder or mock numbers**: no lorem ipsum, sample data, `MODE: "mock"`, made-up or hand-typed figures.
  A blank or `—` is better than a guess.

On the site **or anywhere in the public repo** (including commit messages):
- **Secrets**: API keys, `MUSIC_ADMIN_TOKEN`, passwords. They live only in GitHub and Cloudflare secrets.
- **Music daily-challenge answers or schedule**: only the Worker knows them.
- **The owner's private info**: nothing from the private dashboard (calendar, reminders, mail), no personal
  email, phone or address. Public contact is the GitHub link and the digest address already on the homepage.
- **Employer confidential info**: nothing non-public from the owner's investor-relations work.

## Betting lines
Sportsbook lines **may** be shown when they're labeled with the source and the time, never as a tip or "best bet".
Under the Hood still says "no betting lines shown anywhere". Update that sentence the first time a page shows lines.

## Shipping
- Never push, merge or deploy without the owner's explicit "yes" for that specific change. Use `/ship`.
- Approved changes go straight to `main`: `git pull --rebase origin main` first (bots push hourly), never force-push.
- Check on a phone size (375×812) and desktop before asking for approval.

## Skills
- `/new-page`: build a page that follows these rules.
- `/ship`: preview on phone and desktop, then push live only after approval.
- `/audit-data`: list every number on a page and where it comes from.
- `/check-data`: flag stale data (yesterday's moves as today's, old Digest, already-reported earnings, homepage behind the close).
