#!/bin/bash

set -e

# -----------------------------
# CONFIG
# -----------------------------
LAMBDA_NAME="cf-basic-auth"
ROLE_NAME="developer-hub-dev-us-east-1-lambdaRole"
REGION="us-east-1"   # MUST be us-east-1 for Lambda@Edge

LAMBDA_DIR="api-center/edge-auth"
ZIP_FILE="$LAMBDA_DIR/function.zip"

echo "========================================="
echo "🚀 LAMBDA@EDGE DEPLOYMENT STARTED"
echo "========================================="

# -----------------------------
# ACCOUNT ID
# -----------------------------
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account ID: $ACCOUNT_ID"

# -----------------------------
# CREATE ROLE (IF NOT EXISTS)
# -----------------------------
echo "🔐 Checking IAM role..."

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "✅ Role exists: $ROLE_NAME"
else
  echo "🚀 Creating IAM role..."

  cat > trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Service": [
        "lambda.amazonaws.com",
        "edgelambda.amazonaws.com"
      ]
    },
    "Action": "sts:AssumeRole"
  }]
}
EOF

  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document file://trust.json

  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

  echo "⏳ Waiting for IAM propagation..."
  sleep 15
fi

ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME"
echo "Role ARN: $ROLE_ARN"

# -----------------------------
# PACKAGE LAMBDA
# -----------------------------
echo "📦 Packaging Lambda..."

cd "$LAMBDA_DIR"
zip -r function.zip . >/dev/null
cd -

echo "✅ Package created: $ZIP_FILE"

# -----------------------------
# CREATE OR UPDATE LAMBDA
# -----------------------------
echo "🚀 Deploying Lambda..."

if aws lambda get-function --function-name "$LAMBDA_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "🔄 Updating existing Lambda..."

  aws lambda update-function-code \
    --function-name "$LAMBDA_NAME" \
    --zip-file "fileb://$ZIP_FILE" \
    --region "$REGION"

else
  echo "🆕 Creating new Lambda..."

  aws lambda create-function \
    --function-name "$LAMBDA_NAME" \
    --runtime nodejs18.x \
    --handler index.handler \
    --role "$ROLE_ARN" \
    --zip-file "fileb://$ZIP_FILE" \
    --region "$REGION"
fi

# -----------------------------
# PUBLISH VERSION (MANDATORY)
# -----------------------------
echo "📌 Publishing Lambda version..."

VERSION=$(aws lambda publish-version \
  --function-name "$LAMBDA_NAME" \
  --region "$REGION" \
  --query 'Version' \
  --output text)

echo "✅ Published version: $VERSION"

# -----------------------------
# FINAL ARN
# -----------------------------
LAMBDA_ARN="arn:aws:lambda:$REGION:$ACCOUNT_ID:function:$LAMBDA_NAME:$VERSION"

echo ""
echo "========================================="
echo "🎉 LAMBDA DEPLOYED SUCCESSFULLY"
echo "========================================="
echo "Lambda Name: $LAMBDA_NAME"
echo "Version: $VERSION"
echo "Lambda ARN:"
echo "$LAMBDA_ARN"
echo ""

echo "👉 Next Step: Attach to CloudFront"
echo ""