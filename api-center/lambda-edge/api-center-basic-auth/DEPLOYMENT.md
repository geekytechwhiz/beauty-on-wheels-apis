# Lambda@Edge Basic Auth Deployment

This secures the CloudFront-hosted React portal with HTTP Basic Auth at `Viewer Request`.

## 1) Create Lambda in us-east-1

- Service: AWS Lambda
- Region: `us-east-1` (required for Lambda@Edge)
- Runtime: Node.js 18
- Function name: `api-center-basic-auth`
- Paste code from `index.js` in this folder

## 2) Deploy and publish a version

- Click **Deploy**
- Open **Actions -> Publish new version**
- Use the published version ARN (never attach `$LATEST`)

## 3) Attach to CloudFront

- Open CloudFront distribution for the portal
- Go to **Behaviors**
- Edit default behavior
- Under **Lambda function associations** add:
  - Event type: `Viewer Request`
  - Lambda function: `api-center-basic-auth`
  - Version: published version (for example `:1`)
- Save behavior

## 4) Wait for propagation

- CloudFront global propagation takes ~5-10 minutes

## 5) Validate

1. Open CloudFront URL -> browser prompts credentials
2. Wrong credentials -> `401 Unauthorized`
3. Valid credentials -> app loads normally
4. S3 direct URL -> still denied (bucket private + OAC)

## Notes

- Credentials are hardcoded by design for Lambda@Edge compatibility.
- Rotate credentials periodically and avoid long-lived shared passwords.
- Recommended upgrade path: Cognito or SSO with role-based authorization.
