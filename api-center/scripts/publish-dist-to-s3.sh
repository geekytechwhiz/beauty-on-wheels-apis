#!/usr/bin/env bash
# Sync api-center dist to S3 with safe ordering so index.html never references deleted hashed assets.
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

# Upload hashed assets first (DO NOT DELETE)
echo "Uploading assets..."
aws s3 sync "$BUILD_DIR/assets" "s3://$BUCKET/assets" \
  --cache-control "public,max-age=31536000,immutable" \
  --region "$REGION"

# Upload favicon if present
if [[ -f "$BUILD_DIR/favicon.ico" ]]; then
  echo "Uploading favicon.ico..."
  aws s3 cp "$BUILD_DIR/favicon.ico" "s3://$BUCKET/favicon.ico" --region "$REGION"
fi

# Upload other static files before index.html
echo "Uploading static files..."
aws s3 sync "$BUILD_DIR" "s3://$BUCKET" \
  --exclude "assets/*" \
  --exclude "index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --region "$REGION"

# Upload index.html last
echo "Uploading index.html..."
aws s3 cp "$BUILD_DIR/index.html" "s3://$BUCKET/index.html" \
  --content-type "text/html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --region "$REGION"

echo "S3 publish complete."
