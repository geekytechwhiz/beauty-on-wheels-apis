# @api-hub/authentication-core

Reusable Cognito authentication and RBAC for Beauty on Wheels services.

## JWT validation

- Reads the Bearer token from `Authorization` only.
- Verifies RS256 signature via Cognito JWKS (`kid` rotation supported).
- Caches JWKS PEMs in memory (Lambda warm starts).
- Validates issuer, expiry, user pool, and app client / audience.
- `sub` is the Cognito identity id.
- Access-token `roles`, when present, is an array of `CUSTOMER`, `VENDOR`, and/or `ADMIN`. It is resolved from the identity role mapping at issuance, not from the Cognito `scope` claim.
- Tokens without `roles` remain valid. Callers then keep using the identity directory, including the generic `user` role for accounts that have no explicit application role.
- `roles` must be a string array (or a JSON array string). An object, such as vendor onboarding status, is rejected.

```ts
import { authenticate, authorize, PERMISSION } from '@api-hub/authentication-core';

const ctx = await authenticate(request, { userDirectory });
await authorize(request, { permissions: [PERMISSION.VEHICLE_READ] }, { userDirectory });
```

`AuthContext` is `{ identityId, userId?, roles, permissions, claims }`. Identity comes from the verified JWT `sub`.

## Authorization

JWT → Cognito identity → application user → roles → permissions → allow / deny.

When the access token includes `roles`, those values are the caller's application roles. Otherwise roles still come from the identity directory.

- `401` when the token is missing, malformed, invalid, or expired.
- `403` when the caller is authenticated but lacks the permission or has no application-user mapping.

Resource ownership is not implemented here.

The shared API Gateway Lambda authorizer (`evaluateApiGatewayAuthorizer`) returns an IAM `Allow`/`Deny` policy and a string context of `identityId`, `userId`, `roles`, and `permissions`. Downstream Lambdas hydrate `AuthContext` from `requestContext.authorizer` and do not re-validate the JWT.

## Configuration

```
COGNITO_REGION
COGNITO_USER_POOL_ID
COGNITO_APP_CLIENT_ID
COGNITO_ISSUER
COGNITO_JWKS_URI
DYNAMODB_TABLE_NAME   # identity table for the authorizer directory
```
