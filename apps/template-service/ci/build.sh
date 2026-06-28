#!/bin/bash

set -euo pipefail

echo "======================================="
echo "BUILD STARTED"
echo "======================================="

: "${STAGE:?STAGE must be set (dev, stg, or prd)}"
: "${DEPLOYMENT_BUCKET:?DEPLOYMENT_BUCKET must be set}"

EXPECTED_BUCKET="${STAGE}-mvx-template-service-bucket"
if [ "$DEPLOYMENT_BUCKET" != "$EXPECTED_BUCKET" ]; then
  echo "ERROR: DEPLOYMENT_BUCKET=$DEPLOYMENT_BUCKET does not match STAGE=$STAGE (expected $EXPECTED_BUCKET)"
  echo "Use buildspec.yml (dev), stg-buildspec.yml (stg), or prd-buildspec.yml (prd) for this pipeline."
  exit 1
fi

# Catch CodeBuild projects wired to the wrong buildspec (e.g. stg role uploading to dev bucket → AccessDenied).
CODEBUILD_ROLE="${CODEBUILD_BUILD_ARN:-${AWS_ROLE_ARN:-}}"
CODEBUILD_PROJECT="${CODEBUILD_PROJECT_NAME:-}"
PIPELINE_HINT="${CODEBUILD_ROLE}${CODEBUILD_PROJECT}"
case "$PIPELINE_HINT" in
  *stg*|*STG*)
    if [ "$STAGE" != "stg" ]; then
      echo "ERROR: STAGING CodeBuild project detected but STAGE=$STAGE (bucket=$DEPLOYMENT_BUCKET)."
      echo "Role/project: ${CODEBUILD_ROLE:-unknown} / ${CODEBUILD_PROJECT:-unknown}"
      echo "Fix in AWS Console → CodeBuild → Edit → Buildspec:"
      echo "  apps/template-service/stg-buildspec.yml"
      echo "Expected: STAGE=stg DEPLOYMENT_BUCKET=stg-mvx-template-service-bucket"
      exit 1
    fi
    ;;
  *prd*|*PRD*|*prod*|*PROD*)
    if [ "$STAGE" != "prd" ]; then
      echo "ERROR: PRODUCTION CodeBuild project detected but STAGE=$STAGE (bucket=$DEPLOYMENT_BUCKET)."
      echo "Fix buildspec path: apps/template-service/prd-buildspec.yml"
      exit 1
    fi
    ;;
  *dev*|*DEV*)
    if [ "$STAGE" != "dev" ]; then
      echo "ERROR: DEV CodeBuild project detected but STAGE=$STAGE (bucket=$DEPLOYMENT_BUCKET)."
      echo "Fix buildspec path: apps/template-service/buildspec.yml"
      exit 1
    fi
    ;;
esac

SERVICE_DIR="${CODEBUILD_SRC_DIR:-}/apps/template-service"
if [ ! -d "$SERVICE_DIR" ]; then
  SERVICE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
fi

cd "$SERVICE_DIR"

echo "Current Directory:"
pwd
echo "STAGE=$STAGE DEPLOYMENT_BUCKET=$DEPLOYMENT_BUCKET STACK_NAME=${STACK_NAME:-}"

echo "Cleaning old artifacts..."
rm -rf .serverless
rm -f packaged.yaml

# SMALL CodeBuild (~3.6 GiB): cap Node heap so esbuild subprocess has headroom (see serverless.yml).
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"

echo "Verifying @myvitalrx/mvrx-resource-registry is loadable..."
node -e "require('@myvitalrx/mvrx-resource-registry'); console.log('mvrx-resource-registry OK')"

echo "Packaging Serverless service (NODE_OPTIONS=$NODE_OPTIONS)..."
echo "Node heap limit: $NODE_OPTIONS"
if command -v free >/dev/null 2>&1; then
  echo "Container memory:"
  free -h || true
fi

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

echo "Verifying packaged template matches STAGE=$STAGE ..."
EXPECTED_TABLE="template-service-${STAGE}"
EXPECTED_BUS="template-service-bus-${STAGE}"
if ! grep -q "$EXPECTED_TABLE" packaged.yaml; then
  echo "ERROR: packaged.yaml missing table for stage $STAGE ($EXPECTED_TABLE)"
  exit 1
fi
if ! grep -q "$EXPECTED_BUCKET" packaged.yaml; then
  echo "ERROR: packaged.yaml missing bucket for stage $STAGE ($EXPECTED_BUCKET)"
  exit 1
fi
if ! grep -q "$EXPECTED_BUS" packaged.yaml; then
  echo "ERROR: packaged.yaml missing event bus for stage $STAGE ($EXPECTED_BUS)"
  exit 1
fi
for wrong in dev stg prd; do
  if [ "$wrong" != "$STAGE" ] && grep -q "template-service-${wrong}" packaged.yaml; then
    echo "ERROR: packaged.yaml contains resources for wrong stage: template-service-${wrong}"
    exit 1
  fi
done
echo "Stage check OK"

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
    # Key format: serverless/template-service/<stage>/<timestamp>/<name>.zip
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