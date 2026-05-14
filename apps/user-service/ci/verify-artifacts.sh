#!/bin/bash

set -euo pipefail

echo "======================================="
echo "VERIFYING DEPLOYMENT ARTIFACTS"
echo "======================================="

SERVICE_DIR="$CODEBUILD_SRC_DIR/apps/user-service"

cd "$SERVICE_DIR"

TEMPLATE="packaged.yaml"

if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: packaged.yaml not found"
  exit 1
fi

echo "Resolving S3 bucket and keys from packaged.yaml..."

node <<'NODE' > /tmp/user-service-artifacts.tsv
const fs = require('fs');
const raw = fs.readFileSync('packaged.yaml', 'utf8');
const entries = new Map();

const add = (bucket, key) => {
  if (!key) return;
  if (!entries.has(key)) {
    entries.set(key, (bucket || '').trim());
  }
};

const addFromTemplate = (tpl) => {
  for (const res of Object.values(tpl.Resources || {})) {
    const code = res.Properties && res.Properties.Code;
    if (!code || typeof code.S3Key !== 'string') continue;

    let bucket = '';
    if (typeof code.S3Bucket === 'string') {
      bucket = code.S3Bucket;
    } else if (code.S3Bucket && typeof code.S3Bucket.Ref === 'string') {
      bucket = code.S3Bucket.Ref;
    }

    add(bucket, code.S3Key);
  }
};

const trimmed = raw.trim();
if (trimmed.startsWith('{')) {
  try {
    addFromTemplate(JSON.parse(raw));
  } catch (_) {
    // Fall through to text extraction.
  }
}

let currentBucket = '';
for (const line of raw.split(/\r?\n/)) {
  let match = line.match(/^\s*"S3Bucket"\s*:\s*"([^"]+)"/);
  if (match) {
    currentBucket = match[1].trim();
    continue;
  }

  match = line.match(/^\s*S3Bucket\s*:\s*(['"])(.+)\1\s*(?:#.*)?$/);
  if (match) {
    currentBucket = match[2].trim();
    continue;
  }

  match = line.match(/^\s*S3Bucket\s*:\s*([^#]+)\s*(?:#.*)?$/);
  if (match) {
    currentBucket = match[1].trim();
    continue;
  }

  match = line.match(/^\s*"S3Key"\s*:\s*"([^"]+)"/);
  if (match) {
    add(currentBucket, match[1].trim());
    continue;
  }

  match = line.match(/^\s*S3Key\s*:\s*(['"])(.+)\1\s*(?:#.*)?$/);
  if (match) {
    add(currentBucket, match[2].trim());
    continue;
  }

  match = line.match(/^\s*S3Key\s*:\s*([^#]+)\s*(?:#.*)?$/);
  if (match) {
    add(currentBucket, match[1].trim());
  }
}

for (const [key, bucket] of [...entries.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`${bucket}\t${key}`);
}
NODE

if [ ! -s /tmp/user-service-artifacts.tsv ]; then
  echo "ERROR: No S3Key entries found in packaged.yaml"
  exit 1
fi

if [ -n "${DEPLOYMENT_BUCKET:-}" ]; then
  DEFAULT_BUCKET="$DEPLOYMENT_BUCKET"
else
  DEFAULT_BUCKET=$(awk -F '\t' 'NF && $1 != "ServerlessDeploymentBucket" { print $1; exit }' /tmp/user-service-artifacts.tsv)
fi

if [ -z "$DEFAULT_BUCKET" ]; then
  echo "ERROR: Could not determine S3 bucket (set DEPLOYMENT_BUCKET or ensure packaged.yaml has S3Bucket)"
  exit 1
fi

echo "Default bucket: $DEFAULT_BUCKET"
echo "Checking uploaded artifacts..."

missing=0

while IFS=$'\t' read -r bucket key; do
  if [ -z "$key" ]; then
    continue
  fi

  if [ -z "$bucket" ] || [ "$bucket" = "ServerlessDeploymentBucket" ]; then
    bucket="$DEFAULT_BUCKET"
  fi

  printf "Checking s3://%s/%s ... " "$bucket" "$key"

  if aws s3api head-object \
      --bucket "$bucket" \
      --key "$key" >/dev/null 2>&1; then
    echo "FOUND"
  else
    echo "MISSING"
    missing=1
  fi
done < /tmp/user-service-artifacts.tsv

if [ "$missing" -ne 0 ]; then
  echo "ERROR: One or more Lambda artifacts are missing"
  exit 1
fi

echo "======================================="
echo "ALL ARTIFACTS VERIFIED"
echo "======================================="
