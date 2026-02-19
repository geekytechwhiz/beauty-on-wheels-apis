# MyVitalRx SSO Launch - HMS Integration Guide

## Overview

The `/sso/launch` endpoint enables SSO from HMS (Hospital Management System) to MyVitalRx. **No changes required on HMS side** - they simply redirect users to our launch URL with a signed token.

## Flow

```
HMS (User clicks "Open MyVitalRx")
        │
        ▼
HMS generates launch_token (JWT signed with launch_secret)
        │
        ▼
Redirect: GET /sso/launch?launch_token=JWT&redirect_uri=...
        │
        ▼
MyVitalRx verifies token, creates session JWT
        │
        ▼
Redirect user to app with session_token
```

## Step 1: Register HMS

```bash
curl -X POST https://your-api.com/sso/register \
  -H "Content-Type: application/json" \
  -d '{
    "hmsId": "hospital-abc-123",
    "hmsName": "Hospital ABC",
    "allowedScopes": ["patients:read", "patients:write", "prescriptions:read", "prescriptions:write"],
    "redirectUris": ["https://hms.hospital.com/callback"],
    "appBaseUrl": "https://app.myvitalrx.com"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "client_id": "a1b2c3d4...",
    "client_secret": "x9y8z7...",
    "launch_secret": "secret-for-signing-launch-tokens",
    "hms_id": "hospital-abc-123",
    "launch_url": "https://your-api.com/sso/launch",
    "message": "Store client_secret and launch_secret securely."
  }
}
```

## Step 2: HMS Generates Launch Token

HMS creates a JWT with the following payload, signed with `launch_secret`:

```json
{
  "sub": "user-123",
  "hmsId": "hospital-abc-123",
  "clientId": "a1b2c3d4...",
  "email": "doctor@hospital.com",
  "name": "Dr. Smith",
  "roles": ["physician"],
  "permissions": ["patients:read", "patients:write", "prescriptions:read"],
  "iat": 1704067200,
  "exp": 1704067500
}
```

- `sub` (required): User ID in HMS
- `hmsId` (required): Hospital/system identifier
- `clientId` (required): HMS client_id from registration
- `email`, `name`, `roles`, `permissions` (optional)
- `exp`: Token expiry (max 5 minutes from `iat`)

**Example (Node.js):**
```javascript
const jwt = require('jsonwebtoken');

const launchToken = jwt.sign(
  {
    sub: user.id,
    hmsId: 'hospital-abc-123',
    clientId: 'a1b2c3d4...',
    email: user.email,
    name: user.name,
    permissions: ['patients:read', 'patients:write'],
  },
  launchSecret,
  { expiresIn: '5m', algorithm: 'HS256' }
);

const launchUrl = `https://your-api.com/sso/launch?launch_token=${launchToken}`;
```

## Step 3: Redirect User

HMS redirects the user to:

```
https://your-api.com/sso/launch?launch_token=JWT&redirect_uri=https://app.myvitalrx.com&state=xyz
```

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| launch_token | Yes | JWT signed with launch_secret |
| redirect_uri | No | Where to send user after session creation (default: APP_BASE_URL) |
| state | No | Preserve state across redirect |

## Step 4: User Lands in MyVitalRx

User is redirected to:
```
https://app.myvitalrx.com?session_token=JWT&sso=true&state=xyz
```

The `session_token` is a JWT - use it to authenticate API requests:
```
Authorization: Bearer <session_token>
```

## Security

- Launch tokens expire in **5 minutes**
- Use HTTPS only
- Store `launch_secret` in HMS secrets manager
- Session tokens are JWTs with configurable expiry (default 1 hour)

## Error Responses

| Code | Error | Description |
|------|-------|-------------|
| 400 | INVALID_REQUEST | Missing launch_token |
| 401 | INVALID_LAUNCH_TOKEN | Token invalid, expired, or signature mismatch |
| 500 | SERVER_ERROR | Internal error |
