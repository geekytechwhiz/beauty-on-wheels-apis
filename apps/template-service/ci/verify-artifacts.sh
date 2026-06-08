#!/bin/bash

set -euo pipefail

echo "======================================="
echo "VERIFYING DEPLOYMENT ARTIFACTS"
echo "======================================="

: "${STAGE:?STAGE must be set (dev, stg, or prd)}"
: "${DEPLOYMENT_BUCKET:?DEPLOYMENT_BUCKET must be set}"

EXPECTED_BUCKET="${STAGE}-mvx-template-service-bucket"
if [ "$DEPLOYMENT_BUCKET" != "$EXPECTED_BUCKET" ]; then
  echo "ERROR: DEPLOYMENT_BUCKET=$DEPLOYMENT_BUCKET does not match STAGE=$STAGE (expected $EXPECTED_BUCKET)"
  exit 1
fi

SERVICE_DIR="${CODEBUILD_SRC_DIR:-}/apps/template-service"
if [ ! -d "$SERVICE_DIR" ]; then
  SERVICE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
fi

cd "$SERVICE_DIR"

TEMPLATE="packaged.yaml"

if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: packaged.yaml not found — build phase must complete successfully first"
  exit 1
fi

if [ ! -d ".serverless" ]; then
  echo "ERROR: .serverless/ missing — build phase did not produce artifacts"
  exit 1
fi

if ! grep -q "serverless/template-service/${STAGE}/" packaged.yaml; then
  echo "ERROR: packaged.yaml does not contain S3 keys for stage $STAGE"
  echo "Stale packaged.yaml from another stage may be present — ensure build.sh ran successfully."
  exit 1
fi

echo "Resolving S3 bucket..."
BUCKET="$DEPLOYMENT_BUCKET"

echo "Using bucket:"
echo "$BUCKET"

echo "Extracting S3 keys..."

node <<'NODE' > /tmp/s3keys.txt
const fs = require('fs');
const template = fs.readFileSync('packaged.yaml', 'utf8');
const keys = new Set();

const lines = template.split(/\r?\n/);
for (const line of lines) {
  let m = line.match(/^\s*S3Key\s*:\s*(['"])(.+)\1\s*(?:#.*)?$/);
  if (m) {
    const v = m[2].trim();
    if (v) keys.add(v);
    continue;
  }

  m = line.match(/^\s*S3Key\s*:\s*([^#]+)\s*(?:#.*)?$/);
  if (m) {
    const v = m[1].trim();
    if (v) keys.add(v);
    continue;
  }

  m = line.match(/"S3Key"\s*:\s*(['"])(.+?)\1\s*(?:,)?\s*$/);
  if (m) {
    const v = m[2].trim();
    if (v) keys.add(v);
    continue;
  }
}

for (const key of [...keys].sort()) console.log(key);
NODE

if [ ! -s /tmp/s3keys.txt ]; then
  echo "ERROR: No S3Key entries found in packaged.yaml"
  exit 1
fi

echo "Checking uploaded artifacts..."

missing=0

while read -r key; do
  if [ -z "$key" ]; then
    continue
  fi

  if ! echo "$key" | grep -q "serverless/template-service/${STAGE}/"; then
    echo "ERROR: S3 key is not for stage $STAGE: $key"
    missing=1
    continue
  fi

  printf "Checking %-80s" "$key"

  if aws s3api head-object \
      --bucket "$BUCKET" \
      --key "$key" >/dev/null 2>&1; then
    echo "FOUND"
  else
    echo "MISSING"
    missing=1
  fi
done < /tmp/s3keys.txt

if [ "$missing" -ne 0 ]; then
  echo "ERROR: One or more Lambda artifacts are missing"
  exit 1
fi

echo "======================================="
echo "ALL ARTIFACTS VERIFIED"
echo "======================================="
