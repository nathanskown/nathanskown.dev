---
name: check-data
description: Check nathanskown.dev for stale data shown as current (prior-day moves on the quotes strip, watchlist or homepage, an old Digest under today's date, pre-market wording after the open, companies that already reported still listed as upcoming, the homepage lagging the close). Use when the owner asks whether the site's numbers are current, before /ship, or after changing finance pages, the pipeline or a workflow.
argument-hint: "[--live]"
---

# /check-data

Goal: tell the owner, in plain words, whether anything on the site is showing old numbers as if they were current.
This skill only reads. It changes nothing unless the owner asks for fixes afterward.

## 1. Run the check
- From the repo root: `python3 tools/check_freshness.py` checks the data files in the repo (what the site serves,
  since every push to `main` deploys). Pull first (`git pull --rebase origin main`) so you see the bots' latest data.
- `--live` reads the same files from `https://nathanskown.dev` instead. If it can't connect, use the repo files and
  say so.
- The result depends on the time of day (New York market hours), so state the time it ran. To see how the site
  would look at another moment, add `--now 2026-11-10T21:30:00Z`.

## 2. What it looks at
| Page | Check |
|---|---|
| Dashboard + Home (`dashboard.json`) | refreshed hourly while open; index tiles not showing yesterday's move as today's; post-close snapshot after 4 PM ET |
| Quotes strip + Watchlist (`quotes/index.json`, `dashboard.json` watch) | nightly prior-session numbers shown during the session |
| Digest (`digest.json`, `editorial.json`, `src/finance/Digest.dc.html`) | edition date vs today; pre-market wording after the open; prior session written up as today's; old hand-written edition as first paint; filler lines |
| Earnings (`earnings.json`, Digest "reporting today") | past dates or BMO names still upcoming after 9:30 ET; AMC names with no results by evening |
| Data files | each file's `updated` against its schedule |

## 3. Report
1. One line: how many STALE and WARN items, and the time it ran (ET).
2. STALE items first, each in one plain sentence with the page and the fix the script suggests.
3. WARN items briefly.
Then ask whether to fix the STALE items. Don't fix anything without a yes, and ship fixes only through `/ship`.

## 4. Keeping the check honest
- A new data file or page that shows time-sensitive numbers gets a check in `tools/check_freshness.py` in the same change.
- Extend `HOLIDAYS` / `EARLY_CLOSE` in the script each December from the NYSE calendar.
- If a rule fires wrongly, fix the rule in the script rather than ignoring it, and say so in the report.
