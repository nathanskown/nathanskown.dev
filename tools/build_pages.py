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
    "Simulator": "simulator", "Odds": "odds", "Spots": "spots", "Injuries": "injuries",
    "LuckWatch": "luck-watch", "Schedule": "schedule-strength", "TrackRecord": "track-record",
    "Methodology": "methodology",
}
TOOL_TITLES = {
    "Simulator": "Matchup simulator", "Odds": "Playoff odds", "Spots": "Situational spots", "Injuries": "Injuries",
    "LuckWatch": "Luck watch", "Schedule": "Schedule strength", "TrackRecord": "Track record", "Methodology": "Methodology",
}
TEAMS = {
    "Team": ("lions", "Detroit Lions"), "TeamTigers": ("tigers", "Detroit Tigers"),
    "TeamPistons": ("pistons", "Detroit Pistons"), "TeamRedWings": ("redwings", "Detroit Red Wings"),
    "TeamMSUFootball": ("msufb", "Michigan State Football"), "TeamMSUBasketball": ("msubb", "Michigan State Basketball"),
    "TeamMSUHockey": ("msuhky", "Michigan State Hockey"),
}
TEAM_SLUGS = {"lions": "lions", "tigers": "tigers", "pistons": "pistons", "redwings": "red-wings",
              "msufb": "msu-football", "msubb": "msu-basketball", "msuhky": "msu-hockey"}
GAMES = {"Game": "football", "GameBaseball": "baseball", "GameBasketball": "basketball", "GameHockey": "hockey"}

# section -> css, theme color, and pages: (route, source file, props, title)
SECTIONS = {
    "finance": {
        "css": "assets/finance.css",
        "theme": "#050403",
        "pages": [
            ("", "Dashboard.dc.html", {}, "Market dashboard"),
            ("headlines", "News.dc.html", {}, "Live headlines"),
            ("quote", "Main.dc.html", {}, "Stock quote"),
            ("ownership", "Ownership.dc.html", {}, "13F ownership tracker"),
            ("earnings", "Earnings.dc.html", {}, "Earnings dashboard"),
            ("macro", "Macro.dc.html", {}, "Macro monitor"),
            ("ipo", "IPO.dc.html", {}, "IPO tracker"),
        ],
        "routes": {
            "Dashboard.dc.html": "/finance/", "News.dc.html": "/finance/headlines/", "Main.dc.html": "/finance/quote/",
            "Ownership.dc.html": "/finance/ownership/", "Earnings.dc.html": "/finance/earnings/",
            "Macro.dc.html": "/finance/macro/", "IPO.dc.html": "/finance/ipo/",
        },
    },
    "sports": {
        "css": "assets/sports.css",
        "theme": "#020607",
        "pages": [("", "Main.dc.html", {}, "Scores & schedule")]
        + [(f"game/{sport}", "Game.dc.html", {"sport": sport}, f"Game center · {sport.title()}") for sport in GAMES.values()]
        + [(f"team/{TEAM_SLUGS[tid]}", "Team.dc.html", {"teamId": tid}, name) for tid, name in TEAMS.values()]
        + [(slug, "Tool.dc.html", {"tool": key}, TOOL_TITLES[key]) for key, slug in TOOLS.items()],
        "routes": {"Main.dc.html": "/sports/"}
        | {f"{k}.dc.html": f"/sports/game/{v}/" for k, v in GAMES.items()}
        | {f"{k}.dc.html": f"/sports/team/{TEAM_SLUGS[v[0]]}/" for k, v in TEAMS.items()}
        | {f"{k}.dc.html": f"/sports/{v}/" for k, v in TOOLS.items()},
    },
}

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


def build_page(path, cfg, props, title):
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
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)} · NSKN Terminal</title>
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
<script>
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
            out.write_text(build_page(ROOT / "src" / name / src_name, cfg, props, title))
            print("built", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
