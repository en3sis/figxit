set -euo pipefail
cd "$(dirname "$0")/.."

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

CF_API=https://api.cloudflare.com/client/v4
SITE_URL=${SITE_URL:-https://figxit.com}
SITE_HOST=${SITE_URL#*://}

cached() {
  security find-generic-password -s figxit-cf -a "$1" -w 2>/dev/null || true
}

cache() {
  security add-generic-password -U -s figxit-cf -a "$1" -w "$2"
}

cf_get() {
  curl -fsS -H "Authorization: Bearer $CF_TOKEN" "$CF_API$1"
}

cf_login() {
  CF_TOKEN=$(cached token)
  if [ -z "$CF_TOKEN" ]; then
    CF_TOKEN=${CF_TOKEN_REF:-}
    if [ -z "$CF_TOKEN" ]; then
      printf "Cloudflare API token, or its 1Password reference (op://...): " >/dev/tty
      IFS= read -rs CF_TOKEN </dev/tty
      printf "\n" >/dev/tty
    fi
    case "$CF_TOKEN" in
      op://*) CF_TOKEN=$(op read "$CF_TOKEN") ;;
    esac
    if [ -z "$CF_TOKEN" ]; then
      echo "No token given"
      exit 1
    fi
    cache token "$CF_TOKEN"
  fi
  CF_ACCOUNT=$(cached account)
  if [ -z "$CF_ACCOUNT" ]; then
    CF_ACCOUNT=$(cf_get "/zones?name=$SITE_HOST" | sed -nE 's/.*"account":\{[^}]*"id":"([^"]*)".*/\1/p')
    if [ -z "$CF_ACCOUNT" ]; then
      echo "Could not find the Cloudflare account of $SITE_HOST. Run scripts/r2.sh forget if the token changed"
      exit 1
    fi
    cache account "$CF_ACCOUNT"
  fi
  export CF_TOKEN CF_ACCOUNT
}

cf_forget() {
  for name in token account key-id; do
    security delete-generic-password -s figxit-cf -a "$name" >/dev/null 2>&1 || true
  done
  security delete-generic-password -s figxit-r2 >/dev/null 2>&1 || true
}
