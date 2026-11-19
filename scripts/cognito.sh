#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?Set AWS_REGION, e.g. ap-south-1}"
: "${STAGE:?Set STAGE, e.g. production}"
: "${PRE_TOKEN_LAMBDA_ARN:?Set the deployed identity pre-token Lambda ARN}"
: "${COGNITO_FROM_EMAIL:?Set a verified SES From address}"
: "${COGNITO_SES_SOURCE_ARN:?Set the SES identity ARN in the same region}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
PREFIX="beauty-on-wheels-${STAGE}"
SECRET_NAME="beauty-on-wheels/${STAGE}/cognito"

POOL_ID="$(
  aws cognito-idp create-user-pool \
    --region "$AWS_REGION" \
    --pool-name "${PREFIX}-users" \
    --user-pool-tier PLUS \
    --deletion-protection ACTIVE \
    --username-configuration CaseSensitive=false \
    --alias-attributes email phone_number \
    --auto-verified-attributes email \
    --mfa-configuration OPTIONAL \
    --enabled-mfas SOFTWARE_TOKEN_MFA \
    --policies '{
      "PasswordPolicy": {
        "MinimumLength": 14,
        "RequireUppercase": true,
        "RequireLowercase": true,
        "RequireNumbers": true,
        "RequireSymbols": true,
        "TemporaryPasswordValidityDays": 3
      }
    }' \
    --account-recovery-setting '{
      "RecoveryMechanisms": [
        { "Name": "verified_email", "Priority": 1 }
      ]
    }' \
    --verification-message-template '{
      "DefaultEmailOption": "CONFIRM_WITH_CODE",
      "EmailSubject": "Verify your Beauty on Wheels account",
      "EmailMessage": "Your verification code is {####}."
    }' \
    --email-configuration "EmailSendingAccount=DEVELOPER,From=${COGNITO_FROM_EMAIL},SourceArn=${COGNITO_SES_SOURCE_ARN}" \
    --user-pool-add-ons AdvancedSecurityMode=ENFORCED \
    --lambda-config "$(printf \
      '{"PreTokenGenerationConfig":{"LambdaArn":"%s","LambdaVersion":"V2_0"}}' \
      "$PRE_TOKEN_LAMBDA_ARN")" \
    --query 'UserPool.Id' \
    --output text
)"

POOL_ARN="arn:aws:cognito-idp:${AWS_REGION}:${ACCOUNT_ID}:userpool/${POOL_ID}"

# Cognito must be allowed to invoke the V2 token-customization Lambda.
PERMISSION_ID="cognito-pre-token-${STAGE}-${POOL_ID//_/-}"
aws lambda add-permission \
  --region "$AWS_REGION" \
  --function-name "$PRE_TOKEN_LAMBDA_ARN" \
  --statement-id "$PERMISSION_ID" \
  --action lambda:InvokeFunction \
  --principal cognito-idp.amazonaws.com \
  --source-arn "$POOL_ARN"

CLIENT_ID="$(
  aws cognito-idp create-user-pool-client \
    --region "$AWS_REGION" \
    --user-pool-id "$POOL_ID" \
    --client-name "${PREFIX}-identity-api" \
    --generate-secret \
    --prevent-user-existence-errors ENABLED \
    --enable-token-revocation \
    --explicit-auth-flows \
      ALLOW_ADMIN_USER_PASSWORD_AUTH \
      ALLOW_USER_PASSWORD_AUTH \
      ALLOW_REFRESH_TOKEN_AUTH \
    --access-token-validity 15 \
    --id-token-validity 15 \
    --refresh-token-validity 7 \
    --token-validity-units AccessToken=minutes,IdToken=minutes,RefreshToken=days \
    --refresh-token-rotation Feature=DISABLED \
    --supported-identity-providers COGNITO \
    --query 'UserPoolClient.ClientId' \
    --output text
)"

CLIENT_SECRET="$(
  aws cognito-idp describe-user-pool-client \
    --region "$AWS_REGION" \
    --user-pool-id "$POOL_ID" \
    --client-id "$CLIENT_ID" \
    --query 'UserPoolClient.ClientSecret' \
    --output text
)"

aws secretsmanager create-secret \
  --region "$AWS_REGION" \
  --name "$SECRET_NAME" \
  --secret-string "$(printf \
    '{"clientSecret":"%s","userPoolId":"%s","appClientId":"%s","region":"%s"}' \
    "$CLIENT_SECRET" "$POOL_ID" "$CLIENT_ID" "$AWS_REGION")"

printf '\nCognito setup complete.\n'
printf 'COGNITO_REGION=%s\n' "$AWS_REGION"
printf 'COGNITO_USER_POOL_ID=%s\n' "$POOL_ID"
printf 'COGNITO_APP_CLIENT_ID=%s\n' "$CLIENT_ID"
printf 'COGNITO_ISSUER=https://cognito-idp.%s.amazonaws.com/%s\n' "$AWS_REGION" "$POOL_ID"
printf 'Secret name: %s\n' "$SECRET_NAME"