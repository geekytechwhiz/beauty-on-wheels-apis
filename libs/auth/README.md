# @api-hub/auth

Reusable auth utilities for the Lambda Authorizer: JWKS cache, scope parser, and token validator. OAuth2 and SMART on FHIR aware; no OTP/MFA or unnecessary I/O.

## Modules

- **jwks-cache** – In-memory JWKS fetch and PEM cache (survives Lambda warm runs).
- **scope-parser** – Parses `scope` string into an array (e.g. `patient/*.read`, `launch/patient`).
- **token-validator** – Verifies JWT with JWKS; validates `iss`, `aud`, `token_use`, `exp`; extracts `sub`, `client_id`, `tenant_id`, scopes, SMART claims.

## Usage

```ts
import { validateAccessToken, getCognitoJwksUrl, parseScopes } from '@api-hub/auth';

const ctx = await validateAccessToken(token, {
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
  region: process.env.REGION!,
  expectedAudience: process.env.EXPECTED_AUDIENCE!,
});
// ctx: { sub, clientId, scopes, tenantId, patient?, fhirUser?, encounter? }
```

## Security

- No security decisions from `jwt.decode`; verification is done with `jwt.verify` and PEM from JWKS.
- Access tokens only (`token_use === 'access'`); ID tokens rejected.
- Tenant required (`custom:tenant_id` or `tenant_id`).
