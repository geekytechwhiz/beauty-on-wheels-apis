#!/bin/bash

set -e  # stop on error

# -----------------------------
# CONFIG
# -----------------------------
AWS_REGION="ap-south-1"
EDGE_REGION="us-east-1"

BUCKET_NAME="dev-mib-api-center-bucket"
CLOUDFRONT_DISTRIBUTION_ID="E2IR80EP36T2RA"

LAMBDA_NAME="cf-basic-auth"
LAMBDA_ROLE_ARN="arn:aws:iam::462778607085:role/api-center-dev-us-east-1-lambdaRole"

BUILD_DIR="dist"
EDGE_DIR="edge-auth"

echo "========================================="
echo "🚀 DEPLOY STARTED"
echo "========================================="

echo "📁 Running from: $(pwd)"

# -----------------------------
# INSTALL
# -----------------------------
echo "📦 Installing dependencies..."
npm install

# -----------------------------
# BUILD
# -----------------------------
echo "🏗️ Building app..."
npm run build

# -----------------------------
# VERIFY BUILD
# -----------------------------
if [ ! -d "$BUILD_DIR" ]; then
  echo "❌ Build directory not found: $BUILD_DIR"
  exit 1
fi

echo "✅ Build found"

# -----------------------------
# SYNC S3 + MIME / CACHE (shared with CodeBuild optional step)
# -----------------------------
echo "🧹 Syncing bucket (with Content-Type / Cache-Control overrides)..."

export API_CENTER_S3_BUCKET="$BUCKET_NAME"
export API_CENTER_S3_REGION="$AWS_REGION"
bash "./scripts/publish-dist-to-s3.sh"

# -----------------------------
# 🚀 LAMBDA@EDGE DEPLOY
# -----------------------------
echo "🔐 Deploying Lambda@Edge..."

cd $EDGE_DIR

zip -r function.zip . >/dev/null

if aws lambda get-function --function-name $LAMBDA_NAME --region $EDGE_REGION >/dev/null 2>&1; then
  echo "🔄 Updating Lambda..."
  aws lambda update-function-code \
    --function-name $LAMBDA_NAME \
    --zip-file fileb://function.zip \
    --region $EDGE_REGION
else
  echo "🆕 Creating Lambda..."
  aws lambda create-function \
    --function-name $LAMBDA_NAME \
    --runtime nodejs18.x \
    --handler index.handler \
    --role $LAMBDA_ROLE_ARN \
    --zip-file fileb://function.zip \
    --region $EDGE_REGION
fi

# Publish new version
VERSION=$(aws lambda publish-version \
  --function-name $LAMBDA_NAME \
  --region $EDGE_REGION \
  --query 'Version' \
  --output text)

echo "✅ Lambda version: $VERSION"

cd ..

# -----------------------------
# 🌍 ATTACH TO CLOUDFRONT
# -----------------------------
echo "🌍 Attaching Lambda to CloudFront..."

aws cloudfront get-distribution-config \
  --id $CLOUDFRONT_DISTRIBUTION_ID > cf.json

ETAG=$(jq -r '.ETag' cf.json)

jq '.DistributionConfig' cf.json > dist-config.json

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

LAMBDA_ARN="arn:aws:lambda:$EDGE_REGION:$ACCOUNT_ID:function:$LAMBDA_NAME:$VERSION"

UPDATED=$(jq "
.DefaultCacheBehavior.LambdaFunctionAssociations = {
  Quantity: 1,
  Items: [{
    EventType: \"viewer-request\",
    LambdaFunctionARN: \"$LAMBDA_ARN\"
  }]
}
" dist-config.json)

echo "$UPDATED" > updated-config.json

aws cloudfront update-distribution \
  --id $CLOUDFRONT_DISTRIBUTION_ID \
  --if-match $ETAG \
  --distribution-config file://updated-config.json

echo "✅ CloudFront updated"

# -----------------------------
# INVALIDATE CACHE
# -----------------------------
echo "🔄 Invalidating CloudFront..."

aws cloudfront create-invalidation \
  --distribution-id $CLOUDFRONT_DISTRIBUTION_ID \
  --paths "/index.html" "/favicon.ico"

echo "========================================="
echo "🎉 DEPLOY SUCCESS"
echo "========================================="