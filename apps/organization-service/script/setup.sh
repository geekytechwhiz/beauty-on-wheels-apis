#!/bin/bash

# ====== CONFIG ======
STAGE="stg"
REGION="us-east-1"
USER_POOL_ID="us-east-1_wttVwD9Ax"

if [ -z "$STAGE" ]; then
  echo "Usage: ./seed-root-admin.sh <stage>"
  exit 1
fi

USER_TABLE="user-table-${STAGE}"
ORG_TABLE="organization-table-${STAGE}"

# ====== USER DATA ======
ORG_ID="ROOT"
USER_ID="88a9a6e052092188660a404a303ca34c992caabfccfc184ca2121fcac2d84e7f"
EMAIL="rootadmin@yopmail.com"
PASSWORD="Temp@12345"

ORG_PK="ORG#${ORG_ID}"
ORG_SK="ORG_DETAILS"

USER_PK="ORG#${ORG_ID}"
USER_SK="USER#${USER_ID}"

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "Inserting Organization metadata into $ORG_TABLE..."

aws dynamodb put-item \
  --region $REGION \
  --table-name $ORG_TABLE \
  --item "{
    \"PK\": {\"S\": \"$ORG_PK\"},
    \"SK\": {\"S\": \"$ORG_SK\"},
    \"organizationID\": {\"S\": \"$ORG_ID\"},
    \"entityType\": {\"S\": \"ORGANIZATION\"},
    \"name\": {\"S\": \"Root Organization\"},
    \"status\": {\"S\": \"ACTIVE\"},
    \"createdAt\": {\"S\": \"$NOW\"},
    \"updatedAt\": {\"S\": \"$NOW\"}
  }"

echo "Inserting User metadata into $USER_TABLE..."

aws dynamodb put-item \
  --region $REGION \
  --table-name $USER_TABLE \
  --item "{
    \"pk\": {\"S\": \"$USER_PK\"},
    \"sk\": {\"S\": \"$USER_SK\"},
    \"userID\": {\"S\": \"$USER_ID\"},
    \"organizationID\": {\"S\": \"$ORG_ID\"},
    \"email\": {\"S\": \"$EMAIL\"},
    \"entityType\": {\"S\": \"USER\"},
    \"role\": {\"S\": \"ROOT_ADMIN\"},
    \"permissions\": {\"L\": []},
    \"status\": {\"S\": \"ACTIVE\"},
    \"createdAt\": {\"S\": \"$NOW\"},
    \"updatedAt\": {\"S\": \"$NOW\"}
  }"

echo "Creating Cognito user..."

aws cognito-idp admin-create-user \
  --region $REGION \
  --user-pool-id $USER_POOL_ID \
  --username $EMAIL \
  --message-action SUPPRESS \
  --user-attributes \
      Name=email,Value=$EMAIL \
      Name=email_verified,Value=true \
      Name=custom:organizationID,Value=$ORG_ID \
      Name=custom:userID,Value=$USER_ID \
      Name=custom:userType,Value=ROOT_ADMIN \
      Name=custom:role,Value='[]' \
      Name=custom:permissions,Value='[]' \
      Name=custom:src,Value=$EMAIL

aws cognito-idp admin-set-user-password \
  --region $REGION \
  --user-pool-id $USER_POOL_ID \
  --username $EMAIL \
  --password "$PASSWORD" \
  --permanent

echo "✅ Root admin setup completed for stage: $STAGE"