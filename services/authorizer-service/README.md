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
| `AUTHORIZER_DEBUG` | No | No | Set to `true` or `1` for local debugging: logs validation error message and token claims (iss, aud, token_use) so you can compare with your .env. Do not use in production. |

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

## Local testing (serverless offline)

Run the authorizer locally with an HTTP endpoint that accepts the same event shape as API Gateway:

```bash
# From repo root
pnpm run authorizer-service:offline
# or
cd services/authorizer-service && serverless offline
```

Set env (e.g. in `.env` or export) for the flow you use:
- **New flow:** `COGNITO_USER_POOL_ID`, `EXPECTED_AUDIENCE`, `REGION`
- **Legacy:** `SECRET_MANAGER_NAME`, `USER_TABLE`, optionally `END_USER_MESSAGING_URL`

Then POST the authorizer event to the local endpoint (default base URL is printed on startup, often `http://localhost:3000`):

```bash
# Replace YOUR_JWT_HERE with a real or test JWT
curl -X POST http://localhost:3000/dev/authorize \
  -H "Content-Type: application/json" \
  -d '{"type":"TOKEN","authorizationToken":"Bearer YOUR_JWT_HERE","methodArn":"arn:aws:execute-api:us-east-1:123456789012:abc/dev/GET/fhir/Patient/1"}'
```

Response: `200` with the policy (Allow/Deny) and context in JSON, or `403` on failure.

You can also invoke the Lambda directly without HTTP: `npx serverless invoke local -f authorizer -p events/authorizer-event.sample.json` (see [LOCAL_OAUTH2_TESTING.md](../../docs/services/fhir-gateway/LOCAL_OAUTH2_TESTING.md)).

### Debugging "Token validation failed" (INVALID_TOKEN)

If you get `Token validation failed { code: 'INVALID_TOKEN' }` with a token that works in the web app, enable debug to see the exact reason:

```bash
export AUTHORIZER_DEBUG=true
# then run serverless offline and send the same request
```

The log will show:
- **message** – e.g. `JWT verification failed: jwt expired`, `invalid signature`, `invalid issuer`, `Audience not allowed`, `Token must be access token`
- **expectedIssuer** – what the authorizer expects (from `COGNITO_USER_POOL_ID` + region)
- **expectedAudience** – what the authorizer expects (from `EXPECTED_AUDIENCE`)
- **tokenClaims** – iss, aud, token_use, exp, kid from your token (no secret data)

Common causes:
| Message | Fix |
|--------|-----|
| `jwt expired` | Token has expired; get a fresh access token. |
| `invalid signature` | Token was signed by a different key (e.g. wrong User Pool or wrong app client). Ensure the token is from the same Cognito User Pool and that JWKS can be fetched (region/network). |
| `invalid issuer` | Token `iss` does not match `https://cognito-idp.{region}.amazonaws.com/{userPoolId}`. Check `COGNITO_USER_POOL_ID` and `REGION` in .env. |
| `Audience not allowed` | Token `aud` (or `client_id`) is not in `EXPECTED_AUDIENCE`. Set `EXPECTED_AUDIENCE` to your app client id, or use a token issued for that client. |
| `Token must be access token` | You sent an **ID token**; the authorizer requires an **access token**. Use the access token from the auth response, not the id_token. |
| `Unknown key id` | Token’s `kid` is not in the pool’s JWKS (e.g. wrong pool or JWKS fetch failed). |
