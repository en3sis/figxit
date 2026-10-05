#!/bin/bash
source "$(dirname "$0")/lib.sh"

flags=""
if [ "$SIGN_ID" != "-" ]; then flags="--options runtime --timestamp"; fi

sign() {
  codesign --force $flags --sign "$SIGN_ID" "$@"
}

sparkle=$APP/Contents/Frameworks/Sparkle.framework
engine=$APP/Contents/MacOS/figxit-engine

if [ -d "$sparkle" ]; then
  for part in XPCServices/Installer.xpc XPCServices/Downloader.xpc Autoupdate Updater.app; do
    sign --preserve-metadata=entitlements "$sparkle/Versions/B/$part"
  done
  sign "$sparkle"
fi
if [ -f "$engine" ]; then
  sign --entitlements helper/engine.entitlements "$engine"
fi
sign "$APP"
