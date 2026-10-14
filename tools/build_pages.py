"""Build static pages from the .dc.html design files in src/.

Usage:  python3 tools/build_pages.py
Each src/<section>/<Name>.dc.html becomes <section>/<route>/index.html.
The page markup is shipped as a JSON tree that assets/dc-runtime.js renders,
so the design files stay the single source of truth. No build step is
needed on the host: the generated files are committed as-is.
"""
import html
import json
import pathlib
import re
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent
LANDING = "https://claude.ai/artifact/KM86KatMZF741ZzKKDduEV"

SECTIONS = {
    "finance": {
        "css": "assets/finance.css",
        "theme": "#050403",
        "pages": {
            "Dashboard.dc.html": "",
            "News.dc.html": "headlines",
            "Main.dc.html": "quote",
            "Ownership.dc.html": "ownership",
            "Earnings.dc.html": "earnings",
            "Macro.dc.html": "macro",
            "IPO.dc.html": "ipo",
        },
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


def section(src, start, end):
    i = src.index(start) + len(start)
    return src[i:src.index(end, i)]


def build_page(path, css_href, theme):
    src = path.read_text()
    src = src.replace(f'href="{LANDING}" target="_blank" rel="noopener"', 'href="/"')
    title = html.unescape(section(src, "<title>", "</title>"))
    body = section(src, "</helmet>", "</x-dc>")
    m = re.search(r"<script type=\"text/x-dc\" data-dc-script data-props='([^']*)'>([\s\S]*?)</script>", src)
    props = json.loads(html.unescape(m.group(1)))
    logic = m.group(2)
    tb = TreeBuilder()
    tb.feed(body)
    tree = json.dumps(tb.root["c"], separators=(",", ":")).replace("</", "<\\/")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)} · NSKN Terminal</title>
<meta name="theme-color" content="{theme}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=VT323&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/{css_href}">
</head>
<body>
<div id="app"></div>
<noscript><p style="color:#ffb84d;font-family:monospace;padding:24px">This terminal needs JavaScript turned on.</p></noscript>
<script>window.DC_TREE={tree};</script>
<script src="/assets/dc-runtime.js"></script>
<script>
{logic.strip()}
DC.mount(Component, {json.dumps(props)});
</script>
</body>
</html>
"""


def main():
    for name, cfg in SECTIONS.items():
        files = sorted((ROOT / "src" / name).glob("*.dc.html"))
        first = files[0].read_text()
        css = section(first, "<style>", "</style>").strip()
        (ROOT / cfg["css"]).write_text(css + "\n")
        for f in files:
            route = cfg["pages"].get(f.name)
            if route is None:
                print("skip (no route)", f.name)
                continue
            out = ROOT / name / route / "index.html"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(build_page(f, cfg["css"], cfg["theme"]))
            print("built", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
