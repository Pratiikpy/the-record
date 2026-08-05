import pathlib, re, sys
root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "_site")
bad, total = [], 0
for page in root.rglob("*.html"):
    for href in re.findall(r'href="([^"#]+)"', page.read_text(encoding="utf8")):
        if href.startswith(("http://", "https://", "mailto:")):
            continue
        total += 1
        if not (page.parent / href).resolve().exists():
            bad.append(f"{page.relative_to(root)} -> {href}")
print(f"internal links checked: {total}")
if bad:
    print("dead internal links:")
    for b in bad:
        print(" ", b)
    sys.exit(1)
print("every internal link resolves")
