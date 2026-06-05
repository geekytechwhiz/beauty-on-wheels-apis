# CodeBuild IAM for device list seed

When `SEED_META=true`, the build runs `deviceScripts/device-list/dist/index.js` to seed device list metadata into the device DynamoDB table. The **CodeBuild project role** (e.g. `stg-mvx-device-service-codebuild-role`) must be allowed to write to that table.

## Required policy

Attach an inline policy or managed policy to the CodeBuild service role with:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:YOUR_ACCOUNT_ID:table/device-table-dev",
        "arn:aws:dynamodb:us-east-1:YOUR_ACCOUNT_ID:table/device-table-stg",
        "arn:aws:dynamodb:us-east-1:YOUR_ACCOUNT_ID:table/device-table-prd"
      ]
    }
  ]
}
```

Replace `YOUR_ACCOUNT_ID` and add/remove table names per stage (e.g. `device-table-<stage>`). For a single stage (e.g. stg only), use only that table ARN.

## Where to add it

- **AWS Console:** CodeBuild → your project → Edit → Environment → Additional configuration → Service role → (open the role in IAM) → Add permissions → Create inline policy → paste JSON.
- **CloudFormation/Terraform:** Add the above statement to the CodeBuild service role's policy document.

The table name is resolved from `serverless.yml` (`provider.environment.DEVICE_TABLE`) in the buildspec before running the seed script.
