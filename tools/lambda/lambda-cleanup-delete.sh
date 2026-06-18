#!/bin/bash

AWS_PROFILE="ci-dev-"
AWS_REGION="us-east-1"
MAX_FUNCTIONS=1

echo ""
echo "=========================================================="
echo "LAMBDA VERSION CLEANUP - DELETE MODE"
echo "=========================================================="
echo "Profile      : $AWS_PROFILE"
echo "Region       : $AWS_REGION"
echo "Max Functions: $MAX_FUNCTIONS"
echo "Started At   : $(date)"
echo "=========================================================="

read -p "WARNING: This will DELETE Lambda versions. Continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Operation cancelled."
    exit 0
fi

FUNCTIONS=$(aws lambda list-functions \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --query 'Functions[?starts_with(FunctionName, ` device-service-dev-deviceOrgList`)].FunctionName' \
  --output text | tr '\t' '\n' | head -$MAX_FUNCTIONS)

for FUNCTION_NAME in $FUNCTIONS
do
    echo ""
    echo "##########################################################"
    echo "Processing Function: $FUNCTION_NAME"
    echo "##########################################################"

    VERSIONS=$(aws lambda list-versions-by-function \
      --function-name "$FUNCTION_NAME" \
      --profile "$AWS_PROFILE" \
      --region "$AWS_REGION" \
      --query 'Versions[?Version!=`$LATEST`].Version' \
      --output text | tr '\t' '\n' | sort -n)

    VERSION_COUNT=$(echo "$VERSIONS" | grep -v '^$' | wc -l)

    echo "Published Versions Found: $VERSION_COUNT"

    if [ "$VERSION_COUNT" -le 2 ]; then
        echo "Nothing to delete."
        continue
    fi

    KEEP=$(echo "$VERSIONS" | tail -2)

    echo "Keeping versions:"
    echo "$KEEP"

    for VERSION in $VERSIONS
    do
        if echo "$KEEP" | grep -qx "$VERSION"; then
            echo "[KEEP] $FUNCTION_NAME -> Version $VERSION"
            continue
        fi

        echo "[DELETE] $FUNCTION_NAME -> Version $VERSION"

        aws lambda delete-function \
          --function-name "$FUNCTION_NAME" \
          --qualifier "$VERSION" \
          --profile "$AWS_PROFILE" \
          --region "$AWS_REGION"

        if [ $? -eq 0 ]; then
            echo "[SUCCESS] Deleted version $VERSION"
        else
            echo "[ERROR] Failed to delete version $VERSION"
        fi
    done
done

echo ""
echo "=========================================================="
echo "Cleanup Completed"
echo "Finished At: $(date)"
echo "=========================================================="