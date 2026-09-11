#!/usr/bin/env bash
# Recreate submission PNGs from the generated high-resolution originals.
# Needs ImageMagick, pngquant and advpng. Override PNGQUANT for a local binary.
set -euo pipefail
cd "$(dirname "$0")/.."
QUANT="${PNGQUANT:-pngquant}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
for name in cover thumbnail; do
  if [ "$name" = cover ]; then size=800x500; limit=256000
  else size=320x320; limit=64000; fi
  magick "media/artwork/originals/$name.png" -alpha off -colorspace RGB \
    -filter Lanczos -resize "${size}^" -gravity center -extent "$size" \
    -colorspace sRGB "$WORK/reference.png"
  "$QUANT" --force --speed 1 --strip --floyd=0.5 256 \
    --output "$WORK/$name.png" "$WORK/reference.png"
  advpng -z4 -q "$WORK/$name.png"
  bytes=$(wc -c < "$WORK/$name.png")
  [ "$bytes" -le "$limit" ] || { echo "$name exceeds $limit bytes"; exit 1; }
  [ "$(magick identify -format '%wx%h' "$WORK/$name.png")" = "$size" ]
  cp "$WORK/$name.png" "media/artwork/$name.png"
  echo "$name: $size, $bytes / $limit bytes"
done
