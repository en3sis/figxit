#!/bin/bash
source "$(dirname "$0")/lib.sh"

rm -rf "$ICON.iconset"
mkdir -p "$ICON.iconset"
for size in 16 32 128 256 512; do
  rsvg-convert -w $size -h $size "$ICON.svg" -o "$ICON.iconset/icon_${size}x${size}.png"
  rsvg-convert -w $((size * 2)) -h $((size * 2)) "$ICON.svg" -o "$ICON.iconset/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$ICON.iconset" -o "$ICON.icns"
rm -rf "$ICON.iconset"

rm -rf docs/icon
mkdir -p docs/icon/rounded docs/icon/square
for size in 16 32 64 128 256 512 1024; do
  rsvg-convert -w $size -h $size "$ICON.svg" -o "docs/icon/rounded/icon-$size.png"
  rsvg-convert -w $size -h $size "${ICON}Square.svg" -o "docs/icon/square/icon-$size.png"
done
