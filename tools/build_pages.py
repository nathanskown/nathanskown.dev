"""Build static pages from the .dc.html design files in src/.

Usage:  python3 tools/build_pages.py
Each page in SECTIONS below becomes <section>/<route>/index.html. The page
markup ships as a JSON tree that assets/dc-runtime.js renders, so the design
files stay the single source of truth. Generated files are committed as-is;
the host needs no build step.

Links inside a design use the design file names (e.g. "Game.dc.html?mode=1").
ROUTES maps those names to real URLs; a link with no page renders as text.
"""
import html
import json
import pathlib
import re
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent

FONTS = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=VT323&display=swap"

TOOLS = {
    "Simulator": "simulator", "Odds": "odds", "Injuries": "injuries",
    "LuckWatch": "luck-watch", "Schedule": "schedule-strength", "TrackRecord": "track-record",
    "Methodology": "methodology",
}
TOOL_TITLES = {
    "Simulator": "Matchup simulator", "Odds": "Playoff odds", "Injuries": "Injuries",
    "LuckWatch": "Luck watch", "Schedule": "Schedule strength", "TrackRecord": "Track record", "Methodology": "Methodology",
}
# Every team and game page is the generic Team/Game design reading ?lg=&id= (ESPN ids).
# These older short URLs stay as presets so existing links keep working.
TEAM_PRESETS = {
    "lions": ("nfl", "8", "Detroit Lions"), "tigers": ("mlb", "6", "Detroit Tigers"),
    "pistons": ("nba", "8", "Detroit Pistons"), "red-wings": ("nhl", "5", "Detroit Red Wings"),
    "msu-football": ("ncaaf", "127", "Michigan State Football"), "msu-basketball": ("ncaab", "127", "Michigan State Basketball"),
    "msu-hockey": ("ncaah", "127", "Michigan State Hockey"),
}
GAME_PRESETS = {"football": "nfl", "baseball": "mlb", "basketball": "nba", "hockey": "nhl"}

# section -> css, theme color, and pages: (route, source file, props, title)
SECTIONS = {
    "finance": {
        "desc": "Market dashboard, headlines, quotes for any US ticker, 13F ownership, earnings, macro and IPOs, refreshed through the trading day.",
        "css": "assets/finance.css",
        "theme": "#070402",
        "scripts": ["/assets/finance-ui.js", "/assets/glossary.js"],
        "pages": [
            ("", "Dashboard.dc.html", {}, "Market dashboard"),
            ("digest", "Digest.dc.html", {}, "Market digest"),
            ("headlines", "News.dc.html", {}, "Live headlines"),
            ("quote", "Main.dc.html", {}, "Stock quote"),
            ("ownership", "Ownership.dc.html", {}, "13F ownership tracker"),
            ("earnings", "Earnings.dc.html", {}, "Earnings dashboard"),
            ("macro", "Macro.dc.html", {}, "Macro monitor"),
            ("ipo", "IPO.dc.html", {}, "IPO tracker"),
            ("screener", "Screener.dc.html", {}, "Stock screener"),
        ],
        "routes": {
            "Dashboard.dc.html": "/finance/", "Digest.dc.html": "/finance/digest/", "News.dc.html": "/finance/headlines/", "Main.dc.html": "/finance/quote/",
            "Ownership.dc.html": "/finance/ownership/", "Earnings.dc.html": "/finance/earnings/",
            "Macro.dc.html": "/finance/macro/", "IPO.dc.html": "/finance/ipo/", "Screener.dc.html": "/finance/screener/",
        },
    },
    "sports": {
        "desc": "Live scores for every major league, game centers, team pages, playoff odds, a matchup simulator and injury reports.",
        "css": "assets/sports.css",
        "theme": "#020607",
        "scripts": ["/assets/sports-data.js", "/assets/glossary.js"],
        "pages": [("", "Main.dc.html", {}, "Scores & schedule"),
                  ("teams", "Teams.dc.html", {}, "All teams"),
                  ("team", "Team.dc.html", {}, "Team"),
                  ("game", "Game.dc.html", {}, "Game center")]
        + [(f"team/{slug}", "Team.dc.html", {"lg": lg, "id": tid}, name) for slug, (lg, tid, name) in TEAM_PRESETS.items()]
        + [(f"game/{sport}", "Game.dc.html", {"lg": lg}, f"Game center · {lg.upper()}") for sport, lg in GAME_PRESETS.items()]
        + [(slug, "Tool.dc.html", {"tool": key}, TOOL_TITLES[key]) for key, slug in TOOLS.items()],
        "routes": {"Main.dc.html": "/sports/", "Teams.dc.html": "/sports/teams/", "Team.dc.html": "/sports/team/",
                   "Game.dc.html": "/sports/game/"}
        | {f"{k}.dc.html": f"/sports/{v}/" for k, v in TOOLS.items()},
    },
}

# One description per page (search results and link previews), falling back to the section's.
PAGE_DESC = {
    ("finance", ""): "US market dashboard: indices, sectors, movers, Treasury yields, economic data, earnings calendar and headlines, refreshed through the trading day.",
    ("finance", "digest"): "The day's market brief: futures, overnight markets, what moved yesterday and what's on today's calendar.",
    ("finance", "headlines"): "Live market headlines from publications, press wires and SEC 8-K filings, filterable by watchlist and notable news.",
    ("finance", "quote"): "Quote and company page for any US ticker: price chart, financials, insider and activist filings, index membership and 13F ownership.",
    ("finance", "ownership"): "13F institutional ownership for US stocks: who owns it, who bought and sold last quarter, and how much index funds hold.",
    ("finance", "earnings"): "Earnings season tracker for the S&P 500: beat rates, surprises, stock reactions and the reporting calendar.",
    ("finance", "macro"): "The US economy in numbers from FRED: inflation, jobs, growth, rates, recession signals and the release calendar.",
    ("finance", "screener"): "Stock screener for the US market: filter by valuation, growth, margins, momentum and ownership, with every data gap shown.",
    ("finance", "ipo"): "US IPO tracker: deals pricing soon, first-day and since-IPO returns, new filings and lockup expirations.",
    ("sports", ""): "Live scores and schedules for the NFL, MLB, NBA, NHL, college sports, soccer, golf and tennis, with house win probabilities.",
    ("sports", "teams"): "Every team in the NFL, MLB, NBA, NHL and college sports, with records and house-model ratings.",
    ("sports", "simulator"): "Pick any two teams and see the house model's projected margin and win probability.",
    ("sports", "odds"): "Playoff, division and title odds from 10,000 simulations of the rest of the season.",
    ("sports", "injuries"): "Injury reports across the major leagues.",
    ("sports", "track-record"): "Every house-model pick, logged before the game and graded after the final.",
    ("sports", "methodology"): "How the house sports ratings, projections and simulations work.",
}
SITE = "https://nathanskown.dev"
OG_IMAGE = {"finance": "/assets/og/markets.png", "sports": "/assets/og/sports.png"}

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


class TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = {"t": "#root", "a": {}, "c": []}
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = {"t": tag, "a": {k: (v if v is not None else "") for k, v in attrs}, "c": []}
        self.stack[-1]["c"].append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1]["c"].append({"t": tag, "a": {k: (v if v is not None else "") for k, v in attrs}, "c": []})

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i]["t"] == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        if not data.strip() and "\n" in data:
            return
        self.stack[-1]["c"].append(data)


def between(src, start, end):
    i = src.index(start) + len(start)
    return src[i:src.index(end, i)]


def build_page(path, cfg, props, title, section="", route=""):
    src = path.read_text()
    body = between(src, "</helmet>", "</x-dc>")
    m = re.search(r"<script type=\"text/x-dc\" data-dc-script data-props='([^']*)'>([\s\S]*?)</script>", src)
    defaults = json.loads(html.unescape(m.group(1)))
    for k, v in props.items():
        defaults[k] = {"default": v}
    tb = TreeBuilder()
    tb.feed(body)
    tree = json.dumps(tb.root["c"], separators=(",", ":")).replace("</", "<\\/")
    routes = json.dumps(cfg["routes"], separators=(",", ":"))
    scripts = "".join(f'<script src="{src}"></script>\n' for src in cfg.get("scripts", []))
    desc = PAGE_DESC.get((section, route), cfg.get("desc", ""))
    url = f"{SITE}/{section}/" + (f"{route}/" if route else "")
    og = OG_IMAGE.get(section, "/assets/og/home.png")
    full = f"{title} · NSKN Terminal"
    # pages that show one ticker, team or game from the query string have no single canonical URL
    dynamic = route in ("quote", "ownership", "team", "game") or route.startswith("game/")
    canon = "" if dynamic else f'<link rel="canonical" href="{url}">\n'
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(full)}</title>
<meta name="description" content="{html.escape(desc)}">
{canon}<meta property="og:type" content="website">
<meta property="og:site_name" content="NSKN Terminal">
<meta property="og:title" content="{html.escape(full)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}{og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="{cfg["theme"]}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="{FONTS}" rel="stylesheet">
<link rel="stylesheet" href="/{cfg["css"]}">
</head>
<body>
<div id="app"></div>
<noscript><p style="font-family:monospace;padding:24px">This terminal needs JavaScript turned on.</p></noscript>
<script>window.DC_ROUTES={routes};window.DC_TREE={tree};</script>
<script src="/assets/dc-runtime.js"></script>
{scripts}<script>
{m.group(2).strip()}
DC.mount(Component, {json.dumps(defaults)});
</script>
</body>
</html>
"""


def main():
    for name, cfg in SECTIONS.items():
        for route, src_name, props, title in cfg["pages"]:
            out = ROOT / name / route / "index.html"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(build_page(ROOT / "src" / name / src_name, cfg, props, title, name, route))
            print("built", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
