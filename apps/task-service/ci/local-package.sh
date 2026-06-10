#!/bin/bash

# Fast local build check for template-service.
# Runs `serverless package` only — no S3 uploads, no AWS calls.
# Purpose: quickly confirm the service builds/packages without errors.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STAGE="${STAGE:-dev}"

cd "$SERVICE_DIR"

echo "======================================="
echo "LOCAL BUILD CHECK STARTED (stage=$STAGE)"
echo "======================================="

echo "Cleaning old artifacts..."
rm -rf .serverless

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}"

echo "Packaging Serverless service..."
npx serverless package --stage "$STAGE" --package .serverless

echo "======================================="
echo "BUILD OK — no errors"
echo "======================================="
