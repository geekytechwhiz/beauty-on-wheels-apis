# CodeBuild: GitHub Packages npm auth

`@myvitalrx/mvrx-resource-registry` is published to GitHub Packages. CodeBuild must inject `NPM_TOKEN` so root `.npmrc` can authenticate.

## 1. Create the secret

Store a GitHub PAT or fine-grained token with `read:packages` (and `repo` if the package repo is private).

```bash
aws secretsmanager create-secret \
  --name codebuild/github-packages-npm-token \
  --description "GitHub Packages read token for CodeBuild npm install" \
  --secret-string '{"token":"ghp_xxxxxxxx"}'
```

To update an existing secret:

```bash
aws secretsmanager put-secret-value \
  --secret-id codebuild/github-packages-npm-token \
  --secret-string '{"token":"ghp_xxxxxxxx"}'
```

## 2. Grant the CodeBuild role

Attach an inline policy to the alert-service CodeBuild service role (e.g. `dev-mvx-alert-service-codebuild-role`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:codebuild/github-packages-npm-token*"
    }
  ]
}
```

Replace `ACCOUNT_ID` and region as needed. Repeat for stg/prd CodeBuild roles if they use separate accounts or roles.

## 3. Buildspec wiring

`buildspec.yml`, `stg-buildspec.yml`, and `prd-buildspec.yml` map the secret JSON key `token` to env var `NPM_TOKEN`:

```yaml
env:
  secrets-manager:
    NPM_TOKEN: codebuild/github-packages-npm-token:token
```

If your secret name or JSON key differs, update the buildspec `secrets-manager` block accordingly.

## 4. Rotate exposed tokens

If a GitHub PAT was previously committed in `.npmrc`, revoke it in GitHub → Settings → Developer settings → Personal access tokens before relying on the new secret.
