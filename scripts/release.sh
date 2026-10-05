#!/bin/bash
source "$(dirname "$0")/lib.sh"

bump=${1:-patch}
profile=${NOTARY_PROFILE:-figxit}
site=${SITE_URL:-https://figxit.com}

case "$bump" in
  patch | minor | major) ;;
  *)
    echo "BUMP must be patch, minor, or major"
    exit 1
    ;;
esac

if [ "$SIGN_ID" = "-" ]; then
  echo "Set SIGN_ID in .env, for example: SIGN_ID=Developer ID Application: Your Name (TEAMID)"
  exit 1
fi
if ! git rev-parse -q --verify HEAD >/dev/null; then
  echo "Make the first commit before a release"
  exit 1
fi
changes=$(git status --porcelain | grep -v -e ' engine/package.json$' -e ' docs/appcast.xml$' || true)
if [ -n "$changes" ]; then
  echo "Commit or stash your changes before a release"
  exit 1
fi

current=$(version)
if git rev-parse -q --verify "refs/tags/v$current" >/dev/null; then
  IFS=. read -r major minor patch <<<"$current"
  case "$bump" in
    major) next=$((major + 1)).0.0 ;;
    minor) next=$major.$((minor + 1)).0 ;;
    *) next=$major.$minor.$((patch + 1)) ;;
  esac
  sed -i '' "s/\"version\": \"$current\"/\"version\": \"$next\"/" engine/package.json
  echo "Version $current -> $next"
else
  echo "Version $current has no tag, releasing it"
fi
release=$(version)
tag=v$release
folder=$(release_dir "$release")
image=$folder/Figxit-$release.dmg

make build
codesign --verify --deep --strict "$APP"
rm -f dist/Figxit.zip
ditto -c -k --keepParent "$APP" dist/Figxit.zip
xcrun notarytool submit dist/Figxit.zip --keychain-profile "$profile" --wait
xcrun stapler staple "$APP"
rm -f dist/Figxit.zip

scripts/dmg.sh
codesign --force --timestamp --sign "$SIGN_ID" "$DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$profile" --wait
xcrun stapler staple "$DMG"
spctl --assess --type open --context context:primary-signature -v "$DMG"

mkdir -p "$folder"
mv "$DMG" "$image"
feed_view
helper/.build/artifacts/sparkle/Sparkle/bin/generate_appcast --download-url-prefix "$site/download/" -o docs/appcast.xml "$FEED"
for delta in "$FEED/Figxit$release-"*.delta; do
  if [ -f "$delta" ] && [ ! -f "$folder/$(basename "$delta")" ]; then cp "$delta" "$folder/"; fi
done

scripts/r2.sh publish

git add engine/package.json docs/appcast.xml
git diff --cached --quiet || git commit -m "release $tag"
git tag -a "$tag" -m "$tag"
git push origin HEAD "$tag"
gh release create "$tag" "$image" --title "$tag" --generate-notes
rm -rf "$FEED"
echo "Released $release: $site/download/Figxit.dmg"
