---
name: new-page
description: Build a new page for nathanskown.dev that follows the site rules in CLAUDE.md (terminal look, locked section colors, numbers only from data files or APIs). Use when the owner asks for a new page, tool, dashboard or view on the site.
argument-hint: "[section] [what the page should show]"
---

# /new-page

Build one new page that follows every rule in `CLAUDE.md`. Read `CLAUDE.md` first, every time.

## 1. Pin down the page (ask one question at a time, only for what's missing)
- **Section**: Markets (`finance/`), Sports (`sports/`), Music (`music/`) or site-level (green). This decides the color and stylesheet.
- **Address**: e.g. `/finance/dividends/`. Check it isn't taken (`ls`, `tools/build_pages.py` routes, `sitemap.xml`).
- **What it shows**: the panels, in order, in the owner's words.
- **Where each number comes from**: for every number, find the existing file in `data/` or `/api/` endpoint
  (`worker/*.js`) that already has it. If none does:
  - it needs a new pipeline field from an approved source → say so plainly and plan it as part of this page, or
  - it needs a source **not on the approved list** → **stop and ask the owner** before going further.

Repeat the plan back in a few plain lines (address, color, panels, the data file for each panel) and get a yes before building.

## 2. Build it the way that section is built
- **Markets / Sports**: copy the closest existing design in `src/<section>/` as the starting point, so the
  header, command line, function-key bar (`t-fbar`) and panels match. Save as `src/<section>/<Name>.dc.html`.
  In `tools/build_pages.py` add the page to `SECTIONS[...]["pages"]`, `["routes"]` and `PAGE_DESC`.
  Add a function-key link to it in the other designs' `t-fbar` only if the owner wants it in the main menu.
  Then run `python3 tools/build_pages.py`. Never hand-edit the generated `index.html`.
- **Music**: copy `music/leaderboard/index.html` as the shell, use `music/assets/music.css` classes (`.mx-*`, `.panel`).
- **Site-level**: copy the head and chrome of `status/index.html` or `404.html`, use `assets/site.css` (`.nk-*`).
- Hand-written pages: same `<head>` pattern as their neighbors (title `<Name> · NSKN Terminal`, description,
  canonical, og tags, favicon, theme-color, the IBM Plex Mono + VT323 font link).
- Run `python3 tools/stamp_assets.py` if any file in `assets/` or `music/assets/` changed.

## 3. Rules to build in, not bolt on
- Colors: only the section's variables (`var(--a)`, `var(--g)`, `var(--hi)`, `var(--dim)`…) plus up `#4ade80`,
  down `#ff5f56`, warn `#ffb84d`. No new hex colors.
- Numbers: fetched at load from `data/...json` or `/api/...`. No digits typed into the markup, not even as a starting value.
  While loading or when missing, show `—`, never a sample.
- Each data panel's header or footer says the source and "updated <time ago>" from the file's own timestamp.
- Market prices say "delayed ~15 min". 13F says it lags a quarter. Market pages end with "Not investment advice."
- Betting lines, if shown: labeled with source and time, never framed as a pick to bet. Update the Under the Hood
  "no betting lines" sentence if this is the first page to show them.
- Phone: no sideways scroll at 375px, tap targets ≥ 44px, inputs ≥ 16px font.
- Text sizes: only the named sizes from CLAUDE.md "Type" (`var(--fs)` for body, `--fs-sm`, `--fs-md`…), never a raw
  pixel size under 16px, nothing under 12px, wide letter-spacing written as `calc(…em*var(--ls,1))`.
- New data file? Add a check for it in `tools/validate_data.py` (`rule_for` plus a check function).
- New source the owner approved? Add a row to the "Sources and what they feed" table in `under-the-hood/index.html`.
- Add the page to `sitemap.xml`.

## 4. Check your own work before handing over
1. `grep -noE '#[0-9a-fA-F]{6}\b'` on the new and changed files. Every hex must be a section color, a derived
   shade already in that section's stylesheet, black/near-black, or up/down/warn.
2. `grep -niE 'lorem|mock|sample|placeholder|TODO|xxx|buy now|price target|you should (buy|sell)'`. Fix anything real.
3. `grep -niE '(api[_-]?key|token|secret|password)\s*[:=]'`. Nothing may be hard-coded.
4. Run the `/audit-data` steps on the new page. Every number needs a source; fix any flagged as hand-typed.
5. Preview it locally (the `/ship` preview steps) at phone and desktop size and fix layout problems.

## 5. Hand over
List each file created or changed with one plain sentence on what it does. Then say it's ready and the owner can
run `/ship` to approve and publish it. **Do not commit or push from this skill.**
