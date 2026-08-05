#!/usr/bin/env bash
#
# Assemble and publish the site.
#
# Written after a deploy shipped with three register pages missing: the output
# directory was busy, `rm -rf` failed, every `cp` failed, and the deploy went
# ahead regardless because nothing checked. The alias then pointed at a broken
# build. So this script fails on the first error, verifies the assembled tree
# BEFORE uploading, verifies the uploaded deployment BEFORE aliasing, and
# refuses to move the alias if anything is missing.
#
# A publish step that cannot refuse is not a publish step.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/_site"
ALIAS="${PUBLISH_ALIAS:-the-record.vercel.app}"

PAGES=(
  ""
  "covenant/"
  "procedure/"
  "procedure/backfill"
  "reprod/"
  "errata"
  "api/status.json"
  "badge/core-vault.svg"
)

say() { printf '%s\n' "$*" >&2; }

say "── render ──"
cd "$ROOT"
pnpm --filter @therecord/covenant  run render        >/dev/null
pnpm --filter @therecord/procedure run render        >/dev/null
pnpm --filter @therecord/procedure run render:backfill >/dev/null
pnpm --filter @therecord/reprod    run render        >/dev/null
pnpm --filter @therecord/design    run build         >/dev/null

say "── assemble ──"
# Never `cd` into $OUT anywhere in this script: a shell whose working directory
# is inside it makes the directory busy and the removal silently fails.
rm -rf "$OUT"
mkdir -p "$OUT/covenant" "$OUT/procedure" "$OUT/reprod"

cp "$ROOT/site/index.html"                        "$OUT/index.html"
cp "$ROOT/site/errata.html"                       "$OUT/errata.html"
cp -r "$ROOT/site/api"                            "$OUT/api"
cp -r "$ROOT/site/badge"                          "$OUT/badge"
cp "$ROOT/packages/covenant/out/index.html"       "$OUT/covenant/index.html"
cp "$ROOT/packages/procedure/out/index.html"      "$OUT/procedure/index.html"
cp "$ROOT/packages/procedure/out/backfill.html"   "$OUT/procedure/backfill.html"
cp "$ROOT/packages/reprod/out/index.html"         "$OUT/reprod/index.html"

# Cross-register links are relative to each package's out/ directory; the
# published tree is flatter.
find "$OUT" -name '*.html' -exec sed -i \
  -e 's|\.\./\.\./covenant/out/index\.html|../covenant/index.html|g' \
  -e 's|\.\./\.\./procedure/out/index\.html|../procedure/index.html|g' \
  -e 's|\.\./\.\./reprod/out/index\.html|../reprod/index.html|g' \
  -e 's|\.\./packages/covenant/out/index\.html|covenant/index.html|g' \
  -e 's|\.\./packages/procedure/out/index\.html|procedure/index.html|g' \
  -e 's|\.\./packages/reprod/out/index\.html|reprod/index.html|g' {} +

printf '{"cleanUrls":true}' > "$OUT/vercel.json"

say "── verify the tree before uploading ──"
missing=0
for f in index.html errata.html covenant/index.html procedure/index.html \
         procedure/backfill.html reprod/index.html api/status.json badge/core-vault.svg; do
  if [ ! -s "$OUT/$f" ]; then say "  MISSING $f"; missing=1; else say "  ok $f"; fi
done
[ "$missing" -eq 0 ] || { say "refusing to deploy an incomplete tree"; exit 1; }

python "$ROOT/scripts/linkcheck.py" "$OUT"

say "── deploy ──"
mkdir -p "$OUT/.vercel"
cp "$ROOT/.vercel/project.json" "$OUT/.vercel/project.json"
URL="$(vercel deploy --prod --yes --cwd "$OUT" 2>&1 | grep -oE 'https://[a-z0-9.-]+vercel\.app' | tail -1)"
[ -n "$URL" ] || { say "no deployment URL returned"; exit 1; }
say "  deployed $URL"

say "── verify the deployment before aliasing ──"
sleep 5
bad=0
for p in "${PAGES[@]}"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$URL/$p")"
  say "  $code /$p"
  [ "$code" = "200" ] || bad=1
done
[ "$bad" -eq 0 ] || { say "deployment incomplete — alias NOT moved, $ALIAS still points at the last good build"; exit 1; }

say "── alias ──"
vercel alias set "$URL" "$ALIAS" >/dev/null 2>&1
sleep 4
for p in "${PAGES[@]}"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "https://$ALIAS/$p")"
  say "  $code https://$ALIAS/$p"
  [ "$code" = "200" ] || bad=1
done
[ "$bad" -eq 0 ] || { say "ALIAS IS SERVING A BROKEN SITE"; exit 1; }

say "published: https://$ALIAS"
