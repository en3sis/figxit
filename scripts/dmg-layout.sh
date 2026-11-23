#!/bin/bash
source "$(dirname "$0")/lib.sh"

background=helper/Resources/dmg-background.svg
layout=helper/Resources/dmg.DS_Store
work=$(mktemp -d /tmp/figxit-layout.XXXXXX)
trap 'hdiutil detach -quiet "$work/mnt" 2>/dev/null || true; rm -rf "$work"' EXIT

mkdir -p "$work/src/Figxit.app" "$work/mnt"
rsvg-convert -w 600 -h 400 "$background" -o "$work/bg.png"
rsvg-convert -w 1200 -h 800 "$background" -o "$work/bg@2x.png"
tiffutil -cathidpicheck "$work/bg.png" "$work/bg@2x.png" -out "$work/dmg-background.tiff"
installed=$(readlink -f "$(command -v create-dmg)")
mkdir "$work/tool"
cp "$installed" "$work/tool/create-dmg"
cp -R "$(dirname "$installed")/../share/create-dmg/support" "$work/tool/support"
touch "$work/tool/.this-is-the-create-dmg-repo"
perl -pi -e 's/^(\s+)open$/$1open\n$1delay 2/' "$work/tool/support/template.applescript"
for attempt in 1 2 3 4 5; do
  rm -f "$work/Figxit.dmg" "$work"/rw.*.dmg
  "$work/tool/create-dmg" --volname Figxit --background "$work/dmg-background.tiff" \
    --window-pos 240 160 --window-size 600 428 --icon-size 120 --text-size 13 \
    --icon Figxit.app 160 182 --hide-extension Figxit.app --app-drop-link 440 182 \
    --no-internet-enable "$work/Figxit.dmg" "$work/src" && break
  [ "$attempt" = 5 ] && exit 1
  echo "Finder did not set up the window, trying again"
done
hdiutil attach -quiet -readonly -noverify -noautoopen -nobrowse -mountpoint "$work/mnt" "$work/Figxit.dmg"
cp "$work/mnt/.DS_Store" "$layout"
echo "Wrote $layout"
