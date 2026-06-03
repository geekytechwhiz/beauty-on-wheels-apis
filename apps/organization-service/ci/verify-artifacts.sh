#!/bin/bash

set -euo pipefail

echo "======================================="
echo "VERIFYING DEPLOYMENT ARTIFACTS"
echo "======================================="

SERVICE_DIR="$CODEBUILD_SRC_DIR/apps/organization-service"

cd "$SERVICE_DIR"

TEMPLATE="packaged.yaml"

if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: packaged.yaml not found"
  exit 1
fi

echo "Resolving S3 bucket..."

# Prefer the bucket used by `aws cloudformation package` in build.sh (matches packaged.yaml).
if [ -n "${DEPLOYMENT_BUCKET:-}" ]; then
  BUCKET="$DEPLOYMENT_BUCKET"
else
  # Fallback: literal S3Bucket in template (single-line string values only).
  BUCKET=$(grep -E '^\s*S3Bucket:\s+.+' "$TEMPLATE" \
    | awk '{print $2}' \
    | tr -d "'\"" \
    | awk 'NF' \
    | head -1)
fi

if [ -z "$BUCKET" ]; then
  echo "ERROR: Could not determine S3 bucket (set DEPLOYMENT_BUCKET or ensure packaged.yaml has S3Bucket)"
  exit 1
fi

echo "Using bucket:"
echo "$BUCKET"

echo "Extracting S3 keys..."

node <<'NODE' > /tmp/s3keys.txt
const fs = require('fs');
const raw = fs.readFileSync('packaged.yaml', 'utf8');
const keys = new Set();

const trimmed = raw.trim();
if (trimmed.startsWith('{')) {
  const tpl = JSON.parse(raw);
  for (const res of Object.values(tpl.Resources || {})) {
    const code = res.Properties && res.Properties.Code;
    if (code && typeof code.S3Key === 'string') keys.add(code.S3Key);
  }
} else {
  const lines = raw.split(/\r?\n/);
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
    m = line.match(/^\s*"S3Key"\s*:\s*"(.+)"\s*,?\s*$/);
    if (m) {
      const v = m[1].trim();
      if (v) keys.add(v);
    }
  }
}

for (const key of [...keys].sort()) console.log(key);
NODE

if [ ! -s /tmp/s3keys.txt ]; then
  echo "ERROR: No S3Key entries found"
  exit 1
fi

echo "Checking uploaded artifacts..."

missing=0

while read -r key; do

  if [ -z "$key" ]; then
    continue
  fi

  printf "Checking %s ... " "$key"

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