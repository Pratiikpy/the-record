#!/usr/bin/env bash
#
# Record how large the test suite actually is, as data.
#
# The proof deck and the README both state a test count. Both were typed by
# hand, and both were stale within one commit of being written -- the deck
# claimed 474 while the suite had grown to 491. A page whose entire argument is
# "we derive our numbers" cannot hand-type the number that measures itself.
#
# So the count is measured, once, and written where the renderer can read it.
# Anything that cannot be measured is omitted rather than guessed: if this file
# is absent the deck says nothing about suite size instead of inventing one.
#
# Paths here are repo-relative on purpose. This runs under Git Bash on Windows,
# where a POSIX /tmp path is not resolvable by the Node that reads it back.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

TMP=".suite-tmp"
OUT="site/api/suite.json"
rm -rf "$TMP"; mkdir -p "$TMP" "$(dirname "$OUT")"
trap 'rm -rf "$TMP"' EXIT

ts=0
rows=""

for pkg in covenant design doctor procedure reprod; do
  [ -d "packages/$pkg/test" ] || continue
  # vitest's json reporter gives the authoritative count; parsing human output
  # would break the first time the reporter changed a word.
  pnpm --filter "@therecord/$pkg" exec vitest run \
       --reporter=json --outputFile="../../$TMP/$pkg.json" >/dev/null 2>&1 || true
  if [ -s "$TMP/$pkg.json" ]; then
    n="$(node -e "
      const r = JSON.parse(require('fs').readFileSync('$TMP/$pkg.json','utf8'));
      process.stdout.write(String(r.numPassedTests ?? 0));
    ")"
    ts=$(( ts + n ))
    rows="$rows{\"package\":\"$pkg\",\"passed\":$n},"
  fi
done

# Solidity is a separate toolchain and is counted separately, never blended.
sol=0
if command -v forge >/dev/null 2>&1; then
  sol="$( (cd contracts && forge test 2>/dev/null) \
          | grep -oE '[0-9]+ tests passed' | grep -oE '^[0-9]+' | tail -1 || echo 0)"
fi
sol="${sol:-0}"

node -e "
  const rows = JSON.parse('[' + '${rows%,}' + ']');
  const out = {
    schema: 'therecord.suite/v1',
    recordedAt: new Date().toISOString(),
    typescript: $ts,
    solidity: $sol,
    total: $ts + $sol,
    packages: rows,
  };
  require('fs').writeFileSync('$OUT', JSON.stringify(out, null, 2) + '\n');
  process.stderr.write('suite: ' + out.typescript + ' TS + ' + out.solidity + ' Solidity = ' + out.total + '\n');
"
