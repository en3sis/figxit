set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

APP=dist/Figxit.app
DMG=dist/Figxit.dmg
FEED=dist/feed
ICON=helper/Resources/AppIcon

if [ -f .env ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      '' | \#*) continue ;;
    esac
    if [ -z "${!key:-}" ]; then export "$key=$value"; fi
  done <.env
fi
SIGN_ID="${SIGN_ID:--}"

release_dir() {
  echo "dist/Figxit-$1"
}

feed_view() {
  local file
  rm -rf "$FEED"
  mkdir -p "$FEED"
  for file in dist/Figxit-*/*.dmg dist/Figxit-*/*.delta; do
    if [ -f "$file" ]; then ln "$file" "$FEED/"; fi
  done
}

version() {
  sed -n 's/.*"version": "\(.*\)".*/\1/p' engine/package.json
}
