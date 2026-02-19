# MyVitalRx SSO - API Endpoints Reference

Base URL (local): `http://localhost:3000/dev`  
Base URL (deployed): `https://your-api-id.execute-api.region.amazonaws.com/dev`

---

## 1. Health Check

**Endpoint:** `GET /health`

**Description:** Returns service health status. No authentication required.

**Request:**
```
GET /dev/health
```

**Headers:** None required

**Query Parameters:** None

**Request Payload:** None (GET request)

**Example (cURL):**
```bash
curl -X GET "http://localhost:3000/dev/health"
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "service": "myvitalrx-sso",
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

---

## 2. SSO Launch

**Endpoint:** `GET /sso/launch`

**Description:** Initiates SSO flow. HMS redirects users here with a launch token. Verifies token and redirects user to app with session.

**Request:**
```
GET /dev/sso/launch?launch_token=<JWT>&redirect_uri=<URL>&state=<string>
```

**Headers:** None required

**Query Parameters:**

| Parameter      | Required | Type   | Description                                                                 |
|----------------|----------|--------|-----------------------------------------------------------------------------|
| launch_token   | Yes      | string | JWT signed by HMS with shared `launch_secret` (from registration)           |
| launchToken    | Yes*     | string | Alternative param name (same as launch_token)                               |
| redirect_uri   | No       | string | Where to redirect user after session creation (default: APP_BASE_URL)       |
| redirectUri    | No       | string | Alternative param name                                                     |
| state          | No       | string | CSRF/state preservation value                                              |

**Request Payload:** None (GET request - all params in query string)

**Launch Token JWT Payload (HMS generates - sign with `launch_secret`):**

| Claim       | Required | Accepted Keys   | Description                    |
|-------------|----------|-----------------|--------------------------------|
| clientId    | Yes      | clientId, client_id, aud | HMS client_id from registration |
| sub         | Yes      | sub             | User ID in HMS                 |
| hmsId       | Yes      | hmsId, hms_id   | Hospital/system identifier     |
| email, name | No       | -               | User details                   |
| permissions, roles | No | -         | Access scopes                  |
| iat, exp    | Yes      | -               | JWT issued/expiry (max 5 min)  |

```json
{
  "sub": "user-123",
  "hmsId": "hospital-abc-123",
  "clientId": "a1b2c3d4e5f6...",
  "email": "doctor@hospital.com",
  "name": "Dr. Smith",
  "permissions": ["patients:read", "patients:write"],
  "iat": 1704067200,
  "exp": 1704067500
}
```

*Snake_case variants (`client_id`, `hms_id`) are also accepted.*

**Example (cURL):**
```bash
# Replace <LAUNCH_JWT> with actual JWT signed by HMS
curl -X GET "http://localhost:3000/dev/sso/launch?launch_token=<LAUNCH_JWT>&redirect_uri=https://app.myvitalrx.com&state=xyz"
```

**Example (Browser redirect - HMS does this):**
```
https://localhost:3000/dev/sso/launch?launch_token=eyJhbGciOiJIUzI1NiIs...&redirect_uri=https://app.myvitalrx.com&state=abc123

launch_token=7d709ef3ed28097da0a56afd9a0586b1d355b64b655f9b53b6787c81414f137c&redirect_uri=https://app.myvitalrx.com&state=abc123
```

**Response:** 302 Redirect to `redirect_uri?session_token=<JWT>&sso=true&state=<state>`

---

## 3. HMS Registration

**Endpoint:** `POST /sso/register`

**Description:** Registers a new HMS client. Returns `client_id`, `client_secret`, and `launch_secret` for SSO integration.

**Request:**
```
POST /dev/sso/register
Content-Type: application/json
```

**Headers:**

| Header          | Required | Value             |
|-----------------|----------|-------------------|
| Content-Type    | Yes      | application/json  |

**Request Payload (JSON Body):**

| Field          | Required | Type    | Description                                                                 |
|----------------|----------|---------|-----------------------------------------------------------------------------|
| hmsId          | Yes      | string  | Unique HMS/hospital identifier                                             |
| hms_id         | Yes*     | string  | Alternative (same as hmsId)                                                 |
| hmsName        | No       | string  | Display name (default: hmsId)                                              |
| hms_name       | No       | string  | Alternative                                                                 |
| allowedScopes  | No       | array   | Scopes for API access (default: patients:read, patients:write, prescriptions:read, prescriptions:write) |
| allowed_scopes | No       | array   | Alternative                                                                 |
| redirectUris   | No       | array   | Allowed redirect URIs for OAuth flows                                      |
| redirect_uris  | No       | array   | Alternative                                                                 |
| appBaseUrl     | No       | string  | Base URL for MyVitalRx app                                                  |
| app_base_url   | No       | string  | Alternative                                                                 |

**Example Request Payload:**
```json
{
  "hmsId": "hospital-abc-123",
  "hmsName": "Hospital ABC",
  "allowedScopes": [
    "patients:read",
    "patients:write",
    "prescriptions:read",
    "prescriptions:write"
  ],
  "redirectUris": [
    "https://hms.hospital.com/callback",
    "https://app.myvitalrx.com"
  ],
  "appBaseUrl": "https://app.myvitalrx.com"
}
```

**Minimal Request Payload:**
```json
{
  "hmsId": "hospital-abc-123"
}
```

**Example (cURL):**
```bash
curl -X POST "http://localhost:3000/dev/sso/register" \
  -H "Content-Type: application/json" \
  -d '{
    "hmsId": "hospital-abc-123",
    "hmsName": "Hospital ABC",
    "allowedScopes": ["patients:read", "patients:write", "prescriptions:read", "prescriptions:write"],
    "redirectUris": ["https://app.myvitalrx.com"]
  }'
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "client_id": "a1b2c3d4e5f6789012345678",
    "client_secret": "x9y8z7w6v5u4t3s2r1q0p9o8n7m6l5k4",
    "launch_secret": "secret-for-signing-launch-tokens",
    "hms_id": "hospital-abc-123",
    "hms_name": "Hospital ABC",
    "launch_url": "http://localhost:3000/dev/sso/launch",
    "allowed_scopes": ["patients:read", "patients:write", "prescriptions:read", "prescriptions:write"],
    "message": "Store client_secret and launch_secret securely. They cannot be retrieved again."
  }
}
```

---

## Summary Table

| Endpoint        | Method | Payload Location | Auth Required |
|-----------------|--------|------------------|---------------|
| /health         | GET    | None             | No            |
| /sso/launch     | GET    | Query params     | No (token in URL) |
| /sso/register   | POST   | JSON body        | No            |
