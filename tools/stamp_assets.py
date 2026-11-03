"""Add ?v=<content hash> to every local CSS/JS reference in the site's HTML pages.

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


def main():
    changed = 0
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
