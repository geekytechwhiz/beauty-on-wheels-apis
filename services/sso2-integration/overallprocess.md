# SSO System — HMS ↔ MyVitalRx
## Overall Process, Endpoints, Request & Response Payloads

> **Base URL (Local)**  : `http://localhost:3000/dev`
> **Base URL (AWS Dev)** : `https://<api-id>.execute-api.us-east-1.amazonaws.com/dev`

---

## SSO Flow Overview

```
┌─────────────────────┐         ┌──────────────────────┐         ┌─────────────────────┐
│  HMS                │         │  SSO API (AWS Lambda) │         │  MyVitalRx          │
│  (Hospital Mgmt)    │         │                      │         │  (App)              │
└─────────────────────┘         └──────────────────────┘         └─────────────────────┘
        │                                  │                                │
        │  1. POST /hms/launch             │                                │
        │  (X-HMS-Client-Id + API Key)     │                                │
        │ ─────────────────────────────── ►│                                │
        │ ◄─────────────────────────────── │                                │
        │  { launchToken, launchUrl }       │                                │
        │                                  │                                │
        │  2. Redirect browser to launchUrl ──────────────────────────────► │
        │     ?launch_token=<UUID>          │                                │
        │                                  │                                │
        │                                  │  3. POST /auth/exchange        │
        │                                  │ ◄─────────────────────────────-│
        │                                  │  { launchToken }               │
        │                                  │ ──────────────────────────────►│
        │                                  │  { accessToken, refreshToken } │
        │                                  │                                │
        │                                  │  4. GET /api/patients/{id}     │
        │                                  │     Authorization: Bearer JWT  │
        │                                  │ ◄──────────────────────────────│
        │                                  │ ──────────────────────────────►│
        │                                  │  { patient data }              │
```

---

## Endpoint Index

| # | Method | Endpoint | Auth | Description |
|---|--------|----------|------|-------------|
| 1 | POST | `/dev/admin/hms-clients` | None (Admin) | Register a new HMS organisation |
| 2 | POST | `/dev/hms/launch` | API Key Headers | HMS generates a one-time launch token |
| 3 | POST | `/dev/auth/exchange` | launch_token in body | Exchange launch token → JWT + refresh token |
| 4 | POST | `/dev/auth/refresh` | refresh_token in body | Rotate refresh token → new JWT |
| 5 | POST | `/dev/auth/revoke` | Bearer JWT | Logout / revoke session |
| 6 | GET  | `/dev/api/patients/{patientId}` | Bearer JWT | Get patient profile data |
| 7 | GET  | `/dev/api/patients/{patientId}/health-records` | Bearer JWT | Get patient health records |

---

## Endpoint Details

---

### 1. Register HMS Client (Admin)

> **Must be done first** before HMS can use the SSO system.
> The `apiKey` returned is shown **only once** — store it securely.

```
POST /dev/admin/hms-clients
Content-Type: application/json
```

#### Request Body

```json
{
  "clientId": "HMS-ORG-001",
  "clientName": "City General Hospital",
  "allowedScopes": [
    "read:patient",
    "read:health-records",
    "read:medications",
    "read:lab-results"
  ],
  "allowedRedirectUris": [
    "https://app.myvitalrx.com/launch",
    "http://localhost:3000/launch"
  ]
}
```

#### Available Scopes

| Scope | Description |
|-------|-------------|
| `read:patient` | Read patient profile data |
| `read:health-records` | Read vitals, diagnoses, medications |
| `write:health-records` | Write/update health records |
| `read:medications` | Read medication lists |
| `write:medications` | Write/update medications |
| `read:lab-results` | Read lab test results |

#### Response — `201 Created`

```json
{
  "clientId": "HMS-ORG-001",
  "clientName": "City General Hospital",
  "apiKey": "hms_HMS-ORG-001_a3f8c2d1e9b74a6f3c8d2e1b9a4f7c3d2e8b1a6f4c9d3e2b7a5f1c8d4e6b2a9",
  "allowedScopes": [
    "read:patient",
    "read:health-records",
    "read:medications",
    "read:lab-results"
  ]
}
```

#### Error Responses

| Status | Error Code | Reason |
|--------|------------|--------|
| `400` | `BAD_REQUEST` | Missing / invalid fields or invalid scope names |
| `409` | `CONFLICT` | Client ID already registered |
| `500` | `INTERNAL_SERVER_ERROR` | Unexpected server error |

---

### 2. Generate Launch Token (HMS → SSO)

> Called by HMS backend when a user clicks the **"Open in MyVitalRx"** button.
> HMS must include its `clientId` and `apiKey` in the request headers.

```
POST /dev/hms/launch
Content-Type: application/json
X-HMS-Client-Id: HMS-ORG-001
X-HMS-Api-Key: hms_HMS-ORG-001_a3f8c2d1e9b74a6f...
```

#### Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| `X-HMS-Client-Id` | ✅ Yes | The registered HMS client ID |
| `X-HMS-Api-Key` | ✅ Yes | The API key received during registration |

#### Request Body

```json
{
  "patientContext": {
    "patientId": "patient-001",
    "mrn": "MRN-20240001",
    "firstName": "John",
    "lastName": "Doe",
    "dateOfBirth": "1985-04-12"
  },
  "userContext": {
    "userId": "user-doc-001",
    "username": "dr.mitchell",
    "role": "physician",
    "email": "sarah.mitchell@citygeneral.com"
  },
  "scopes": [
    "read:patient",
    "read:health-records"
  ],
  "redirectUri": "https://app.myvitalrx.com/launch"
}
```

> **Note:** `scopes` is optional. If omitted, defaults to all scopes allowed for this HMS client.

#### User Roles

| Role | Description |
|------|-------------|
| `physician` | Doctor / medical doctor |
| `nurse` | Registered nurse |
| `admin` | Administrative staff |
| `pharmacist` | Pharmacist |
| `lab_technician` | Laboratory technician |

#### Response — `201 Created`

```json
{
  "launchToken": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "launchUrl": "https://app.myvitalrx.com/launch?launch_token=f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "expiresIn": 300,
  "issuedAt": "2024-03-20T10:15:00.000Z"
}
```

> **HMS should redirect the user's browser to `launchUrl`.**
> The launch token expires in **5 minutes** and is **one-time use only**.

#### Error Responses

| Status | Error Code | Reason |
|--------|------------|--------|
| `400` | `BAD_REQUEST` | Missing fields / invalid redirect URI |
| `401` | `UNAUTHORIZED` | Invalid or missing HMS credentials |
| `403` | `FORBIDDEN` | HMS client disabled / unauthorized scopes |
| `500` | `INTERNAL_SERVER_ERROR` | Unexpected server error |

---

### 3. Exchange Launch Token → JWT (MyVitalRx)

> Called by the **MyVitalRx backend** after the user lands on `/launch?launch_token=xxx`.
> Exchanges the one-time launch token for a JWT access token and a refresh token.

```
POST /dev/auth/exchange
Content-Type: application/json
```

#### Request Body

```json
{
  "launchToken": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

#### Response — `200 OK`

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI4ZGE3YzEwYi0zM2NjLTQ1NzItYjU2Ny0xZTAyYjJjM2Q0NzkiLCJpc3MiOiJteXZpdGFscngtc3NvIiwiYXVkIjoibXl2aXRhbHJ4LWFwaSIsImlhdCI6MTcxMDkzMDkwMCwiZXhwIjoxNzEwOTM0NTAwLCJqdGkiOiJhMWIyYzNkNC1lNWY2LTc4OTAtYWJjZC0xMjM0NTY3ODkwYWIiLCJobXNDbGllbnRJZCI6IkhNUy1PUkctMDAxIiwicGF0aWVudElkIjoicGF0aWVudC0wMDEiLCJ1c2VySWQiOiJ1c2VyLWRvYy0wMDEiLCJyb2xlIjoicGh5c2ljaWFuIiwic2NvcGVzIjpbInJlYWQ6cGF0aWVudCIsInJlYWQ6aGVhbHRoLXJlY29yZHMiXX0.signature",
  "refreshToken": "a3f8c2d1e9b74a6f3c8d2e1b9a4f7c3d2e8b1a6f4c9d3e2b7a5f1c8d4e6b2a9f0",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "scopes": [
    "read:patient",
    "read:health-records"
  ],
  "patientContext": {
    "patientId": "patient-001",
    "mrn": "MRN-20240001",
    "firstName": "John",
    "lastName": "Doe",
    "dateOfBirth": "1985-04-12"
  },
  "userContext": {
    "userId": "user-doc-001",
    "username": "dr.mitchell",
    "role": "physician",
    "email": "sarah.mitchell@citygeneral.com"
  }
}
```

> - `accessToken` — JWT valid for **1 hour**. Use in `Authorization: Bearer <token>` header.
> - `refreshToken` — Opaque token valid for **24 hours**. Use to get a new access token.

#### JWT Decoded Payload (for reference)

```json
{
  "sub": "8da7c10b-33cc-4572-b567-1e02b2c3d479",
  "iss": "myvitalrx-sso",
  "aud": "myvitalrx-api",
  "iat": 1710930900,
  "exp": 1710934500,
  "jti": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
  "hmsClientId": "HMS-ORG-001",
  "patientId": "patient-001",
  "userId": "user-doc-001",
  "role": "physician",
  "scopes": ["read:patient", "read:health-records"]
}
```

#### Error Responses

| Status | Error Code | Reason |
|--------|------------|--------|
| `400` | `BAD_REQUEST` | Missing or empty `launchToken` |
| `401` | `UNAUTHORIZED` | Launch token not found / invalid |
| `410` | `GONE` | Launch token already used or expired |
| `500` | `INTERNAL_SERVER_ERROR` | Unexpected server error |

---

### 4. Refresh Token

> Called by MyVitalRx when the `accessToken` has expired (after 1 hour).
> Issues a **new access token** and **rotates the refresh token** (old one is invalidated).

```
POST /dev/auth/refresh
Content-Type: application/json
```

#### Request Body

```json
{
  "refreshToken": "a3f8c2d1e9b74a6f3c8d2e1b9a4f7c3d2e8b1a6f4c9d3e2b7a5f1c8d4e6b2a9f0"
}
```

#### Response — `200 OK`

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.NEW_TOKEN_PAYLOAD.signature",
  "refreshToken": "b4e9d3c2f1a8b7e6d5c4f3a2b1e0d9c8f7a6b5e4d3c2f1a0b9e8d7c6f5a4b3e2",
  "tokenType": "Bearer",
  "expiresIn": 3600
}
```

> ⚠️ **Old `refreshToken` is now invalid. Always store and use the new one.**

#### Error Responses

| Status | Error Code | Reason |
|--------|------------|--------|
| `400` | `BAD_REQUEST` | Missing `refreshToken` field |
| `401` | `UNAUTHORIZED` | Token not found / session revoked / session expired |
| `500` | `INTERNAL_SERVER_ERROR` | Unexpected server error |

---

### 5. Revoke Token (Logout)

> Invalidates the current session. All subsequent API calls with this JWT will be denied
> even if the JWT has not yet expired.

```
POST /dev/auth/revoke
Content-Type: application/json
Authorization: Bearer <accessToken>
```

#### Request Body (Optional)

```json
{
  "sessionId": "8da7c10b-33cc-4572-b567-1e02b2c3d479"
}
```

> If `sessionId` is omitted, the **currently authenticated session** is revoked.

#### Response — `200 OK`

```json
{
  "message": "Session revoked successfully",
  "sessionId": "8da7c10b-33cc-4572-b567-1e02b2c3d479"
}
```

#### Error Responses

| Status | Error Code | Reason |
|--------|------------|--------|
| `401` | `UNAUTHORIZED` | Missing / invalid JWT |
| `500` | `INTERNAL_SERVER_ERROR` | Unexpected server error |

---

### 6. Get Patient Data *(Protected)*

> Returns the patient's profile information.
> **Requires scope:** `read:patient`

```
GET /dev/api/patients/{patientId}
Authorization: Bearer <accessToken>
```

#### Path Parameter

| Parameter | Type | Description |
|-----------|------|-------------|
| `patientId` | string | The patient identifier (e.g. `patient-001`) |

#### Response — `200 OK`

```json
{
  "patient": {
    "patientId": "patient-001",
    "mrn": "MRN-20240001",
    "firstName": "John",
    "lastName": "Doe",
    "dateOfBirth": "1985-04-12",
    "gender": "Male",
    "bloodType": "O+",
    "allergies": ["Penicillin", "Sulfa drugs"],
    "primaryPhysician": "Dr. Sarah Mitchell",
    "insuranceId": "INS-987654",
    "enrolledPrograms": ["Diabetes Management", "Hypertension Care"],
    "lastVisit": "2024-03-15"
  },
  "accessedBy": {
    "userId": "user-doc-001",
    "role": "physician",
    "hmsClientId": "HMS-ORG-001"
  },
  "accessedAt": "2024-03-20T10:16:05.000Z"
}
```

#### Error Responses

| Status | Error Code | Reason |
|--------|------------|--------|
| `401` | `UNAUTHORIZED` | Missing / expired / invalid JWT |
| `403` | `FORBIDDEN` | Missing `read:patient` scope or cross-patient access attempt |
| `404` | `NOT_FOUND` | Patient ID does not exist |
| `500` | `INTERNAL_SERVER_ERROR` | Unexpected server error |

---

### 7. Get Patient Health Records *(Protected)*

> Returns the patient's full health records: vitals, diagnoses, medications, and lab results count.
> **Requires scope:** `read:health-records`

```
GET /dev/api/patients/{patientId}/health-records
Authorization: Bearer <accessToken>
```

#### Path Parameter

| Parameter | Type | Description |
|-----------|------|-------------|
| `patientId` | string | The patient identifier (e.g. `patient-001`) |

#### Response — `200 OK`

```json
{
  "healthRecord": {
    "patientId": "patient-001",
    "lastUpdated": "2024-03-15T10:30:00Z",
    "vitals": [
      {
        "recordedAt": "2024-03-15T10:00:00Z",
        "bloodPressure": "130/85",
        "heartRate": 78,
        "temperature": 98.6,
        "oxygenSaturation": 98,
        "weight": 185
      },
      {
        "recordedAt": "2024-02-10T09:30:00Z",
        "bloodPressure": "128/82",
        "heartRate": 75,
        "temperature": 98.4,
        "oxygenSaturation": 99,
        "weight": 183
      }
    ],
    "diagnoses": [
      {
        "code": "E11.9",
        "description": "Type 2 diabetes mellitus without complications",
        "diagnosedAt": "2020-06-15",
        "status": "chronic"
      },
      {
        "code": "I10",
        "description": "Essential (primary) hypertension",
        "diagnosedAt": "2021-03-20",
        "status": "chronic"
      }
    ],
    "medications": [
      {
        "name": "Metformin",
        "dosage": "500mg",
        "frequency": "Twice daily",
        "prescribedAt": "2020-06-15",
        "prescribedBy": "Dr. Sarah Mitchell",
        "status": "active"
      },
      {
        "name": "Lisinopril",
        "dosage": "10mg",
        "frequency": "Once daily",
        "prescribedAt": "2021-03-20",
        "prescribedBy": "Dr. Sarah Mitchell",
        "status": "active"
      }
    ],
    "labResultsCount": 12
  },
  "accessedBy": {
    "userId": "user-doc-001",
    "role": "physician",
    "hmsClientId": "HMS-ORG-001"
  },
  "accessedAt": "2024-03-20T10:16:10.000Z"
}
```

#### Error Responses

| Status | Error Code | Reason |
|--------|------------|--------|
| `401` | `UNAUTHORIZED` | Missing / expired / invalid JWT |
| `403` | `FORBIDDEN` | Missing `read:health-records` scope or cross-patient access |
| `404` | `NOT_FOUND` | No health records found for patient |
| `500` | `INTERNAL_SERVER_ERROR` | Unexpected server error |

---

## Standard Error Response Shape

All error responses follow this structure:

```json
{
  "error": "ERROR_CODE",
  "message": "Human readable description of what went wrong",
  "requestId": "abc12345-def6-7890-ghij-klmnopqrstuv",
  "timestamp": "2024-03-20T10:16:00.000Z"
}
```

---

## Complete Integration Walkthrough

### Step 1 — Register HMS (one-time setup)

```bash
curl -X POST http://localhost:3000/dev/admin/hms-clients \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "HMS-ORG-001",
    "clientName": "City General Hospital",
    "allowedScopes": ["read:patient", "read:health-records"],
    "allowedRedirectUris": ["http://localhost:3001/launch"]
  }'
```

### Step 2 — HMS Generates a Launch Token

```bash
curl -X POST http://localhost:3000/dev/hms/launch \
  -H "Content-Type: application/json" \
  -H "X-HMS-Client-Id: HMS-ORG-001" \
  -H "X-HMS-Api-Key: hms_HMS-ORG-001_<key-from-step-1>" \
  -d '{
    "patientContext": { "patientId": "patient-001", "mrn": "MRN-20240001" },
    "userContext": { "userId": "user-doc-001", "username": "dr.mitchell", "role": "physician" },
    "scopes": ["read:patient", "read:health-records"],
    "redirectUri": "http://localhost:3001/launch"
  }'
```

### Step 3 — MyVitalRx Exchanges Launch Token for JWT

```bash
curl -X POST http://localhost:3000/dev/auth/exchange \
  -H "Content-Type: application/json" \
  -d '{ "launchToken": "<launchToken-from-step-2>" }'
```

### Step 4 — Call Protected APIs with JWT

```bash
# Get patient data
curl -X GET http://localhost:3000/dev/api/patients/patient-001 \
  -H "Authorization: Bearer <accessToken-from-step-3>"

# Get health records
curl -X GET http://localhost:3000/dev/api/patients/patient-001/health-records \
  -H "Authorization: Bearer <accessToken-from-step-3>"
```

### Step 5 — Refresh When Token Expires

```bash
curl -X POST http://localhost:3000/dev/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{ "refreshToken": "<refreshToken-from-step-3>" }'
```

### Step 6 — Logout (Revoke Session)

```bash
curl -X POST http://localhost:3000/dev/auth/revoke \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## DynamoDB Tables Summary

| Table | Key | TTL | Purpose |
|-------|-----|-----|---------|
| `sso-launch-tokens-dev` | `launchToken` (PK) | 5 min | One-time SSO tokens created by HMS |
| `sso-sessions-dev` | `sessionId` (PK), `refreshToken` (GSI) | 24 hrs | Active JWT sessions |
| `sso-hms-clients-dev` | `clientId` (PK) | None | Registered HMS organisations |

---

## Token Lifetime Summary

| Token | Lifetime | Storage |
|-------|----------|---------|
| Launch Token | 5 minutes, one-time use | DynamoDB (auto-deleted) |
| Access Token (JWT) | 1 hour | Client memory only |
| Refresh Token | 24 hours, rotates on use | Secure client storage |
