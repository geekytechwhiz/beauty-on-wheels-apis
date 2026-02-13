# Authorizer Service – Stage Deploy Checklist

## What’s already in place

- **OAuth2 / JWT**: Validation via JWKS (Cognito), `iss`/`aud`/`token_use`/`exp`, scopes and context.
- **SMART on FHIR**: `patient`, `fhirUser`, `encounter` passed through in context when present in the token.
- **Legacy flow**: Cognito + Secrets Manager (pool ID) + DynamoDB user details + session checks + OTP (fire-and-forget) + legacy context (`email`, `userID`, `organizationID`, etc.).
- **Bearer token only**: `Authorization: Bearer <token>` is the only supported auth mechanism in this Lambda.

## Fixes applied for deploy

1. **serverless.yml**
   - `EXPECTED_AUDIENCE` no longer uses invalid fallback syntax; both `EXPECTED_AUDIENCE` and `COGNITO_CLIENT_ID` are passed so the handler can use either (it already prefers `EXPECTED_AUDIENCE` then `COGNITO_CLIENT_ID`).
   - Esbuild `target` set to `node20` to match `provider.runtime: nodejs20.x`.

2. **tsconfig.base.json**
   - `@api-hub/auth` added to `paths` so the workspace resolves the auth lib for typecheck/build.

## What you need for stage

### 1. Environment variables (per stage)

Set before deploy (e.g. in CI or `.env.stg` with serverless-dotenv):

| Variable | Required for “new” flow | Required for legacy | Notes |
|----------|-------------------------|---------------------|--------|
| `COGNITO_USER_POOL_ID` | Yes* | No* | *Legacy can resolve from Secrets Manager.* |
| `EXPECTED_AUDIENCE` or `COGNITO_CLIENT_ID` | Yes** | No** | **At least one for audience check.** |
| `REGION` | No | No | Defaults to `us-east-1`. |
| `SECRET_MANAGER_NAME` | No | Yes (legacy) | Secret name with `USER_POOL_ID`. |
| `USER_TABLE` | No | Yes (legacy) | DynamoDB table name. |
| `END_USER_MESSAGING_URL` | No | Yes*** | ***For OTP; legacy works without but won’t send OTP.** |

Example for **new flow only** (stg):

```bash
export COGNITO_USER_POOL_ID=us-east-1_xxxxx
export EXPECTED_AUDIENCE=your-app-client-id
# optional: export COGNITO_CLIENT_ID=... if you prefer that fallback
npx serverless deploy --stage stg
```

### 2. IAM (recommended for stage)

- **Secrets Manager**: `Resource: '*'` works but is broad. Prefer scoping to the specific secret ARN(s) used in stg.
- **DynamoDB**: `Resource: '*'` is very broad. Prefer `Resource: !GetAtt YourUserTable.Arn` or a pattern like `arn:aws:dynamodb:...:table/user-table-stg*` if the table name is stage-specific.

### 3. Using the authorizer in API Gateway

This deploy only creates the **Lambda**. To protect an API:

1. Deploy: `cd services/authorizer-service && npx serverless deploy --stage stg`
2. Copy the authorizer Lambda ARN from the stack output.
3. In the API Gateway (or the Serverless config of the API that needs auth), set the REST/HTTP API authorizer to that Lambda ARN, type **Token**, identity source `method.request.header.Authorization`.

## What’s missing or optional for “stage today”

| Gap | Status | Suggestion |
|-----|--------|------------|
| **API Key auth** | Not implemented | You said “key or token”. This Lambda only does Bearer token. For API key, either use API Gateway usage plans + API key, or extend this Lambda to accept e.g. `x-api-key` and allow when it matches a configured secret. |
| **SMART scope enforcement** | Not in authorizer | Scopes are passed in context; downstream APIs should enforce (e.g. require `patient/*.read`). Optional: add scope checks in the authorizer for stricter “deny” up front. |
| **Multiple issuers (non-Cognito)** | Cognito-only today | `@api-hub/auth` builds JWKS URL from Cognito. For generic OAuth2/SMART with arbitrary `iss`, you’d need to pass `jwksUrl` or `iss` and resolve JWKS from `iss`/.well-known. |
| **Stage-specific env without .env** | Manual/CI | Use CI env vars, or serverless-dotenv with `.env.stg`, or SSM/Parameter Store and read in Lambda (then only pass SSM param name in serverless). |

## Quick deploy (stage)

```bash
cd services/authorizer-service
export COGNITO_USER_POOL_ID=us-east-1_xxxxx
export EXPECTED_AUDIENCE=your-client-id
npx serverless deploy --stage stg
```

Then attach the reported authorizer Lambda ARN to your API Gateway (Token authorizer, identity source `Authorization`).
