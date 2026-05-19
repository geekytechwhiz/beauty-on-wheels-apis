#!/usr/bin/env bash
# Sync api-center dist to S3 and re-apply Content-Cache headers so:
# - HTML is not long-cached (avoids index referencing deleted hashed chunks → HTML 404 fallbacks / MIME errors).
# - JS/CSS get explicit types (some pipelines omit S3 metadata on sync-only uploads).
#
# Usage (from repo root or api-center): set bucket and region, then run.
#   export API_CENTER_S3_BUCKET=dev-mib-api-center-bucket
#   export API_CENTER_S3_REGION=ap-south-1
#   bash api-center/scripts/publish-dist-to-s3.sh
#
# Optional: BUILD_DIR (default: api-center/dist relative to this script's parent).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_CENTER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$API_CENTER_ROOT/dist}"
BUCKET="${API_CENTER_S3_BUCKET:-${BUCKET_NAME:-}}"
REGION="${API_CENTER_S3_REGION:-${AWS_REGION:-}}"

if [[ -z "$BUCKET" || -z "$REGION" ]]; then
  echo "publish-dist-to-s3.sh: set API_CENTER_S3_BUCKET and API_CENTER_S3_REGION (or BUCKET_NAME and AWS_REGION)." >&2
  exit 1
fi

if [[ ! -d "$BUILD_DIR" ]]; then
  echo "publish-dist-to-s3.sh: BUILD_DIR not found: $BUILD_DIR" >&2
  exit 1
fi

BUILD_DIR="$(cd "$BUILD_DIR" && pwd)"

echo "Publishing $BUILD_DIR to s3://$BUCKET ($REGION)"
aws s3 sync "$BUILD_DIR" "s3://$BUCKET" --delete --region "$REGION"

echo "Applying Content-Type / Cache-Control overrides"
while IFS= read -r -d '' file; do
  rel="${file#$BUILD_DIR/}"
  aws s3 cp "$file" "s3://$BUCKET/$rel" \
    --content-type "text/html" \
    --cache-control "no-cache, no-store, must-revalidate" \
    --region "$REGION"
done < <(find "$BUILD_DIR" -name '*.html' -print0)

while IFS= read -r -d '' file; do
  rel="${file#$BUILD_DIR/}"
  aws s3 cp "$file" "s3://$BUCKET/$rel" \
    --content-type "application/javascript" \
    --cache-control "public, max-age=31536000, immutable" \
    --region "$REGION"
done < <(find "$BUILD_DIR" -type f \( -name '*.js' -o -name '*.mjs' \) -print0)

while IFS= read -r -d '' file; do
  rel="${file#$BUILD_DIR/}"
  aws s3 cp "$file" "s3://$BUCKET/$rel" \
    --content-type "text/css" \
    --region "$REGION"
done < <(find "$BUILD_DIR" -name '*.css' -print0)

echo "S3 publish complete."
