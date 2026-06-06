#!/bin/bash

AWS_PROFILE="ci-user-rx"
AWS_REGION="us-east-1"

echo "FunctionName,VersionCount" > lambda-version-report.csv

aws lambda list-functions \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --query 'Functions[*].FunctionName' \
  --output text | tr '\t' '\n' | while read FUNCTION_NAME
do

  VERSION_COUNT=$(aws lambda list-versions-by-function \
      --function-name "$FUNCTION_NAME" \
      --profile "$AWS_PROFILE" \
      --region "$AWS_REGION" \
      --query 'length(Versions[?Version!=`$LATEST`])' \
      --output text)

  if [ "$VERSION_COUNT" -gt 2 ]; then
      echo "$FUNCTION_NAME,$VERSION_COUNT" >> lambda-version-report.csv
  fi

done

echo "Report generated: lambda-version-report.csv"