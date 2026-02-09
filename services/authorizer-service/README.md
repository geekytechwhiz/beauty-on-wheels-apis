# Authorizer Service

Lambda Token Authorizer for API Gateway. Supports **new** (OAuth2/SMART) and **legacy** flows so existing consumers keep full functionality (including OTP sending and same context shape).

## Behavior

- **New flow** (when only `COGNITO_USER_POOL_ID` + `EXPECTED_AUDIENCE` are set): Validates JWT via JWKS, `iss`, `aud`, `token_use === "access"`, and expiration. Injects `sub`, `clientId`, `scopes`, `tenantId`, and optional SMART claims. No OTP, no DB.
- **Legacy flow** (when `SECRET_MANAGER_NAME` and `USER_TABLE` are set): Uses cached Secrets Manager for User Pool ID, validates JWT, fetches user details from DynamoDB, validates session (`lastUsedAccount`, `logoutAt`, `tokenUpdatedAt`), sends OTP (fire-and-forget) via `END_USER_MESSAGING_URL`, and injects legacy context (`email`, `phoneNumber`, `userID`, `organizationID`, `userType`, `defaultProfile`, `randomId`) so existing consumers do not break.

## Environment

| Variable | Required (new) | Required (legacy) | Description |
|----------|----------------|-------------------|-------------|
| `COGNITO_USER_POOL_ID` | Yes* | No* | Cognito User Pool ID. *Omitted in legacy when pool ID comes from secrets.* |
| `EXPECTED_AUDIENCE` or `COGNITO_CLIENT_ID` | Yes** | No** | Expected JWT audience. **Optional in legacy (audience not enforced).** |
| `REGION` | No | No | AWS region (default `us-east-1`). |
| `SECRET_MANAGER_NAME` | No | Yes | Secrets Manager secret name (JSON with `USER_POOL_ID`). Cached in memory. |
| `USER_TABLE` | No | Yes | DynamoDB table for user basic details (legacy pk/sk: `USER#<userID>`, `USER_BASIC_DETAILS#<organizationID>`). |
| `END_USER_MESSAGING_URL` | No | Yes*** | Base URL for OTP SMS (e.g. `https://.../dev`). ***Required for OTP; legacy flow works without it but will not send OTP.** |

## Context Injected

- **New:** `sub`, `clientId`, `scopes` (JSON array string), `tenantId`; optional `patient`, `fhirUser`, `encounter`.
- **Legacy (when user details present):** `email`, `phoneNumber`, `userID`, `organizationID`, `userType`, `defaultProfile`, `randomId`, plus new fields when present in token.

## Deploy

**New flow only:**
```bash
export COGNITO_USER_POOL_ID=us-east-1_xxxxx
export EXPECTED_AUDIENCE=your-app-client-id
cd services/authorizer-service && npx serverless deploy --stage dev
```

**Legacy (existing consumers):**
```bash
export SECRET_MANAGER_NAME=DEV_DEMO_SECRETMANAGER
export USER_TABLE=user-table-dev
export END_USER_MESSAGING_URL=https://your-messaging-api.execute-api.region.amazonaws.com/dev
# Optional: COGNITO_USER_POOL_ID and EXPECTED_AUDIENCE to also enforce audience
cd services/authorizer-service && npx serverless deploy --stage dev
```

Use the deployed authorizer ARN in other API Gateway APIs via `authorizer` (type: token, identitySource: `method.request.header.Authorization`).
