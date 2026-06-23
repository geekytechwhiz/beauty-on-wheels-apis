for fn in $(aws lambda list-functions --query 'Functions[].FunctionName' --output text)
do
  count=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/Lambda \
    --metric-name Invocations \
    --dimensions Name=FunctionName,Value=$fn \
    --start-time $(date -u -d "365 days ago" +"%Y-%m-%dT%H:%M:%SZ") \
    --end-time $(date -u +"%Y-%m-%dT%H:%M:%SZ") \
    --period 31536000 \
    --statistics Sum \
    --query 'Datapoints[0].Sum' \
    --output text 2>/dev/null)

  if [[ "$count" == "None" || "$count" == "0" ]]; then
    echo "$fn"
  fi
done