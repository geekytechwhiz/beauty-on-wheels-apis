#!/bin/bash

set -euo pipefail

echo "======================================="
echo "BUILD STARTED"
echo "======================================="

SERVICE_DIR="${CODEBUILD_SRC_DIR:-}/apps/alert-service"
if [ ! -d "$SERVICE_DIR" ]; then
  SERVICE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
fi

cd "$SERVICE_DIR"

STAGE="${STAGE:-dev}"
DEPLOYMENT_BUCKET="${DEPLOYMENT_BUCKET:-${STAGE}-mvx-alert-service-bucket}"

echo "Current Directory:"
pwd
echo "STAGE=$STAGE DEPLOYMENT_BUCKET=$DEPLOYMENT_BUCKET"

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

# Serverless already uploaded all Lambda zips to the deploymentBucket and
# embedded S3Bucket/S3Key in the generated CF template. Copy it as packaged.yaml
# so the deploy stage can consume it without a redundant `aws cloudformation package`.
cp "$TEMPLATE" packaged.yaml

echo "Verifying Lambda S3 keys are present in s3://$DEPLOYMENT_BUCKET ..."
node <<'NODE' > .serverless/s3keys.txt
const fs = require('fs');
const raw = fs.readFileSync('.serverless/' + (
  fs.existsSync('.serverless/cloudformation-template-update-stack.json')
    ? 'cloudformation-template-update-stack.json'
    : 'cloudformation-template-create-stack.json'
), 'utf8');
const tpl = JSON.parse(raw);
const keys = new Set();

for (const res of Object.values(tpl.Resources || {})) {
  const code = res.Properties && res.Properties.Code;
  if (code && code.S3Key) keys.add(code.S3Key);
}

for (const key of [...keys].sort()) console.log(key);
NODE

if [ ! -s .serverless/s3keys.txt ]; then
  echo "WARN: No S3Key entries found in CF template — Serverless may have used inline ZipFile or a different layout."
  echo "Listing .serverless contents for diagnosis:"
  ls -la .serverless/
else
  echo "Uploading Lambda zips to their exact S3 keys..."
  while read -r key; do
    [ -z "$key" ] && continue
    # Key format: serverless/alert-service/<stage>/<timestamp>/<name>.zip
    # Strip any @... suffix (added by some CF tooling) to get the clean zip filename.
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
fi

echo "Packaged template created:"
ls -la packaged.yaml

echo "======================================="
echo "BUILD COMPLETED"
echo "======================================="