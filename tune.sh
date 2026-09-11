#!/usr/bin/env bash
# Search for better roadroller parameters and print the line to copy into
# build.sh.
#
# `roadroller -O1` performs a RANDOM search. Runs on the same input can vary
# by about 40 bytes. With only 10 bytes of headroom, a build could exceed the
# limit without a source change. Run the search several times, keep the best
# parameters, and replay them in build.sh for a reproducible build.
#
# Run again after a significant source change.
set -euo pipefail
cd "$(dirname "$0")"
SRC="${1:-src/index.html}"
N="${2:-8}"

W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
python3 tools/inline.py "$SRC" "$W" >/dev/null
node tools/minify.cjs "$W/app.js" "$W/app.min.js"

best=999999; bestp=""
for i in $(seq 1 "$N"); do
  line=$(roadroller -O1 -M 900 -S x20 "$W/app.min.js" -o "$W/r.js" 2>&1 | tail -1)
  p=$(echo "$line" | grep -o '\-Zab[0-9]*.*-S[0-9,]*' || true)
  [ -z "$p" ] && continue
  z=$(RRP="$p" ./build.sh "$SRC" "$W/t.zip" | grep -o 'ZIP [0-9]*' | grep -o '[0-9]*')
  if [ "$z" -lt "$best" ]; then best=$z; bestp="$p"; echo "  attempt $i: $z  <-- best"; else echo "  attempt $i: $z"; fi
done
echo ""
echo "best: $best bytes"
echo "copy into build.sh:"
echo "  RRP=\"\${RRP:-$bestp}\""
