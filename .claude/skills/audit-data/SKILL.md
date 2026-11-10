---
name: audit-data
description: List every number shown on a nathanskown.dev page and trace where it comes from (data file or API field, the job that writes it, the original public source, and whether the publishing gate checks it). Use when the owner asks where a number comes from, whether a page can be trusted, or to audit a page.
argument-hint: "<page path or URL, e.g. /finance/macro/>"
---

# /audit-data

Goal: a table of **every number on one page** and its full trail back to a public source, with anything that breaks
the CLAUDE.md data rules flagged. This skill only reads. It changes nothing unless the owner asks for fixes afterward.

## 1. Find the page's code
- Map the address to files: `/finance/<route>/` and `/sports/<route>/` → the design in `src/<section>/*.dc.html`
  (look up the route in `tools/build_pages.py` `SECTIONS`), plus the scripts that section loads
  (`assets/finance-ui.js`, `assets/sports-data.js`, `assets/dc-runtime.js`, `assets/glossary.js`).
  Other pages → their own `index.html` and any `<script src>` they load (e.g. `assets/landing.js`, `music/assets/*.js`).
- No page given? Ask which one.

## 2. Collect every number
Work from both ends so nothing is missed:
- **Code side**: every `fetch(...)` / data URL (`/data/...json`, `/api/...`) and which fields the page reads from each
  response. Every template binding (`{{...}}`, `textContent =`, `innerHTML` building) that prints a number, percent,
  price, count, date, probability or record. And every digit typed directly into markup or JS that a visitor sees
  (including "fallback" or starting values).
- **Screen side**: open the live page (`https://nathanskown.dev<path>`) in the built-in browser and
  `get_page_text`. Pull every number on screen and match each one to a code-side entry. Anything on screen you can't
  match is a finding.
- Repeated rows (a table of 500 stocks) count as **one entry per column**, not per row.

## 3. Trace each one back
For each number record:
1. **On the page**: the label or panel it appears in, and an example value.
2. **Read from**: `data/<file>.json` → field path, or `/api/<endpoint>?part=...` → field (handler in `worker/*.js`),
   or "calculated in the page from X and Y", or **"typed by hand"**.
3. **Written by**: the pipeline function (`grep -rn '<filename>' pipeline/ tools/`) and the workflow and schedule
   (`.github/workflows/*.yml` cron, in plain words: "hourly in trading hours"). For `/api/`, the Worker fetches it live.
4. **Original source**: the public host it really comes from (SEC EDGAR, FRED, Yahoo, ESPN…), from the pipeline or Worker code.
5. **Checked before publishing?** Whether `tools/validate_data.py` `rule_for` covers that file, and what it checks.
6. **Freshness label**: does the page show when it was updated, and the delay if there is one?

## 4. Flag rule breaks (CLAUDE.md)
- 🔴 **Hand-typed** number in page markup or JS (anything other than `data/finance/editorial.json` with a source link).
- 🔴 **No source found**: can't trace it to a file, API or calculation.
- 🔴 Source **not on the approved list**.
- 🟡 **Not checked** by the publishing gate.
- 🟡 **No "updated" time** on its panel, or a delay that isn't labeled (prices ~15 min, 13F a quarter).
- 🟡 **Stale**: the file's own timestamp is older than its schedule implies. Compare it with the cadence in
  `nathanskown-desktop-widget` / `status/index.html`.
- 🟡 Editorial numbers with no source link or no written date.

## 5. Report
In chat, plain words:
1. One-line verdict ("31 numbers, all traced; 2 not checked by the gate; 1 hand-typed").
2. The table: **Number · Where on page · Read from · Written by (schedule) · Original source · Gate-checked · Flags**.
3. Flagged items first in a short list, each with the file and line and a one-sentence fix.
Then ask whether to fix the flagged items. Don't fix anything without a yes.
