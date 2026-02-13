# Legacy → New Endpoints (3 Microservices)

Mapping of **existing legacy API endpoints** to **new endpoints** after splitting into **Organization**, **User**, and **Device** services.

**Base URL convention:** Each service has its own base (e.g. `{ORG_SERVICE}`, `{USER_SERVICE}`, `{DEVICE_SERVICE}`). Paths below are relative to that base (stage prefix like `/dev` may apply per deployment).

---

## 1. Organization Service

| Legacy endpoint | Method | Legacy request | New endpoint | New request |
|-----------------|--------|----------------|--------------|-------------|
| `/organization-list` | POST | `{ limit: 10 }` | `POST /organization/list` | Body: `limit`, `nextPaginationKey`, filters (e.g. `organizationId`, `status`, `organizationType`, `adminName`) |
| `/organization-details` | GET | `?organizationID=<ORGANIZATION_ID>` | `GET /organization/{organizationId}` | Path: `organizationId`; optional auth for enriched `adminDetails` |
| `/create-update-org` | POST | `{ accountAlias, organizationInfo: {} }` | Create: `POST /organization`<br>Update: `PUT /organization/{organizationId}` | Create: body with org fields (name, organizationType, etc.). Update: path `organizationId` + body (organizationInfo, adminDetails, etc.) |
| `/link-unlink-org` | POST | `{ fromOrg, toOrg, action: 'link' }` | `POST /organization/link-unlink` | Body: `fromOrg`, `toOrg`, `action` (LINK \| UNLINK) |
| `/get-linked-orgs` | POST | `{ organizationId }` | `POST /organization/linked` | Body: `organizationId`, optional `orgType`, `preferredOrgId`, `limit`, `nextPaginationKey` |
| `/set-org-status` | POST | `{ organizationId, status: 'ACTIVE' }` | `POST /organization/status` | Body: `organizationId`, `status` (ACTIVE \| HOLD \| DISABLED) |
| `/role-list` | POST | `{ organizationID }` | **Role API** (external) | `GET {ROLE_API}/org/{organizationId}/roles` or equivalent – not in org-service |
| `/organization-count` | POST | `{}` | `POST /organization/count` | Body: empty or `{}`; returns `total`, `orgType` |

---

## 2. User Service

| Legacy endpoint | Method | Legacy request | New endpoint | New request |
|-----------------|--------|----------------|--------------|-------------|
| `/user-list` | POST | `{ organizationID, limit: 10 }` | `GET /organization/{organizationId}/users` | Path: `organizationId`; query/body: `limit`, `offset`, `nextPaginationKey`, filters (`status`, `userType`, `search`) |
| `/get-user-details` | GET | (no query – current user) | `GET /user` or current-user endpoint | No query; auth token identifies user |
| `/get-user-details` | GET | `?userID=<USER_ID>` | `GET /user/organization/{organizationId}/{userId}` | Path: `organizationId`, `userId`; or `GET /user/{userId}` depending on API design |
| `/invite-handler` | POST | minimal `userInfo` + `organizationId` | `POST /user` | Body: createUser payload (`organizationId`, `userType`, `emailAddress`, `phoneNumber`, `firstName`, `lastName`, role, etc.) |
| `/manage-user-profile` | POST | `{ userId, organizationId, firstName, lastName }` | `PUT /user/{userId}/organization/{organizationId}` or `PATCH /user/{userId}` | Body: profile fields (`firstName`, `lastName`, `emailAddress`, etc.) |
| `/activate-deactivate-user` | POST | `{ action: 'deactivate', userId }` | `POST /user/activate-deactivate` | Body: `action` (ACTIVATE \| DEACTIVATE), `organizationID` (optional from token), `patientUserId` (optional – user to act on) |
| `/organization-user-count` | POST | `{}` | `POST /user/organization-user-count` | Body: optional `organizationId`, `roleId`, `roleName`, `roleType`, `status` |
| `/validate-contacts` | POST | `{ emailAddress, phoneNumber }` | `POST /user/validate-contacts` | Body: `emailAddress`, `phoneNumber` (at least one required) |

---

## 3. Device Service

| Legacy endpoint | Method | Legacy request | New endpoint | New request |
|-----------------|--------|----------------|--------------|-------------|
| `/get-device-list` | POST | `action: 'organization', organizationID` | `POST /devices/search` or `GET /devices/list` | Body: `action: 'organization'`, `organizationID` (or `organizationId`) |
| `/get-device-list` | POST | `action: 'deviceCategory'` | `POST /devices/search` | Body: `action: 'deviceCategory'`, optional `category`, `searchValue`, `countryCode` |
| `/get-device-list` | POST | `action: 'patient', organizationID` | `POST /devices/search` | Body: `action: 'patient'`, `organizationID`, optional `patientUserId` / `userID` |
| `/add-device-recommendation` | POST | `{ patientUserId, devices: [] }` | `POST /devices/recommendations/add` | Body: `patientUserId`, `devices` (array of `{ deviceId, category, name }`), `doctorName`; `userID`/`organizationID` from token or body |
| `/remove-device-recommendation` | POST | (body: e.g. `patientUserId`, `deviceId`) | `POST /devices/recommendations/remove` | Body: `patientUserId`, `deviceId` |

---

## 4. Summary: New Endpoints Only (by service)

### Organization Service
- `POST /organization/list`
- `GET /organization/{organizationId}`
- `POST /organization` (create)
- `PUT /organization/{organizationId}` (update)
- `POST /organization/link-unlink`
- `POST /organization/linked`
- `POST /organization/status`
- `POST /organization/count`
- `GET /organization/{organizationId}/metadata`, `PUT /organization/{organizationId}/metadata`, `GET /organization/metadata`
- `GET /organization/{organizationId}/files`, `POST /organization/{organizationId}/files`
- `GET /health`

### User Service
- `GET /user` (current user)
- `GET /user/organization/{organizationId}/{userId}` (get user in org)
- `POST /user` (create / invite)
- `PUT /user/{userId}/organization/{organizationId}` or update user
- `POST /user/activate-deactivate`
- `POST /user/organization-user-count`
- `POST /user/validate-contacts`
- `GET /organization/{organizationId}/users`
- `GET /user/{userId}/organizations`, `POST /user/organization`, etc.
- `GET /user/{userId}/metadata`, `PUT /user/{userId}/metadata`
- `GET /user/{userId}/files`, `POST /user/{userId}/files`
- `GET /health`

### Device Service
- `POST /devices/register`
- `POST /devices/error-notification`
- `GET /devices/{deviceId}`, `PUT /devices/{deviceId}`, `DELETE /devices/{deviceId}`
- `POST /devices/delete-multiple`
- `GET /devices/list`
- `POST /devices/search`
- `POST /devices/org/manage`
- `POST /devices/recommendations/add`
- `POST /devices/recommendations/remove`
- `POST /devices/global/register`
- `POST /devices/{deviceId}/users/{userId}`, `DELETE /devices/{deviceId}/users/{userId}`, `GET /devices/{deviceId}/users`
- `POST /devices/{deviceId}/organizations/{orgId}`, `DELETE /devices/{deviceId}/organizations/{orgId}`, `GET /devices/{deviceId}/organizations`
- `PUT /devices/{deviceId}/metadata`
- `POST /devices/{deviceId}/files`

### Not in these 3 services (unchanged or external)
- `/role-list` → **Role API** (separate service)
- Login, OTP, forgot-password, reset-password → **Auth/Login**
- Forms, packages, get-info-content → **Unchanged or proxy**
