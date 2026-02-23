# AWS Serverless SSO — API Endpoints

Base URL: `https://<api-id>.execute-api.<region>.amazonaws.com/<stage>`  
Local dev: `http://localhost:3001/<stage>`

---

## Table of Contents

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 1 | `GET` | `/auth/login` | None | Redirect to Cognito Hosted UI |
| 2 | `GET` | `/auth/callback` | None | Exchange auth code for tokens |
| 3 | `GET` | `/auth/logout` | None | Revoke tokens + redirect |
| 4 | `POST` | `/auth/refresh` | None | Refresh access token |
| 5 | `GET` | `/api/profile` | Bearer JWT | Get authenticated user profile |
| 6 | `GET` | `/health` | None | Public health check |

---

## 1. Login

### `GET /auth/login`

Redirects the browser to the Cognito Hosted UI. Cognito handles authentication (username/password, Google, SAML, etc.) and then redirects back to `/auth/callback` with an authorization code.

### Request

| Location | Parameter | Type | Required | Description |
|----------|-----------|------|----------|-------------|
| Query | `state` | `string` | No | Opaque value echoed back on callback. Use it to store the page the user originally tried to visit. |
| Query | `identity_provider` | `string` | No | Skip the IdP picker and go directly to a specific provider. Values: `Google`, `Facebook`, `LoginWithAmazon`, `SignInWithApple`, or a SAML provider name. |

**Example Request**
```
GET /auth/login?state=eyJyZWRpcmVjdCI6Ii9kYXNoYm9hcmQifQ==&identity_provider=Google
```

### Response

**302 Found** — Redirects to Cognito Hosted UI. No JSON body.

```
HTTP/1.1 302 Found
Location: https://<cognito-domain>.auth.<region>.amazoncognito.com/login
          ?client_id=<client_id>
          &response_type=code
          &scope=email+openid+profile
          &redirect_uri=https%3A%2F%2Fyourdomain.com%2Fauth%2Fcallback
          &identity_provider=Google
          &state=eyJyZWRpcmVjdCI6Ii9kYXNoYm9hcmQifQ==
```

| Status | Meaning |
|--------|---------|
| `302` | Successful redirect to Cognito |
| `500` | Missing Cognito environment configuration |

---

## 2. Callback

### `GET /auth/callback`

OAuth2 redirect URI. Cognito calls this after the user authenticates. This handler exchanges the one-time authorization `code` for a full set of JWT tokens.

### Request

| Location | Parameter | Type | Required | Description |
|----------|-----------|------|----------|-------------|
| Query | `code` | `string` | Yes* | Single-use authorization code from Cognito. |
| Query | `state` | `string` | No | Echoed back from the original `?state=` value. |
| Query | `error` | `string` | Yes* | Error code when authentication fails (e.g. `access_denied`). |
| Query | `error_description` | `string` | No | Human-readable error description. |

> *Cognito sends either `code` **or** `error` — never both.

**Example — Success**
```
GET /auth/callback?code=6b7a3c1d-xxxx-xxxx-xxxx-xxxxxxxxxxxx&state=eyJyZWRpcmVjdCI6Ii9kYXNoYm9hcmQifQ==
```

**Example — Failure (user cancelled)**
```
GET /auth/callback?error=access_denied&error_description=User+cancelled+the+login
```

### Response

**200 OK — Authentication successful**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Authentication successful",
  "data": {
    "tokens": {
      "idToken": "eyJraWQiOiJxxxxxx...",
      "accessToken": "eyJraWQiOiJxxxxxx...",
      "refreshToken": "eyJjdHkiOiJKV1QiLCJlbmMiOiJBMjU2R0NNIiwiYWxnIjoiUlNBLU9BRVAifQ...",
      "expiresIn": 3600,
      "tokenType": "Bearer"
    },
    "user": {
      "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "email": "user@example.com",
      "emailVerified": true,
      "name": "Jane Doe",
      "givenName": "Jane",
      "familyName": "Doe",
      "username": "janedoe",
      "groups": ["Admins", "Editors"]
    }
  }
}
```

**400 Bad Request — Cognito returned an error**
```json
{
  "success": false,
  "statusCode": 400,
  "error": "access_denied",
  "message": "User cancelled the login"
}
```

**400 Bad Request — Authorization code missing**
```json
{
  "success": false,
  "statusCode": 400,
  "error": "MISSING_CODE",
  "message": "Authorization code not found in query parameters"
}
```

**500 Internal Server Error**
```json
{
  "success": false,
  "statusCode": 500,
  "error": "INTERNAL_SERVER_ERROR",
  "message": "Token exchange failed: ..."
}
```

| Status | Meaning |
|--------|---------|
| `200` | Tokens exchanged successfully |
| `400` | Missing or invalid authorization code |
| `500` | Cognito token endpoint unreachable or misconfigured |

---

## 3. Logout

### `GET /auth/logout`

Performs a full sign-out in two steps:
1. Calls `AdminUserGlobalSignOut` via the AWS SDK to **revoke all tokens** for the user across every device (if `username` is supplied).
2. Redirects the browser to the Cognito Hosted UI logout endpoint to **clear the SSO session cookie**.

### Request

| Location | Parameter | Type | Required | Description |
|----------|-----------|------|----------|-------------|
| Query | `username` | `string` | No | Cognito username (the `cognito:username` claim from the ID token). When omitted, only the Cognito session cookie is cleared; existing access tokens remain valid until they expire. |

**Example Request**
```
GET /auth/logout?username=janedoe
```

### Response

**302 Found** — Redirects to Cognito logout endpoint. No JSON body.

```
HTTP/1.1 302 Found
Location: https://<cognito-domain>.auth.<region>.amazoncognito.com/logout
          ?client_id=<client_id>
          &logout_uri=https%3A%2F%2Fyourdomain.com
```

After Cognito clears its session it redirects the user to the `LOGOUT_REDIRECT_URL` configured in your environment (e.g. your app's home page).

| Status | Meaning |
|--------|---------|
| `302` | Redirect to Cognito logout (always, even if global sign-out fails) |
| `400` | Missing Cognito configuration |
| `500` | Unexpected server error |

---

## 4. Refresh Token

### `POST /auth/refresh`

Exchanges a valid **refresh token** for a fresh **access token** and **ID token**. The refresh token itself is not rotated and remains the same.

### Request

**Headers**
```
Content-Type: application/json
```

**Body**
```json
{
  "refreshToken": "eyJjdHkiOiJKV1QiLCJlbmMiOiJBMjU2R0NNIiwiYWxnIjoiUlNBLU9BRVAifQ..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `refreshToken` | `string` | **Yes** | The refresh token from a previous login. Valid for 30 days by default. |

### Response

**200 OK — Token refreshed**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Access token refreshed successfully",
  "data": {
    "idToken": "eyJraWQiOiJxxxxxx...",
    "accessToken": "eyJraWQiOiJxxxxxx...",
    "expiresIn": 3600,
    "tokenType": "Bearer"
  }
}
```

> **Note:** `refreshToken` is NOT returned — the existing refresh token remains valid.

**400 Bad Request — Body missing or malformed**
```json
{
  "success": false,
  "statusCode": 400,
  "error": "MISSING_BODY",
  "message": "Request body is required"
}
```

```json
{
  "success": false,
  "statusCode": 400,
  "error": "MISSING_REFRESH_TOKEN",
  "message": "refreshToken is required in the request body"
}
```

**401 Unauthorized — Refresh token expired or revoked**
```json
{
  "success": false,
  "statusCode": 401,
  "error": "UNAUTHORIZED",
  "message": "Refresh token is invalid or has expired. Please log in again."
}
```

**500 Internal Server Error**
```json
{
  "success": false,
  "statusCode": 500,
  "error": "INTERNAL_SERVER_ERROR",
  "message": "Token refresh failed"
}
```

| Status | Meaning |
|--------|---------|
| `200` | New tokens issued |
| `400` | Missing or malformed request body |
| `401` | Refresh token is expired, revoked, or invalid |
| `500` | Cognito unreachable or misconfigured |

---

## 5. Get Profile

### `GET /api/profile`

Returns the authenticated user's profile. This endpoint is **protected** by the API Gateway Cognito User Pool Authorizer — the JWT is validated automatically before the Lambda runs.

### Request

**Headers**
```
Authorization: Bearer <access_token>
```

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | **Yes** | `Bearer` + the Cognito access token from login or refresh. |

**Example Request**
```
GET /api/profile
Authorization: Bearer eyJraWQiOiJxxxxxx...
```

### Response

**200 OK — Profile returned**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "User profile retrieved successfully",
  "data": {
    "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "email": "user@example.com",
    "emailVerified": true,
    "name": "Jane Doe",
    "givenName": "Jane",
    "familyName": "Doe",
    "username": "janedoe",
    "groups": ["Admins"]
  }
}
```

**401 Unauthorized — Token missing or invalid**

> API Gateway returns this automatically before the Lambda is called.

```json
{
  "message": "Unauthorized"
}
```

**401 Unauthorized — Token missing in fallback path**
```json
{
  "success": false,
  "statusCode": 401,
  "error": "UNAUTHORIZED",
  "message": "Authorization header missing or malformed"
}
```

**500 Internal Server Error**
```json
{
  "success": false,
  "statusCode": 500,
  "error": "INTERNAL_SERVER_ERROR",
  "message": "Failed to retrieve user profile"
}
```

| Status | Meaning |
|--------|---------|
| `200` | Profile returned |
| `401` | Token absent, malformed, expired, or issued by a different User Pool |
| `500` | Unexpected error fetching user attributes |

---

## 6. Health Check

### `GET /health`

Public endpoint — **no authentication required**. Used by load balancers, CloudWatch Synthetics, and monitoring tools to verify the service is alive.

### Request

No parameters, headers, or body required.

**Example Request**
```
GET /health
```

### Response

**200 OK**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Service is healthy",
  "data": {
    "status": "healthy",
    "timestamp": "2026-02-19T10:30:00.000Z",
    "service": "aws-serverless-sso",
    "version": "1.0.0",
    "region": "us-east-1",
    "stage": "dev"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"healthy" \| "degraded" \| "unhealthy"` | Overall service health |
| `timestamp` | `string` | ISO 8601 UTC time of the check |
| `service` | `string` | Service identifier |
| `version` | `string` | Deployed package version |
| `region` | `string` | AWS region |
| `stage` | `string` | Deployment stage (`dev`, `staging`, `prod`) |

| Status | Meaning |
|--------|---------|
| `200` | Service is reachable and healthy |

---

## Standard Error Response Shape

All error responses share this envelope:

```json
{
  "success": false,
  "statusCode": <number>,
  "error": "<MACHINE_READABLE_CODE>",
  "message": "<human-readable description>"
}
```

### Common Error Codes

| HTTP | `error` field | Cause |
|------|--------------|-------|
| `400` | `MISSING_BODY` | POST body is absent |
| `400` | `INVALID_JSON` | Body is not valid JSON |
| `400` | `MISSING_CODE` | No `code` param on callback |
| `400` | `MISSING_REFRESH_TOKEN` | `refreshToken` field missing |
| `400` | `CONFIG_ERROR` | Missing server-side Cognito config |
| `401` | `UNAUTHORIZED` | Token invalid, expired, or missing |
| `403` | `FORBIDDEN` | Token valid but access not allowed |
| `404` | `NOT_FOUND` | Resource does not exist |
| `500` | `INTERNAL_SERVER_ERROR` | Unexpected server-side failure |

---

## Authentication Flow Summary

```
1.  Client          →  GET /auth/login
2.  Lambda          ←  302 → Cognito Hosted UI
3.  User authenticates in Cognito (or via Google / SAML / etc.)
4.  Cognito         →  GET /auth/callback?code=xxx
5.  Lambda          ←  200 { tokens, user }
6.  Client stores tokens (HttpOnly cookie recommended)

7.  Client          →  GET /api/profile
                        Authorization: Bearer <accessToken>
8.  API Gateway validates JWT via Cognito User Pool Authorizer
9.  Lambda          ←  200 { ...UserProfile }

10. Before token expiry:
    Client          →  POST /auth/refresh  { refreshToken }
    Lambda          ←  200 { idToken, accessToken, expiresIn }

11. Client          →  GET /auth/logout?username=janedoe
12. Lambda calls AdminUserGlobalSignOut (revokes all tokens)
13. Lambda          ←  302 → Cognito logout → LOGOUT_REDIRECT_URL
```
