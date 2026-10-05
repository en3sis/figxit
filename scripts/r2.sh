#!/bin/bash
source "$(dirname "$0")/lib.sh"

bucket=${R2_BUCKET:-figxit-prod}

auth() {
  local id
  cf_login
  id=$(cached key-id)
  if [ -z "$id" ]; then
    id=$(cf_get "/accounts/$CF_ACCOUNT/tokens/verify" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    if [ -z "$id" ]; then
      echo "Could not verify the Cloudflare token. Run make cf-forget if the token changed"
      exit 1
    fi
    cache key-id "$id"
  fi
  endpoint=https://$CF_ACCOUNT.r2.cloudflarestorage.com
  export AWS_ACCESS_KEY_ID=$id
  export AWS_SECRET_ACCESS_KEY=$(printf %s "$CF_TOKEN" | shasum -a 256 | cut -d' ' -f1)
  export AWS_DEFAULT_REGION=auto
  export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
  export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
}

s3() {
  aws s3 "$@" --endpoint-url "$endpoint"
}

site() {
  sed -i '' "s|<lastmod>.*</lastmod>|<lastmod>$(date +%F)</lastmod>|" docs/sitemap.xml
  s3 sync docs/ "s3://$bucket/" --no-progress --delete \
    --exclude ".*" --exclude "*/.*" --exclude "*.md" --exclude "download/*" \
    --cache-control "public, max-age=300"
}

case "${1:-}" in
  site)
    auth
    site
    ;;
  publish)
    image=$ARCHIVE/Figxit-$(version).dmg
    if [ ! -f "$image" ] || ! grep -q "Figxit-$(version).dmg" docs/appcast.xml; then
      echo "Version $(version) is not built. Run make release first"
      exit 1
    fi
    auth
    site
    s3 sync "$ARCHIVE/" "s3://$bucket/download/" --no-progress \
      --exclude "*" --include "*.dmg" --include "*.delta" \
      --cache-control "public, max-age=31536000, immutable"
    s3 cp "$image" "s3://$bucket/download/Figxit.dmg" --no-progress \
      --content-type application/x-apple-diskimage --cache-control "public, max-age=300"
    ;;
  ls)
    auth
    s3 ls "s3://$bucket/" --recursive
    ;;
  forget)
    cf_forget
    ;;
  *)
    echo "Usage: r2.sh site|publish|ls|forget"
    exit 1
    ;;
esac
