#!/bin/bash

set -euo pipefail

echo "======================================="
echo "VERIFYING DEPLOYMENT ARTIFACTS"
echo "======================================="

SERVICE_DIR="$CODEBUILD_SRC_DIR/apps/user-service"

cd "$SERVICE_DIR"

TEMPLATE="packaged.yaml"
KEYS_FILE=".serverless/s3keys.txt"

if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: packaged.yaml not found"
  exit 1
fi

if [ -z "${DEPLOYMENT_BUCKET:-}" ]; then
  echo "ERROR: DEPLOYMENT_BUCKET is not set"
  exit 1
fi

echo "Resolving Lambda S3 keys..."

if [ -s "$KEYS_FILE" ]; then
  echo "Using keys from $KEYS_FILE"
  cp "$KEYS_FILE" /tmp/user-service-s3keys.txt
else
  echo "Extracting keys from packaged.yaml ..."
  CF_TEMPLATE=""
  if [ -f ".serverless/cloudformation-template-update-stack.json" ]; then
    CF_TEMPLATE=".serverless/cloudformation-template-update-stack.json"
  elif [ -f ".serverless/cloudformation-template-create-stack.json" ]; then
    CF_TEMPLATE=".serverless/cloudformation-template-create-stack.json"
  fi

  CF_TEMPLATE="$CF_TEMPLATE" node <<'NODE' > /tmp/user-service-s3keys.txt
const fs = require('fs');

const collectKeys = (raw) => {
  const keys = new Set();
  if (!raw) return keys;

  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const tpl = JSON.parse(raw);
      for (const res of Object.values(tpl.Resources || {})) {
        const code = res.Properties && res.Properties.Code;
        if (code && typeof code.S3Key === 'string') {
          keys.add(code.S3Key);
        }
      }
    } catch (_) {
      // Fall through to text extraction.
    }
  }

  for (const match of raw.matchAll(/"S3Key"\s*:\s*"([^"]+)"/g)) {
    keys.add(match[1]);
  }

  for (const match of raw.matchAll(/(?:^|\n)\s*S3Key:\s*('([^']+)'|"([^"]+)"|([^#\n]+))/g)) {
    const value = (match[2] || match[3] || match[4] || '').trim();
    if (value) keys.add(value);
  }

  return keys;
};

const sources = ['packaged.yaml'];
if (process.env.CF_TEMPLATE) {
  sources.push(process.env.CF_TEMPLATE);
}

let keys = new Set();
for (const source of sources) {
  if (!fs.existsSync(source)) continue;
  const next = collectKeys(fs.readFileSync(source, 'utf8'));
  if (next.size > keys.size) {
    keys = next;
  }
}

for (const key of [...keys].sort()) {
  console.log(key);
}
NODE
fi

if [ ! -s /tmp/user-service-s3keys.txt ]; then
  echo "ERROR: No S3Key entries found in packaged.yaml"
  echo "packaged.yaml size: $(wc -c < "$TEMPLATE") bytes"
  echo "packaged.yaml preview:"
  head -n 40 "$TEMPLATE" || true
  exit 1
fi

echo "Using bucket: $DEPLOYMENT_BUCKET"
echo "Checking uploaded artifacts..."

missing=0

while read -r key; do
  if [ -z "$key" ]; then
    continue
  fi

  printf "Checking s3://%s/%s ... " "$DEPLOYMENT_BUCKET" "$key"

  if aws s3api head-object \
      --bucket "$DEPLOYMENT_BUCKET" \
      --key "$key" >/dev/null 2>&1; then
    echo "FOUND"
  else
    echo "MISSING"
    missing=1
  fi
done < /tmp/user-service-s3keys.txt

if [ "$missing" -ne 0 ]; then
  echo "ERROR: One or more Lambda artifacts are missing"
  exit 1
fi

echo "======================================="
echo "ALL ARTIFACTS VERIFIED"
echo "======================================="
