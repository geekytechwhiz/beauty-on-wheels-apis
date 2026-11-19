#!/usr/bin/env bash
set -euo pipefail


PROFILE="carish-new"
REGION="us-east-1"
EXPECTED_ACCOUNT="338460632523"
STACK="aps1dev-carish-vendor-dev"

ACCOUNT=$(aws sts get-caller-identity \
  --profile "$PROFILE" \
  --region "$REGION" \
  --query Account \
  --output text)

echo "AWS account: $ACCOUNT"
echo "Region:      $REGION"
echo "Stack:       $STACK"

if [[ "$ACCOUNT" != "$EXPECTED_ACCOUNT" ]]; then
  echo "Account mismatch. Stopping without deleting anything."
  exit 1
fi

read -r -p "Type the stack name to confirm: " CONFIRM
if [[ "$CONFIRM" != "$STACK" ]]; then
  echo "Confirmation did not match. Stopping."
  exit 1
fi

aws cloudformation update-termination-protection \
  --stack-name "$STACK" \
  --no-enable-termination-protection \
  --profile "$PROFILE" \
  --region "$REGION"

aws cloudformation delete-stack \
  --stack-name "$STACK" \
  --deletion-mode FORCE_DELETE_STACK \
  --profile "$PROFILE" \
  --region "$REGION"

echo "Force delete requested. Waiting for CloudFormation..."
if ! aws cloudformation wait stack-delete-complete \
  --stack-name "$STACK" \
  --profile "$PROFILE" \
  --region "$REGION"; then
  echo "Deletion did not complete successfully. Current stack status:"
  aws cloudformation describe-stacks \
    --stack-name "$STACK" \
    --profile "$PROFILE" \
    --region "$REGION" \
    --query 'Stacks[0].[StackStatus,StackStatusReason]' \
    --output table || true
  exit 1
fi

echo "Stack deletion completed. Checking for resources CloudFormation skipped:"
aws cloudformation list-stack-resources \
  --stack-name "$STACK" \
  --profile "$PROFILE" \
  --region "$REGION" \
  --query "StackResourceSummaries[?ResourceStatus=='DELETE_SKIPPED'].[LogicalResourceId,ResourceType,PhysicalResourceId,ResourceStatus]" \
  --output table || true