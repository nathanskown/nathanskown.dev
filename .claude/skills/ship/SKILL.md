---
name: ship
description: Preview pending nathanskown.dev changes on phone and desktop sizes, check them against CLAUDE.md, and push to main (live) only after the owner explicitly approves.
disable-model-invocation: true
---

# /ship

Publishing is live and public: a push to `main` reaches nathanskown.dev in a minute or two. **Nothing is pushed
until the owner says yes to this specific change in this conversation.** An earlier yes doesn't count for a new change.

## 1. What's going out
- `git status` and `git diff` (plus any unpushed commits: `git log origin/main..HEAD`).
- Summarize every changed file in one plain sentence each. If nothing changed, say so and stop.
- If anything under `src/` changed, run `python3 tools/build_pages.py`. If `assets/` or `music/assets/` changed,
  run `python3 tools/stamp_assets.py`. Include the regenerated files.

## 2. Rule check (CLAUDE.md). Any failure blocks shipping until fixed or the owner overrides.
- **Secrets**: `git diff` must not contain keys, tokens or passwords
  (`grep -iE '(api[_-]?key|token|secret|password)\s*[:=]'`, long random strings). Hard stop.
- **Private info**: no personal email, phone or address, nothing from the private dashboard, nothing from the owner's employer.
- **Music answers**: no daily-challenge answers or schedule in any committed file.
- **Colors**: new hex colors in the diff must be the section's locked colors or derived shades, or up/down/warn.
- **Numbers**: no hand-typed numbers in page markup or JS (editorial.json with a source link is the only exception).
- **Words**: no investment advice, no betting tips, no mock/sample/placeholder data, delays labeled.
- Generated files (`finance/**/index.html`, `sports/**/index.html`) must match their `src/` design. Rebuild if unsure.

## 3. Preview
1. Start the local server from Bash in the background (macOS privacy blocks the app's own launcher from reading
   the Desktop folder, so `preview_start` can't start it itself):
   `cd <repo> && exec python3 -m http.server 8788 --bind 127.0.0.1` with `run_in_background`.
   Then `preview_start` with name `site`. The `.claude/launch.json` entry only attaches to that URL
   (`{"name":"site","url":"http://localhost:8788","port":8788}`). Navigate to each page by full `http://localhost:8788/...` URL.
2. Open each changed page. Note for the owner: the local preview serves pages and `data/` files, but `/api/...`
   (live quotes, ESPN scoreboards, music leaderboard) only work on the real site, so those panels may be empty here.
3. **Phone**: `resize_window` preset `mobile` (375×812), reload, screenshot. Run
   `document.documentElement.scrollWidth > window.innerWidth` and it must be `false` (no sideways scroll).
4. **Desktop**: `resize_window` preset `desktop`, reload, screenshot.
5. `read_console_messages` with `onlyErrors`. Report any errors that aren't caused by the local `/api/` gap.
6. Reset the window to `desktop` when done.

## 4. Ask for approval
Show the owner: the plain-words change list, the rule-check result, the phone and desktop screenshots, and any problems.
Then ask one question: **"Push this live to nathanskown.dev?"** Stop and wait. If the answer isn't a clear yes, don't push.

## 5. Push (only after "yes")
1. `git pull --rebase origin main`. The data bots push every hour. If the rebase conflicts, stop and explain.
2. Commit only the files from step 1 (`git add <files>`, never `git add -A` blindly), with a short plain message
   describing the change, ending with the attribution line the session gives you.
3. `git push origin main`. Never `--force`. If the push is rejected for authentication, tell the owner that GitHub
   sign-in isn't set up on this Mac and stop. Don't type or ask for passwords or tokens.

## 6. Confirm it's live
- Wait about 2 minutes, then fetch each changed page from `https://nathanskown.dev/...` (built-in browser) and
  confirm the change is there and the page has no console errors. Check the phone size once more on the live page.
- If `worker/` changed, the "Check live site" GitHub workflow runs on its own. Mention it.
- Report: what went live, the commit, and the live link(s).
