for fn in $(aws lambda list-functions \
  --profile ci-user-rx \
  --query 'Functions[].FunctionName' \
  --output text)
do
  count=$(aws cloudwatch get-metric-statistics \
    --profile ci-user\
    --namespace AWS/Lambda \
    --metric-name Invocations \
    --dimensions Name=FunctionName,Value=$fn \
    --start-time $(date -u -v-365d +"%Y-%m-%dT%H:%M:%SZ") \
    --end-time $(date -u +"%Y-%m-%dT%H:%M:%SZ") \
    --period 31536000 \
    --statistics Sum \
    --query 'Datapoints[0].Sum' \
    --output text 2>/dev/null)

  if [[ "$count" == "None" || "$count" == "0" ]]; then
    echo "$fn"
  fi
done