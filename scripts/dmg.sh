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
create-dmg --volname Figxit --volicon "$ICON.icns" --background dist/dmg-background.tiff \
  --window-pos 240 160 --window-size 600 428 --icon-size 120 --text-size 13 \
  --icon Figxit.app 160 182 --hide-extension Figxit.app --app-drop-link 440 182 \
  --no-internet-enable "$DMG" dist/dmg
rm -rf dist/dmg dist/dmg-bg.png dist/dmg-bg@2x.png dist/dmg-background.tiff
