"""Add ?v=<content hash> to every local CSS/JS reference in the site's HTML pages.

The WIP games load their own files by relative path, so each gets one hash of its own (see GAMES): every
script and stylesheet in the game carries the same ?v=, and Zombie Tower's ES module imports get it through
an import map written into its page.

The Worker serves a versioned URL with a one-year immutable cache, so a changed file must change its URL:
run this after any edit under assets/ (python3 tools/build_pages.py does it for you; the stamp-updated
workflow runs it on every push to main as a safety net). Files with no change are left untouched.
"""
import hashlib
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
REF = re.compile(r'''(["'(])(/(?:assets|music/assets)/[A-Za-z0-9_./-]+\.(?:css|js))(?:\?v=[0-9a-f]{8})?(?=["')])''')
SKIP = {".git", "node_modules", "data", "worker"}


def digest(rel):
    p = ROOT / rel.lstrip("/")
    return hashlib.sha256(p.read_bytes()).hexdigest()[:8] if p.is_file() else None


def stamp_text(text):
    def sub(m):
        h = digest(m.group(2))
        return m.group(0) if h is None else f"{m.group(1)}{m.group(2)}?v={h}"
    return REF.sub(sub, text)


# WIP games: folder -> does it need an import map for ES module imports
GAMES = {"wip/nuke-survival-story": False, "wip/zombie-tower/play": True}
LOCAL = re.compile(r'((?:src|href)=")((?![a-z]+:|/)[A-Za-z0-9_./-]+\.(?:css|js))(?:\?v=[^"]*)?(")')
IMAP = re.compile(r"(<!-- import map:[^\n]*-->\n)(.*?)(\s*<!-- /import map -->)", re.S)


def stamp_game(folder, with_map):
    """One 8-character hash over every .js/.css file in the game (tests excluded)."""
    base = ROOT / folder
    files = sorted(p for p in base.rglob("*")
                   if p.suffix in (".js", ".css") and "test" not in p.relative_to(base).parts)
    h = hashlib.sha256()
    for p in files:
        h.update(p.relative_to(base).as_posix().encode())
        h.update(p.read_bytes())
    v = h.hexdigest()[:8]
    page = base / "index.html"
    t = page.read_text()
    n = LOCAL.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={v}{m.group(3)}", t)
    if with_map:
        mods = [p.relative_to(base).as_posix() for p in files if p.suffix == ".js"]
        mods = [m for m in mods if m.startswith("game/")]
        entries = ",\n".join(f'      "./{m}": "./{m}?v={v}"' for m in mods)
        block = f'  <script type="importmap">\n  {{\n    "imports": {{\n{entries}\n    }}\n  }}\n  </script>'
        n = IMAP.sub(lambda m: m.group(1) + block + m.group(3), n)
    if n != t:
        page.write_text(n)
        return 1
    return 0


def main():
    changed = sum(stamp_game(f, m) for f, m in GAMES.items())
    for p in ROOT.rglob("*.html"):
        if SKIP & set(p.relative_to(ROOT).parts):
            continue
        t = p.read_text()
        n = stamp_text(t)
        if n != t:
            p.write_text(n)
            changed += 1
    print(f"stamped {changed} pages")


if __name__ == "__main__":
    main()
