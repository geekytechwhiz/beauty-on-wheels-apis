#!/bin/bash

PROFILE="dev"
REGION="ap-south-1"
DAYS=365
OUTPUT_FILE="unused-lambdas.csv"

END_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
START_TIME=$(date -u -d "$DAYS days ago" +"%Y-%m-%dT%H:%M:%SZ")

echo "Region,FunctionName" > "$OUTPUT_FILE"

echo "Checking Lambda functions with no invocations in the last $DAYS days..."
echo "AWS Profile: $PROFILE"
echo "Region: $REGION"

aws lambda list-functions \
    --profile $PROFILE \
    --region $REGION \
    --query 'Functions[].FunctionName' \
    --output text | tr '\t' '\n' | while read FUNCTION_NAME
do
    INVOCATIONS=$(aws cloudwatch get-metric-statistics \
        --profile $PROFILE \
        --region $REGION \
        --namespace AWS/Lambda \
        --metric-name Invocations \
        --dimensions Name=FunctionName,Value=$FUNCTION_NAME \
        --start-time "$START_TIME" \
        --end-time "$END_TIME" \
        --period 86400 \
        --statistics Sum \
        --query 'sum(Datapoints[].Sum)' \
        --output text 2>/dev/null)

    if [[ "$INVOCATIONS" == "None" || "$INVOCATIONS" == "0" ]]; then
        echo "$REGION,$FUNCTION_NAME" | tee -a "$OUTPUT_FILE"
    fi
done

echo ""
echo "Results written to: $OUTPUT_FILE"
