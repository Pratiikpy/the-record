"""Fail if any internal link is dead.

Models how the site is actually SERVED, not just what sits on disk. Vercel's
`cleanUrls` answers /errata from errata.html, so a checker that only stats the
literal path reports a working link as dead. The fix for that would have been
to write every URL with a .html suffix, which is the wrong direction: the
checker should describe the server, not the server bend to the checker.

Run: python scripts/linkcheck.py _site
"""

import pathlib
import re
import sys


def resolves(base: pathlib.Path, href: str) -> bool:
    """Would the server answer this path?"""
    target = (base / href).resolve()

    # An exact file.
    if target.is_file():
        return True

    # cleanUrls: /errata is served from errata.html
    if target.with_suffix(".html").is_file():
        return True

    # A directory is served by its index.
    if target.is_dir() and (target / "index.html").is_file():
        return True

    return False


def main() -> int:
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "_site")
    if not root.is_dir():
        print(f"no such directory: {root}")
        return 1

    bad: list[str] = []
    total = 0

    for page in sorted(root.rglob("*.html")):
        for href in re.findall(r'href="([^"#]+)"', page.read_text(encoding="utf8")):
            if href.startswith(("http://", "https://", "mailto:", "data:")):
                continue
            total += 1
            if not resolves(page.parent, href):
                bad.append(f"{page.relative_to(root)} -> {href}")

    print(f"internal links checked: {total}")
    if bad:
        print("dead internal links:")
        for b in bad:
            print(" ", b)
        return 1

    print("every internal link resolves")
    return 0


if __name__ == "__main__":
    sys.exit(main())
