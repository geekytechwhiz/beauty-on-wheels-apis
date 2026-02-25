# CodeBuild IAM for org-vitals seed

When `SEED_META=true`, the build runs `insert-org-vitals.js` to seed SUPPORTED_VITALS metadata into the organization DynamoDB table. The **CodeBuild project role** (e.g. `nvstg-hc-organization-service-codebuild-role`) must be allowed to write to that table.

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
        "arn:aws:dynamodb:us-east-1:YOUR_ACCOUNT_ID:table/organization-table-nvstg",
        "arn:aws:dynamodb:us-east-1:YOUR_ACCOUNT_ID:table/organization-table-stg",
        "arn:aws:dynamodb:us-east-1:YOUR_ACCOUNT_ID:table/organization-table-dev"
      ]
    }
  ]
}
```

Replace `YOUR_ACCOUNT_ID` and add/remove table names per stage (e.g. `organization-table-<stage>`). For a single stage (e.g. nvstg only), use only that table ARN.

## Where to add it

- **AWS Console:** CodeBuild → your project → Edit → Environment → Additional configuration → Service role → (open the role in IAM) → Add permissions → Create inline policy → paste JSON.
- **CloudFormation/Terraform:** Add the above statement to the CodeBuild service role’s policy document.

The table name is resolved from `serverless.yml` (`provider.environment.ORGANIZATION_TABLE`) in the buildspec before running the seed script.
