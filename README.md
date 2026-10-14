# nathanskown.dev

Personal terminal for market analysis and sports. Static site: plain HTML, CSS and JavaScript, hosted on Cloudflare Pages; every push to `main` deploys automatically.

- `index.html`, `assets/landing.js`, `assets/site.css`: landing page (green)
- `finance/`: Market Analysis, 7 pages (amber)
- `sports/`: scores, 4 game pages, 7 team pages, 8 tool pages on the way (cyan)
- `src/<section>/*.dc.html`: the page designs, the source of truth for `finance/` and `sports/`
- `assets/dc-runtime.js`: renders those designs in the browser (links, deep links like `?mode=1` or `?ticker=PRSM`, and the command line)

To change a finance or sports page: edit its file in `src/`, then run `python3 tools/build_pages.py` and commit the result. Routes and page titles live in `tools/build_pages.py`.
