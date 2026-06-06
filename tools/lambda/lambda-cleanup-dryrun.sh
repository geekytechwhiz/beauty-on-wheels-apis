#!/bin/bash

AWS_PROFILE="ci-user-rx"
AWS_REGION="us-east-1"
MAX_FUNCTIONS=100

echo ""
echo "=========================================================="
echo "LAMBDA VERSION CLEANUP - DRY RUN"
echo "=========================================================="
echo "Profile      : $AWS_PROFILE"
echo "Region       : $AWS_REGION"
echo "Max Functions: $MAX_FUNCTIONS"
echo "Started At   : $(date)"
echo "=========================================================="

echo ""
echo "[STEP 1] Fetching Lambda functions starting with 'device-service-dev-'..."

FUNCTIONS=$(aws lambda list-functions \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --query 'Functions[?starts_with(FunctionName, `device-service-dev-`)].FunctionName' \
  --output text | tr '\t' '\n' | head -$MAX_FUNCTIONS)

FUNCTION_COUNT=$(echo "$FUNCTIONS" | grep -v '^$' | wc -l)

echo "[INFO] Found $FUNCTION_COUNT functions for testing."
echo ""

echo "Functions Selected:"
echo "----------------------------------------------------------"
echo "$FUNCTIONS"
echo "----------------------------------------------------------"

TOTAL_DELETE_COUNT=0
TOTAL_KEEP_COUNT=0
TOTAL_VERSION_COUNT=0

for FUNCTION_NAME in $FUNCTIONS
do
    echo ""
    echo "##########################################################"
    echo "Processing Function: $FUNCTION_NAME"
    echo "##########################################################"

    echo "[STEP 2] Fetching versions..."

    VERSIONS=$(aws lambda list-versions-by-function \
      --function-name "$FUNCTION_NAME" \
      --profile "$AWS_PROFILE" \
      --region "$AWS_REGION" \
      --query 'Versions[?Version!=`$LATEST`].Version' \
      --output text | tr '\t' '\n' | sort -n)

    VERSION_COUNT=$(echo "$VERSIONS" | grep -v '^$' | wc -l)

    echo "[INFO] Published Versions Found: $VERSION_COUNT"

    TOTAL_VERSION_COUNT=$((TOTAL_VERSION_COUNT + VERSION_COUNT))

    if [ "$VERSION_COUNT" -le 2 ]; then
        echo "[INFO] Only $VERSION_COUNT versions found."
        echo "[INFO] Nothing to delete."
        continue
    fi

    echo ""
    echo "[INFO] All Published Versions:"
    echo "$VERSIONS"

    KEEP=$(echo "$VERSIONS" | tail -2)

    echo ""
    echo "[INFO] Versions To Keep:"
    echo "$KEEP"

    DELETE_COUNT=0
    KEEP_COUNT=0

    echo ""
    echo "[STEP 3] Evaluating versions..."

    for VERSION in $VERSIONS
    do
        if echo "$KEEP" | grep -qx "$VERSION"; then
            echo "[KEEP] Version $VERSION"
            KEEP_COUNT=$((KEEP_COUNT + 1))
        else
            echo "[DELETE] Version $VERSION"
            DELETE_COUNT=$((DELETE_COUNT + 1))
        fi
    done

    TOTAL_DELETE_COUNT=$((TOTAL_DELETE_COUNT + DELETE_COUNT))
    TOTAL_KEEP_COUNT=$((TOTAL_KEEP_COUNT + KEEP_COUNT))

    echo ""
    echo "Summary: $FUNCTION_NAME"
    echo "----------------------------------------------------------"
    echo "Total Versions : $VERSION_COUNT"
    echo "Keep           : $KEEP_COUNT"
    echo "Delete         : $DELETE_COUNT"
    echo "----------------------------------------------------------"
done

echo ""
echo "=========================================================="
echo "OVERALL SUMMARY"
echo "=========================================================="
echo "Functions Processed : $FUNCTION_COUNT"
echo "Versions Found      : $TOTAL_VERSION_COUNT"
echo "Versions To Keep    : $TOTAL_KEEP_COUNT"
echo "Versions To Delete  : $TOTAL_DELETE_COUNT"
echo "Finished At         : $(date)"
echo "=========================================================="
echo ""
echo "DRY RUN ONLY - NO VERSIONS WERE DELETED"
echo "=========================================================="