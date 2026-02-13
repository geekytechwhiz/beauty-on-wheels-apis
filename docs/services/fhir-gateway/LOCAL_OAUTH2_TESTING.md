# Testing OAuth2 / FHIR API Locally

Ways to test the OAuth2-protected FHIR API and the authorizer locally.

---

## 1. Run FHIR gateway offline (easiest)

Run the FHIR API locally and call it with a Bearer token. With a local-dev flag, scope and tenant checks are relaxed so you don’t need a real JWT or authorizer.

### Start the gateway

From repo root:

```bash
cd services/fhir-gateway
FHIR_GATEWAY_LOCAL_DEV=true pnpm run offline
```

Or:

```bash
FHIR_GATEWAY_LOCAL_DEV=true npx serverless offline --stage dev
```

Default is often **http://localhost:3000** (check the serverless-offline log for the exact URL and path prefix, e.g. `/dev`).

### Call the endpoints

Use any non-empty Bearer token when `FHIR_GATEWAY_LOCAL_DEV=true` (scope and tenant checks are bypassed for local testing):

```bash
# Patient read
curl -s -H "Authorization: Bearer local-test-token" \
  "http://localhost:3000/dev/fhir/Patient/test-patient-123"

# Observation search (by patient)
curl -s -H "Authorization: Bearer local-test-token" \
  "http://localhost:3000/dev/fhir/Observation?patient=test-patient-123"

# Metadata (no auth required in current setup)
curl -s "http://localhost:3000/dev/fhir/metadata"
```

If your serverless-offline uses a different base path (e.g. no `/dev`), use the path printed when the server starts.

**Important:** Set `FHIR_GATEWAY_LOCAL_DEV=true` only for local runs. Do not use it in deployed environments.

---

## 2. Invoke the authorizer Lambda locally

Test the authorizer in isolation with a real or test JWT.

### Prerequisites

- **Option A – Real JWT from Cognito:** Get an access token from your Cognito User Pool (e.g. via AWS CLI `aws cognito-idp initiate-auth`, or your app’s login).
- **Option B – Test JWT:** Use a minimal signed JWT for the same User Pool (e.g. from a small script or https://jwt.io) with correct `iss`, `aud`, `kid` and signing key so JWKS validation passes.

### Set env and invoke

```bash
cd services/authorizer-service

# Required for new flow
export COGNITO_USER_POOL_ID=us-east-1_xxxxx
export EXPECTED_AUDIENCE=your-client-id
export REGION=us-east-1

# Put your JWT in the event (replace YOUR_JWT_HERE)
npx serverless invoke local -f authorizer \
  --data '{"authorizationToken":"Bearer YOUR_JWT_HERE","methodArn":"arn:aws:execute-api:us-east-1:123456789012:abc/dev/GET/fhir/Patient/1"}'
```

Or use the sample event file (after replacing the token in the file):

```bash
export COGNITO_USER_POOL_ID=us-east-1_xxxxx
export EXPECTED_AUDIENCE=your-client-id
npx serverless invoke local -f authorizer -p events/authorizer-event.sample.json
```

A successful response will include `policyDocument` with `Effect: Allow` and `context` with `sub`, `clientId`, `scopes`, `tenantId`, etc.

---

## 3. End-to-end with a real JWT (Cognito)

For the closest match to production:

1. Get an access token from Cognito (e.g. `initiate-auth` with `USER_PASSWORD_AUTH` or your app login).
2. Run the authorizer locally (step 2) with that token to confirm it returns Allow and the expected context.
3. Deploy the FHIR gateway and authorizer to a dev stage, attach the authorizer to the API, and call the API with the same token in the `Authorization` header.

Local serverless-offline does not run API Gateway, so the authorizer is not in the request path when you use “FHIR gateway offline” alone. Steps 1 and 2 are for local testing of the gateway and authorizer separately; step 3 is for full request-path testing.

---

## Summary

| Goal                         | Command / approach                                                                 |
|-----------------------------|-------------------------------------------------------------------------------------|
| Hit FHIR API locally        | `FHIR_GATEWAY_LOCAL_DEV=true pnpm run offline` in `services/fhir-gateway`, then curl with `Authorization: Bearer <any>` |
| Test authorizer only       | `serverless invoke local -f authorizer` with event containing `Bearer <JWT>`       |
| Full flow with real token   | Get Cognito token → test authorizer locally → deploy and call API with that token  |
