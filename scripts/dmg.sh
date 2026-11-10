#!/bin/bash
source "$(dirname "$0")/lib.sh"

background=helper/Resources/dmg-background.svg

for volume in /Volumes/Figxit*; do
  if [ -d "$volume" ]; then
    echo "Ejecting $volume, a second volume with this name breaks the disk image layout"
    hdiutil detach "$volume" -quiet || hdiutil detach "$volume" -force -quiet || true
  fi
done

rm -rf dist/dmg "$DMG" dist/dmg-background.tiff dist/rw.*.dmg
mkdir -p dist/dmg
cp -R "$APP" dist/dmg/Figxit.app
rsvg-convert -w 600 -h 400 "$background" -o dist/dmg-bg.png
rsvg-convert -w 1200 -h 800 "$background" -o dist/dmg-bg@2x.png
tiffutil -cathidpicheck dist/dmg-bg.png dist/dmg-bg@2x.png -out dist/dmg-background.tiff
tool=$(mktemp -d)
installed=$(readlink -f "$(command -v create-dmg)")
cp "$installed" "$tool/create-dmg"
cp -R "$(dirname "$installed")/../share/create-dmg/support" "$tool/support"
touch "$tool/.this-is-the-create-dmg-repo"
perl -pi -e 's/^(\s+)open$/$1open\n$1delay 2/' "$tool/support/template.applescript"
for attempt in 1 2; do
  rm -f "$DMG" dist/rw.*.dmg
  "$tool/create-dmg" --volname Figxit --volicon "$ICON.icns" --background dist/dmg-background.tiff \
    --window-pos 240 160 --window-size 600 428 --icon-size 120 --text-size 13 \
    --icon Figxit.app 160 182 --hide-extension Figxit.app --app-drop-link 440 182 \
    --no-internet-enable "$DMG" dist/dmg && break
  [ "$attempt" = 2 ] && exit 1
  echo "Finder did not set up the disk image window, trying again"
done
rm -rf "$tool"
rm -rf dist/dmg dist/dmg-bg.png dist/dmg-bg@2x.png dist/dmg-background.tiff
