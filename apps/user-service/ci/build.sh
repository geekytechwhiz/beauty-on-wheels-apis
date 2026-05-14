#!/bin/bash

set -euo pipefail

echo "======================================="
echo "BUILD STARTED"
echo "======================================="

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Installing pnpm (required by serverless-esbuild packager)..."
  npm install -g pnpm@10
fi

pnpm --version

SERVICE_DIR="$CODEBUILD_SRC_DIR/apps/user-service"

cd "$SERVICE_DIR"

echo "Current Directory:"
pwd

echo "Cleaning old artifacts..."
rm -rf .serverless

export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=4096"

echo "Packaging Serverless service..."

npx serverless package \
  --stage "$STAGE" \
  --package .serverless

echo "Finding generated CloudFormation template..."

if [ -f ".serverless/cloudformation-template-update-stack.json" ]; then
  TEMPLATE=".serverless/cloudformation-template-update-stack.json"
elif [ -f ".serverless/cloudformation-template-create-stack.json" ]; then
  TEMPLATE=".serverless/cloudformation-template-create-stack.json"
else
  echo "ERROR: No CloudFormation template generated"
  ls -la .serverless || true
  exit 1
fi

echo "Using template: $TEMPLATE"

echo "Packaging CloudFormation template and uploading artifacts to s3://$DEPLOYMENT_BUCKET ..."
aws cloudformation package \
  --template-file "$TEMPLATE" \
  --s3-bucket "$DEPLOYMENT_BUCKET" \
  --output-template-file packaged.yaml \
  --force-upload

echo "Extracting Lambda S3 keys from packaged.yaml ..."
node <<'NODE' > .serverless/s3keys.txt
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
  for (const line of raw.split(/\r?\n/)) {
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

if [ ! -s .serverless/s3keys.txt ]; then
  echo "ERROR: No S3Key entries found in packaged.yaml"
  exit 1
fi

echo "Ensuring every packaged Lambda zip exists at its exact S3 key..."
while read -r key; do
  [ -z "$key" ] && continue
  zip_name=$(basename "${key%%@*}")
  local_path=".serverless/$zip_name"
  if [ ! -f "$local_path" ]; then
    echo "ERROR: Local artifact not found: $local_path (key: $key)"
    exit 1
  fi
  echo "Uploading $local_path → s3://$DEPLOYMENT_BUCKET/$key"
  aws s3 cp "$local_path" "s3://$DEPLOYMENT_BUCKET/$key"
done < .serverless/s3keys.txt

echo "Verifying all artifacts are present in s3://$DEPLOYMENT_BUCKET ..."
missing=0
while read -r key; do
  [ -z "$key" ] && continue
  printf " → %-80s " "$key"
  if aws s3api head-object --bucket "$DEPLOYMENT_BUCKET" --key "$key" >/dev/null 2>&1; then
    echo "FOUND"
  else
    echo "MISSING"
    missing=1
  fi
done < .serverless/s3keys.txt

if [ "$missing" -ne 0 ]; then
  echo "ERROR: One or more Lambda artifacts are still missing in s3://$DEPLOYMENT_BUCKET"
  exit 1
fi

echo "Packaged template created:"
ls -la packaged.yaml

echo "======================================="
echo "BUILD COMPLETED"
echo "======================================="
