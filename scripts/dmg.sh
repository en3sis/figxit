#!/bin/bash
source "$(dirname "$0")/lib.sh"

background=helper/Resources/dmg-background.svg
work=$(mktemp -d)
trap 'hdiutil detach -quiet "$work/mnt" 2>/dev/null || true; rm -rf "$work"' EXIT

root=$work/Figxit
mkdir -p "$root/.background" "$work/mnt"
ditto "$APP" "$root/Figxit.app"
ln -s /Applications "$root/Applications"
rsvg-convert -w 600 -h 400 "$background" -o "$work/bg.png"
rsvg-convert -w 1200 -h 800 "$background" -o "$work/bg@2x.png"
tiffutil -cathidpicheck "$work/bg.png" "$work/bg@2x.png" -out "$root/.background/dmg-background.tiff"
cp "$ICON.icns" "$root/.VolumeIcon.icns"
SetFile -c icnC "$root/.VolumeIcon.icns"
cp helper/Resources/dmg.DS_Store "$root/.DS_Store"

hdiutil create -quiet -srcfolder "$root" -volname Figxit -fs HFS+ -fsargs "-c c=64,a=16,e=16" -format UDRW "$work/rw.dmg"
hdiutil attach -quiet -readwrite -noverify -noautoopen -nobrowse -mountpoint "$work/mnt" "$work/rw.dmg"
SetFile -a C "$work/mnt"
hdiutil detach -quiet "$work/mnt"
rm -f "$DMG"
hdiutil convert -quiet "$work/rw.dmg" -format UDZO -o "$DMG"
