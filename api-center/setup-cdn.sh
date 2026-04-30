#!/bin/bash

set -e

# -----------------------------
# CONFIG
# -----------------------------
BUCKET_NAME="dev-mib-api-center-bucket"
REGION="ap-south-1"
DISTRIBUTION_COMMENT="api-center-cdn"
INDEX_DOC="index.html"

echo "========================================="
echo "🚀 CDN SETUP STARTED"
echo "========================================="

# -----------------------------
# CHECK / CREATE S3 BUCKET
# -----------------------------
echo "🔍 Checking S3 bucket..."

if aws s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
  echo "✅ Bucket already exists: $BUCKET_NAME"
else
  echo "🚀 Creating S3 bucket..."

  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET_NAME"
  else
    aws s3api create-bucket \
      --bucket "$BUCKET_NAME" \
      --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION"
  fi

  echo "✅ Bucket created"
fi

# -----------------------------
# APPLY SECURITY (ALWAYS)
# -----------------------------
echo "🔒 Applying bucket security..."

aws s3api put-public-access-block \
  --bucket $BUCKET_NAME \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption \
  --bucket $BUCKET_NAME \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'

echo "✅ Security applied"

# -----------------------------
# CREATE OAC (ALWAYS NEW OR REUSE)
# -----------------------------
echo "🔑 Creating / Reusing OAC..."

OAC_NAME="OAC-$BUCKET_NAME"

EXISTING_OAC_ID=$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='$OAC_NAME'].Id" \
  --output text)

if [ -n "$EXISTING_OAC_ID" ]; then
  OAC_ID=$EXISTING_OAC_ID
  echo "✅ Reusing existing OAC: $OAC_ID"
else
  OAC_ID=$(aws cloudfront create-origin-access-control \
    --origin-access-control-config '{
      "Name": "'"$OAC_NAME"'",
      "Description": "OAC for S3 bucket",
      "SigningProtocol": "sigv4",
      "SigningBehavior": "always",
      "OriginAccessControlOriginType": "s3"
    }' \
    --query 'OriginAccessControl.Id' \
    --output text)

  echo "✅ Created OAC: $OAC_ID"
fi

# -----------------------------
# CHECK EXISTING DISTRIBUTION
# -----------------------------
echo "🔍 Checking CloudFront distribution..."

DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$DISTRIBUTION_COMMENT'].Id" \
  --output text)

if [ -n "$DIST_ID" ]; then
  echo "✅ Reusing existing distribution: $DIST_ID"
else
  echo "🌍 Creating CloudFront distribution..."

  DIST_CONFIG=$(cat <<EOF
{
  "CallerReference": "$(date +%s)",
  "Comment": "$DISTRIBUTION_COMMENT",
  "Enabled": true,
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "S3-$BUCKET_NAME",
      "DomainName": "$BUCKET_NAME.s3.$REGION.amazonaws.com",
      "S3OriginConfig": {
        "OriginAccessIdentity": ""
      },
      "OriginAccessControlId": "$OAC_ID"
    }]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3-$BUCKET_NAME",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"]
    },
    "Compress": true,
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "OriginRequestPolicyId": "88a5eaf4-2fd4-4709-b370-b4c650ea3fcf"
  },
  "DefaultRootObject": "$INDEX_DOC",
  "PriceClass": "PriceClass_200",
  "ViewerCertificate": {
    "CloudFrontDefaultCertificate": true
  }
}
EOF
)

  DIST_ID=$(aws cloudfront create-distribution \
    --distribution-config "$DIST_CONFIG" \
    --query 'Distribution.Id' \
    --output text)

  echo "✅ Created distribution: $DIST_ID"
fi

# -----------------------------
# GET DISTRIBUTION ARN
# -----------------------------
DIST_ARN=$(aws cloudfront get-distribution \
  --id $DIST_ID \
  --query 'Distribution.ARN' \
  --output text)

echo "📌 Distribution ARN: $DIST_ARN"

# -----------------------------
# ATTACH BUCKET POLICY
# -----------------------------
echo "🔐 Applying bucket policy..."

POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Service": "cloudfront.amazonaws.com"
    },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$BUCKET_NAME/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "$DIST_ARN"
      }
    }
  }]
}
EOF
)

aws s3api put-bucket-policy \
  --bucket $BUCKET_NAME \
  --policy "$POLICY"

echo "✅ Bucket policy applied"

# -----------------------------
# OUTPUT
# -----------------------------
CF_DOMAIN=$(aws cloudfront get-distribution \
  --id $DIST_ID \
  --query 'Distribution.DomainName' \
  --output text)

echo ""
echo "========================================="
echo "🎉 SETUP COMPLETE"
echo "========================================="
echo "S3 Bucket: $BUCKET_NAME"
echo "CloudFront Distribution ID: $DIST_ID"
echo "CloudFront URL: https://$CF_DOMAIN"
echo ""
echo "Next step:"
echo "aws s3 sync api-center/dist s3://$BUCKET_NAME"
echo ""