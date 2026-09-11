#!/usr/bin/env bash
# Build both release targets from one source snapshot.
#
#   src/index.html
#     -> inline.py    inject CSS and DOM into JS for roadroller
#     -> terser       minify and mangle top-level names
#     -> roadroller   context-mixing compression with FIXED parameters
#     -> dist/js13k/index.html
#     -> zipit.py     ZIP container using zopfli deflate
#     -> js13k-game.zip (project root)
#
# The same source is copied without minification or packing to
# dist/wavedash/index.html. A successful default build recreates dist/.
# An explicit ZIP output path builds only that archive, for tuning.
#
# Roadroller parameters are deliberately fixed: its -O1 search is random,
# varying by about 40 bytes between runs. With only a few dozen bytes of
# headroom, that can push a build over the limit without any source changes.
# To search for better parameters after a major change, run npm run tune.
#
# The current settings came from an -O1 search with -S x18, followed by a
# sweep of -Zco and -Zmd, which -O1 never adjusts. Using 18 contexts instead
# of 20 produced a smaller archive and faster decoding.
set -euo pipefail
cd "$(dirname "$0")"

SRC="${1:-src/index.html}"
OUT="${2:-js13k-game.zip}"
RRP="${RRP:--Zco23 -Zab18 -Zlr1650 -Zmd40 -S0,1,2,3,4,7,13,14,21,42,57,83,100,210,228,254,385,404}"

command -v terser     >/dev/null || { echo "terser is missing: npm install"; exit 1; }
command -v roadroller >/dev/null || { echo "roadroller is missing: npm install"; exit 1; }
python3 -c "import zopfli.zlib" 2>/dev/null || { echo "zopfli is missing: pip install -r requirements.txt"; exit 1; }

W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
cp "$SRC" "$W/source.html"

python3 tools/inline.py "$W/source.html" "$W"
node --check "$W/app.js"

# compress toplevel=true lets Terser inline and fold top-level declarations,
# saving 82 ZIP bytes in the measured build. A previous differential check
# played 13 days in Chromium with virtual rAF and performance.now, ensuring
# identical timesteps: all 13 evening reports matched, with no console errors.
node tools/minify.cjs "$W/app.js" "$W/app.min.js"
echo "terser     $(wc -c < "$W/app.min.js") B"

roadroller $RRP "$W/app.min.js" -o "$W/app.rr.js" 2>/dev/null
echo "roadroller $(wc -c < "$W/app.rr.js") B"

# HTML shell. Keep these three pieces despite their small compression cost:
#   <meta charset=utf-8> and user-scalable=no cost 21 bytes together in the
#   measured build. An explicit charset protects future non-ASCII text, and
#   user-scalable=no prevents browser pinch zoom from competing with the game
#   camera on Android.
#   Removing the closing </script> saved 6 bytes but BROKE execution: a script
#   left open at EOF does not run. In a previous Chromium check, omitting it
#   produced a blank page with no elements or console errors; keeping it
#   created 21 elements and started the game. A console-only check would miss
#   this blank-page failure.
python3 - "$W" <<'PY'
import sys
w = sys.argv[1]
open(w + '/index.html', 'w', encoding='utf-8').write(
    '<!doctype html><meta charset=utf-8>'
    '<meta name=viewport content="width=device-width,initial-scale=1,'
    'user-scalable=no,viewport-fit=cover"><title>'
    + open(w + '/title.txt', encoding='utf-8').read()
    + '</title><body><script>' + open(w + '/app.rr.js').read() + '</script>')
PY

python3 tools/zipit.py "$W/index.html" "$W/js13k-game.zip"
if [ "$#" -lt 2 ]; then
  mkdir -p "$W/release/js13k" "$W/release/wavedash"
  cp "$W/index.html" "$W/release/js13k/index.html"
  cp "$W/source.html" "$W/release/wavedash/index.html"
  # Publish only after both targets are ready and the ZIP size check passed.
  # dist/ is generated output; rebuilding removes obsolete release variants.
  rm -rf dist
  mv "$W/release" dist
  mv "$W/js13k-game.zip" "$OUT"
  echo "js13k HTML $(wc -c < dist/js13k/index.html) B (Roadroller)"
  echo "Wavedash   $(wc -c < dist/wavedash/index.html) B (uncompressed)"
else
  mkdir -p "$(dirname "$OUT")"
  mv "$W/js13k-game.zip" "$OUT"
fi
