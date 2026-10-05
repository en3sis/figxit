#!/bin/bash
source "$(dirname "$0")/lib.sh"

contents=$APP/Contents
specs=engine/node_modules/@withfig/autocomplete/build

helper() {
  (cd helper && xcrun swift build -c release)
  mkdir -p "$contents/MacOS" "$contents/Resources"
  cp helper/.build/release/figxit-helper "$contents/MacOS/figxit-helper"
  cp helper/Info.plist "$contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $(version)" -c "Set :CFBundleVersion $(version)" "$contents/Info.plist"
  rm -rf "$contents/Frameworks" "$contents/Resources/icons"
  mkdir -p "$contents/Frameworks"
  cp -R helper/.build/release/Sparkle.framework "$contents/Frameworks/Sparkle.framework"
  cp -R helper/Resources/icons "$contents/Resources/icons"
  cp "$ICON.icns" "$contents/Resources/AppIcon.icns"
}

engine() {
  mkdir -p "$contents/MacOS"
  (cd engine && bun build --compile src/main.ts --outfile "../$contents/MacOS/figxit-engine")
}

resources() {
  mkdir -p "$contents/Resources/specs" "$contents/Resources/shell/zsh" "$contents/Resources/shell/bash" "$contents/Resources/shell/fish"
  rsync -a --delete --exclude=aws --exclude=aws.js --exclude=az --exclude=az.js --exclude=gcloud --exclude=gcloud.js \
    "$specs/" "$contents/Resources/specs/"
  cp shell/zsh/figxit.zsh "$contents/Resources/shell/zsh/figxit.zsh"
  cp shell/bash/figxit.bash "$contents/Resources/shell/bash/figxit.bash"
  cp shell/fish/figxit.fish "$contents/Resources/shell/fish/figxit.fish"
}

case "${1:-app}" in
  app)
    helper
    engine
    resources
    ;;
  helper)
    helper
    ;;
  *)
    echo "Usage: build.sh [app|helper]"
    exit 1
    ;;
esac
scripts/sign.sh
