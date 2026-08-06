#!/usr/bin/env bash
#
# Assemble the publishable site tree into $1 (default: _site).
#
# Extracted because two callers -- scripts/publish.sh and the Pages workflow --
# each had their own copy of this list, and they drifted the moment a page was
# added: errata.html shipped through one and broke the other's link check. A
# file list duplicated in two places is a file list that will be wrong in one.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/_site}"

# Never `cd` into $OUT: a shell whose working directory is inside it makes the
# directory busy, `rm -rf` fails silently under `set +e`, and every copy after
# it fails too.
rm -rf "$OUT"
mkdir -p "$OUT/covenant" "$OUT/procedure" "$OUT/reprod"

cp "$ROOT/site/index.html"                      "$OUT/index.html"
cp "$ROOT/site/errata.html"                     "$OUT/errata.html"
cp "$ROOT/site/proof-deck.html"                 "$OUT/proof-deck.html"
cp -r "$ROOT/site/proof"                        "$OUT/proof"
cp -r "$ROOT/site/film"                         "$OUT/film"
cp -r "$ROOT/site/api"                          "$OUT/api"
cp -r "$ROOT/site/badge"                        "$OUT/badge"
cp -r "$ROOT/site/spec"                         "$OUT/spec"
cp "$ROOT/packages/covenant/out/index.html"     "$OUT/covenant/index.html"
cp "$ROOT/packages/procedure/out/index.html"    "$OUT/procedure/index.html"
cp "$ROOT/packages/procedure/out/backfill.html" "$OUT/procedure/backfill.html"
cp "$ROOT/packages/reprod/out/index.html"       "$OUT/reprod/index.html"

# Cross-register links are written relative to each package's out/ directory;
# the published tree is flatter.
find "$OUT" -name '*.html' -exec sed -i \
  -e 's|\.\./\.\./covenant/out/index\.html|../covenant/index.html|g' \
  -e 's|\.\./\.\./procedure/out/index\.html|../procedure/index.html|g' \
  -e 's|\.\./\.\./reprod/out/index\.html|../reprod/index.html|g' \
  -e 's|\.\./packages/covenant/out/index\.html|covenant/index.html|g' \
  -e 's|\.\./packages/procedure/out/index\.html|procedure/index.html|g' \
  -e 's|\.\./packages/reprod/out/index\.html|reprod/index.html|g' {} +

# cleanUrls serves /errata and /procedure/backfill without the .html suffix.
# This was dropped when assembly moved out of publish.sh, and the two
# extensionless pages 404'd on the next deploy -- caught by the pre-alias check,
# which is exactly why that check exists.
printf '{"cleanUrls":true}' > "$OUT/vercel.json"

# Required files, checked before anything downstream trusts the tree.
missing=0
for f in index.html errata.html proof-deck.html covenant/index.html procedure/index.html \
         procedure/backfill.html reprod/index.html api/status.json badge/core-vault.svg \
         spec/faults.json vercel.json proof/tour-1-index.jpeg film/the-record.mp4; do
  [ -s "$OUT/$f" ] || { printf '  MISSING %s\n' "$f" >&2; missing=1; }
done
[ "$missing" -eq 0 ] || { printf 'assembled tree is incomplete\n' >&2; exit 1; }

printf 'assembled %s\n' "$OUT" >&2
