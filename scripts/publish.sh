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
  "api/redemptions.json"
  "badge/redemptions.svg"
  "spec/faults.json"
)

say() { printf '%s\n' "$*" >&2; }

say "── drift: does the snapshot still describe the chain? ──"
pnpm --filter @therecord/reprod run drift

# A publish that ships a failing suite is a publish that ships whatever the
# suite was protecting. This gate exists because one went out: the README's
# own test count had gone stale, every test said so, and the deploy proceeded
# anyway because nothing here was looking.
say "── suite: does everything still pass? ──"
if ! pnpm -r run test >/dev/null 2>&1; then
  say ""
  say "refusing to publish: the test suite is failing. Run \`pnpm -r run test\` and fix it."
  exit 1
fi

say "── render ──"
cd "$ROOT"
pnpm --filter @therecord/covenant  run render        >/dev/null
pnpm --filter @therecord/procedure run render        >/dev/null
pnpm --filter @therecord/procedure run render:backfill >/dev/null
pnpm --filter @therecord/reprod    run render        >/dev/null
pnpm --filter @therecord/procedure run spec          >/dev/null
pnpm --filter @therecord/design    run build         >/dev/null

say "── assemble ──"
bash "$ROOT/scripts/assemble.sh" "$OUT"

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
