# Legacy → Microservices Integration Plan (Minimal Frontend Changes)

**Senior Technical Architect Review**

This document integrates:

- **Legacy flows:** `ORGANIZATION_REFACTOR_USE_CASES.md`, `USER_USE_CASES_COMMON_USER_DATA.md`, device flows (from `DEVICE_MIGRATION_DOCUMENT.md` / MICROSERVICE doc).
- **Frontend usage:** `MICROSERVICE_API_ENDPOINTS_ORG_USER_DEVICE.md` (web API contracts).

**Goal:** Cover all use cases and flows with **minimal frontend tasks** by routing legacy-shaped APIs through a single integration layer (BFF/API Gateway) that translates to organization-, user-, and device-microservices.

**Document index (quick navigation):**
- **Frontend team:** Section 7 (Minimal task checklist) and Section 3 (endpoint mapping).
- **BFF / backend:** Section 1–2 (approach and use case coverage), Section 3 (mapping), Section 4 (BFF outline), Section 8 (implemented microservice paths).
- **Legacy flows:** `ORGANIZATION_REFACTOR_USE_CASES.md`, `USER_USE_CASES_COMMON_USER_DATA.md`.
- **Frontend API contracts:** `MICROSERVICE_API_ENDPOINTS_ORG_USER_DEVICE.md`.

---

## 1. Recommended Approach: BFF / API Gateway (Zero Frontend Changes)

### 1.1 Strategy

Introduce a **Backend-for-Frontend (BFF)** or **API Gateway** that:

1. Exposes the **same paths and request/response shapes** the frontend already uses (from `MICROSERVICE_API_ENDPOINTS_ORG_USER_DEVICE.md`).
2. Routes each request to the appropriate **microservice** (organization-service, user-service, device-service, role-service).
3. Translates **request** (body/query) and **response** (status, body shape) so the frontend continues to receive the expected `data`, `success`, `items`, `nextPaginationKey`, etc.

**Frontend change:** Only the **base URL** (e.g. `NX_PUBLIC_REST_API_BASE_URL`) points to the BFF/gateway instead of the legacy backend. No code changes in components, hooks, or services.

### 1.2 BFF Responsibilities

| Responsibility | Description |
|----------------|-------------|
| **Route by path** | Map legacy paths (e.g. `POST /organization-list`, `GET /organization-details`) to microservice URLs (e.g. `POST {ORG_SERVICE}/organization/list`, `GET {ORG_SERVICE}/organization/{id}`). |
| **Request mapping** | Map legacy field names and structures to microservice payloads (e.g. `organizationID` → `organizationId`, `accountAlias` → `organizationId`). |
| **Response mapping** | Map microservice responses to legacy shape (e.g. wrap in `{ data: { success, data: { items }, nextPaginationKey } }`, ensure `organizationInfo`, `adminDetails` where expected). |
| **Aggregation** | For endpoints that today read from multiple tables (e.g. get-organization-details = org + permissions + linked orgs), BFF calls multiple microservices and merges into one response. |
| **Auth** | Forward `Authorization` (and optional `X-Correlation-Id`) to microservices; no change for frontend. |

### 1.3 Alternative: Minimal Frontend Changes (No BFF)

If a BFF is not implemented, the frontend team would need to:

1. **Per domain:** Use a different base URL (or path prefix) for organization, user, device, role (e.g. env vars `ORG_API`, `USER_API`, `DEVICE_API`).
2. **Per endpoint:** Change path and optionally request/response handling to match the new microservice API (see Section 3 mapping table).
3. **Response adapters:** Normalize microservice responses to the shapes expected by existing hooks (e.g. `data.data.items`, `nextPaginationKey`).

The mapping table in Section 3 supports both: BFF implements the “Legacy path” column and “Request/Response mapping”; frontend implements the same mapping if no BFF.

---

## 2. Use Case Coverage Summary

### 2.1 Organization (from ORGANIZATION_REFACTOR_USE_CASES)

| Use case | Legacy handler / API | Microservice | Covered by mapping |
|----------|----------------------|--------------|--------------------|
| Create organization | new_update_facility_account_organization / create-update-org | Organization Service | ✅ Section 3.1 |
| Update organization info | new_update (organizationInfo) | Organization Service | ✅ Section 3.1 |
| Get organization details | get_organization_details / organization-details | Organization Service + BFF aggregation | ✅ Section 3.1 |
| List organizations | list_facility_account_organization / organization-list | Organization Service | ✅ Section 3.1 |
| List child organizations | list (organizationId filter) | Organization Service | ✅ Section 3.1 |
| Delete organization | delete_facility_handler / delete | Organization Service | ✅ Section 3.1 |
| Set org status | org_status_update / set-org-status | Organization Service (or dedicated) | ✅ Section 3.1 |
| Link/unlink org | link_unlink_org / link-unlink-org | Organization Service (or link service) | ✅ Section 3.1 |
| Get linked orgs | get_linked_orgs / get-linked-orgs | Organization Service | ✅ Section 3.1 |
| Org modules/devices (update) | new_update (modules, devices) | Role Service / Device Service | ✅ Section 3.1, 3.3 |
| Role list (org context) | role-list | Role Service | ✅ Section 3.4 |
| Organization count | fetch_organization_count / organization-count | Organization or Analytics | ✅ Section 3.1 |
| Get forms / assign forms (org) | get-forms, get-root-forms, assign-org-forms | Forms service (unchanged or proxy) | ✅ Section 3.1 |
| Get info content | get-info-content | Unchanged or proxy | ✅ Section 3.1 |
| List all packages | list-all-packages | Package service (unchanged or proxy) | ✅ Section 3.1 |

### 2.2 User (from USER_USE_CASES_COMMON_USER_DATA)

| Use case | Legacy handler / API | Microservice | Covered by mapping |
|----------|----------------------|--------------|--------------------|
| List users (org) | get_org_user_list, user-list | User Service | ✅ Section 3.2 |
| Get user details | get_user_profile, get-user-details | User Service | ✅ Section 3.2 |
| Invite/create user | invite_handler, signup_login / invite-handler | User Service (createUser) | ✅ Section 3.2 |
| Manage user profile | post_manage_user_profile / manage-user-profile | User Service | ✅ Section 3.2 |
| Activate/deactivate user | activate_deactivate_user / activate-deactivate-user | User Service | ✅ Section 3.2 |
| Login / OTP / forgot-password / create-password / reset-password | login, login_v2, mfa, etc. | Auth/Login service (unchanged or proxy) | ✅ Section 3.2 |
| Get image signed URL | get-image-signedUrl | User or shared asset service | ✅ Section 3.2 |
| Organization user count | organization-user-count | User Service | ✅ Section 3.2 |
| Validate contacts | validate-contacts | User Service | ✅ Section 3.2 |
| Role assign / permissions | role_service, role-permission API | Role Service | ✅ Section 3.4 |
| User forms / assign user form | get-user-forms, assign-user-form | Forms service | ✅ Section 3.2 |

### 2.3 Device (from MICROSERVICE doc Section 3 + device migration)

| Use case | Legacy handler / API | Microservice | Covered by mapping |
|----------|----------------------|--------------|--------------------|
| Get device list (org / patient / recommend / category) | get-device-list | Device Service | ✅ Section 3.3 |
| Add device recommendation | add-device-recommendation | Device Service | ✅ Section 3.3 |
| Remove device recommendation | remove-device-recommendation | Device Service | ✅ Section 3.3 |
| Org devices (add/remove in create-update-org) | new_update (devices) | Device Service | ✅ Section 3.1 / 3.3 |

---

## 3. Endpoint Mapping Table (Legacy → Microservice)

**Convention:** Legacy path and method are what the frontend sends. “Microservice path” is what the BFF (or frontend) calls. “Request/Response mapping” is the transformation to keep frontend contracts unchanged.

### 3.1 Organization Endpoints

| Legacy path (frontend) | Method | Microservice | Microservice path | Request mapping | Response mapping |
|------------------------|--------|--------------|-------------------|-----------------|------------------|
| `/organization-list` | POST | Organization | `POST /organization/list` | Body: `organizationId`→same; `nextPaginationKey`→same; add `status`, `organizationType`, etc. from body. | Map `items`, `nextPaginationKey` to `data.data.items`, `data.nextPaginationKey`; ensure each item has `organizationID`, `organizationInfo`, `pk`, `sk`, `createdDate`, `modifiedDate`, `address` (or nested). |
| `/organization-details` | GET | Organization | `GET /organization/{organizationId}` | Query `organizationID` → path `organizationId`. | Map org profile to `data.data` with `organizationInfo`, `adminDetails`, `status`; if adminDetails/linkedOrgs come from other services, BFF aggregates. |
| `/create-update-org` | POST | Organization (+ Role/Device as needed) | Create: `POST /organization`. Update info: `PUT /organization/{organizationId}`. Admin: User Service. Modules: Role API. Devices: Device Service. | Branch by body: if no `accountAlias`/orgId and has `organizationInfo` → create org (map organizationInfo to org body). If has `accountAlias` + `organizationInfo` only → update org. If `adminDetails` → call User Service (create/update user + assign role). If `modules` → call Role API. If `devices` → call Device Service. | Map each service response to legacy `data.success`, `data.newOrganizationID`, `data.adminId`, `data.roleId` as applicable. |
| `/link-unlink-org` | POST | Organization (or link service) | `POST /organization/link` or internal link API | Body `fromOrg`, `toOrg`, `action` (LINK/UNLINK). | Return legacy success/error shape. |
| `/get-linked-orgs` | POST | Organization | `GET /organization/{organizationId}/linked` or equivalent | Body `organizationId`, `orgType` → query/path. | Map to `data.data.items` with `organizationId`, `name`, `organizationType`. |
| `/set-org-status` | POST | Organization | `PATCH /organization/{organizationId}` (status only) or `PUT /organization/{organizationId}/status` | Body `organizationId`, `status`. | Return legacy success/error. |
| `/role-list` (org context) | POST | Role API | `GET {ROLE_API}/org/{organizationId}/roles` or main API `POST /role-list` | Body `organizationID` → path. | Map to `data.data` (array of roles) with `roleId`, `roleName`, `roleType`, `createdDate`, `permissions`. |
| `/get-info-content` | POST | Unchanged or proxy | Same path on legacy or content service | Pass through. | Pass through. |
| `/organization-count` | POST | Organization or Analytics | `GET /organization/count` or equivalent | — | Map to legacy `data` shape. |
| `/list-all-packages` | POST | Package service | Unchanged or proxy | — | Pass through. |
| `/get-forms` | POST | Forms service | Unchanged or proxy | Body `organizationId`. | Map to `data.forms`, `data.documents`. |
| `/get-root-forms` | POST | Forms service | Unchanged or proxy | Body `organizationId`. | Map to `documents`, `forms`. |
| `/assign-org-forms` | POST | Forms service | Unchanged or proxy | Pass through. | Return legacy success. |

### 3.2 User Endpoints

| Legacy path (frontend) | Method | Microservice | Microservice path | Request mapping | Response mapping |
|------------------------|--------|--------------|-------------------|-----------------|------------------|
| `/user-list` | POST | User Service | `GET /organization/{organizationId}/users` (org-service proxies to user-service) | Body `organizationID`→path; `limit`, `nextPaginationKey`, `type`→query. | Map to `data.data.items` (array of users with `userID`, `organizationID`, `fullName`, `emailAddress`, `phoneNumber`, `profilePic`, `roleID`, `roleName`, `status`, `userType`, `createdAt`); `data.nextPaginationKey`. |
| `/get-user-details` | GET | User Service | `GET /user/organization/{organizationId}/{userId}` or current-user endpoint | Query `userID`; if absent, use token for current user. | Map to `data` with `userID`, `organizationID`, `fullName`, `firstName`, `lastName`, `emailAddress`, `phoneNumber`, `profilePic`, `roleID`, etc. |
| `/invite-handler` | POST | User Service | `POST /user` (createUser) | Map `userInfo`, `userRole`, `organizationID` to createUser body (userId, organizationID, userType, email, name, etc.). | Map to `success`, `message`, optional `invitedUser`. |
| `/manage-user-profile` | POST | User Service | `PUT /user/{userId}` or equivalent | Body `userId`, `organizationId`, profile fields, `action`. | Map to `success`, `message`. |
| `/activate-deactivate-user` | POST | User Service | `PATCH /user/{userId}/status` or equivalent | Body `userId`, `action` (activate/deactivate). | Legacy success/error. |
| `/get-image-signedUrl` | POST | User or asset service | Unchanged or proxy | Body `action`, `userID`, `organizationID`, `fileType`. | Map to `signedURL`, `picUrl`. |
| `/organization-user-count` | POST | User Service | `GET /organization/{organizationId}/users/count` or aggregate from list | — | Map to legacy `data`. |
| `/validate-contacts` | POST | User Service | `POST /user/validate-contact` or equivalent | Body `emailAddress`, `phoneNumber`. | Map to legacy `data`. |
| Login, OTP, forgot-password, create-password, reset-password | POST | Auth/Login | Unchanged (existing auth endpoints) | Pass through. | Pass through. |

### 3.3 Device Endpoints

| Legacy path (frontend) | Method | Microservice | Microservice path | Request mapping | Response mapping |
|------------------------|--------|--------------|-------------------|-----------------|------------------|
| `/get-device-list` | POST | Device Service | `GET /devices?action=...` or `POST /devices/list` | Body `action` (organization|patient|recommend|deviceCategory), `organizationID`, `patientUserId`, `category`, `searchValue` → query or body. | Map to `data.data.items` (devices or categories per action). |
| `/add-device-recommendation` | POST | Device Service | `POST /devices/recommendations` or equivalent | Body `patientUserId`, `devices[]`. | Map to `success`, `message`. |
| `/remove-device-recommendation` | POST | Device Service | `DELETE /devices/recommendations/{id}` or body-based | Body `deviceId`, `patientUserId`. | Map to `success`, `message`. |

### 3.4 Role Endpoints (main REST + Role Permission API)

| Legacy path (frontend) | Method | Microservice | Microservice path | Request mapping | Response mapping |
|------------------------|--------|--------------|-------------------|-----------------|------------------|
| `/role-list` | POST | Role API | `GET {ROLE_API}/org/{organizationId}/roles` | Body `organizationID`. | Map to `data.data` (roles array). |
| `/new-update-role` | POST | Role API | `POST {ROLE_API}/org/{organizationId}/roles` or PUT for update | Body `roleId`, `roleName`, `permissions`, `organizationId`. | Map to `data` (Role). |
| `/transfer-role` | POST | Role API | Role API transfer endpoint | Body `fromRoleId`, `toRoleId`. | Pass through. |
| DELETE `/{id}` (role) | DELETE | Role API | `DELETE {ROLE_API}/org/{organizationId}/roles/{roleId}` | Path id. | Pass through. |
| `/role-permissions-details?name={roleId}` | GET | Role API | `GET {ROLE_API}/org/{organizationId}/roles/{roleId}` or details endpoint | Query `name`=roleId; org from context or query. | Map to legacy role details. |
| Role Permission API base | Various | Role API | `{NX_PUBLIC_ROLE_PERMISSION_API_BASE_URL}` | Same base; paths as in MICROSERVICE doc Section 5. | No change if frontend already uses this base. |

### 3.5 User/Org Forms & Documents

| Legacy path (frontend) | Method | Microservice | Note |
|------------------------|--------|--------------|------|
| `/get-user-forms` | POST | Forms service | Body `organizationId`, `userId`. Return `data.data` (forms array). |
| `/assign-user-form` | POST | Forms service | Pass through; return `success`, `message`. |

---

## 4. BFF Implementation Outline (Minimal Frontend Tasks = Zero)

### 4.1 Single entry point

- Frontend keeps using **one base URL** (e.g. `NX_PUBLIC_REST_API_BASE_URL`).
- BFF listens on same paths as legacy (e.g. `/organization-list`, `/organization-details`, `/user-list`, `/get-device-list`, etc.).

### 4.2 Routing rules (examples)

- Path starts with `/organization-list`, `/organization-details`, `/create-update-org` (org branch), `/link-unlink-org`, `/get-linked-orgs`, `/set-org-status`, `/organization-count` → **Organization Service** (and optionally Role/Device for create-update-org).
- Path `/user-list`, `/get-user-details`, `/invite-handler`, `/manage-user-profile`, `/activate-deactivate-user`, `/organization-user-count`, `/validate-contacts` → **User Service**.
- Path `/get-device-list`, `/add-device-recommendation`, `/remove-device-recommendation` → **Device Service**.
- Path `/role-list`, `/new-update-role`, `/transfer-role`, role delete, `/role-permissions-details` → **Role API**.
- Login, OTP, password, `/get-image-signedUrl`, forms, packages, get-info-content → **unchanged backend or proxy**.

### 4.3 Request/response mapping

- Implement the “Request mapping” and “Response mapping” per row in Section 3 so that existing frontend hooks and types continue to work (e.g. `data.data.items`, `data.organizationInfo`, `data.adminDetails`).

### 4.4 Gaps to implement in microservices (if not already)

- **Organization:** Link/unlink org API; get linked orgs; org count; set org status (if not already PATCH org).
- **User:** Validate contacts; organization user count; activate/deactivate user (if not already).
- **Device:** Full device list (by org, patient, recommend, category); add/remove recommendation APIs.
- **Forms/Packages/Content:** Either proxy to existing services or implement in BFF.

---

## 5. Minimal Frontend Task List (If No BFF)

If the team does **not** implement a BFF, frontend changes are minimized as follows.

### 5.1 Configuration only (best case)

- Point `NX_PUBLIC_REST_API_BASE_URL` to a gateway that already implements the legacy paths (e.g. AWS API Gateway with mapping templates or a small Lambda that does the routing and mapping). **Tasks: 0 code changes; 1 config change.**

### 5.2 One adapter per domain (small change)

- **Organization:** Replace base URL for organization calls with `NX_PUBLIC_ORG_API_BASE_URL`; ensure request body uses `organizationId` where backend expects it; normalize list response to `data.items`, `nextPaginationKey`. **Tasks: 1 env var; 1 adapter or small changes in Organization.api.ts.**
- **User:** Same idea with `NX_PUBLIC_USER_API_BASE_URL`; map invite and profile payloads to new shapes; normalize user list and user details responses. **Tasks: 1 env var; 1 adapter or small changes in Users.api.ts.**
- **Device:** Same with `NX_PUBLIC_DEVICE_API_BASE_URL`; map get-device-list, add/remove recommendation. **Tasks: 1 env var; 1 adapter or small changes in useDevices/useDevice.**
- **Roles:** Already separate base URL for Role Permission API; main REST role-list/new-update-role/transfer/delete can point to same Role API or new path. **Tasks: 0–1 env; minimal path/body changes if any.**

### 5.3 Per-endpoint changes (fallback)

- Use Section 3 as a checklist: for each row, change frontend to call “Microservice path” with “Request mapping” and adapt response with “Response mapping” in the hook or API layer. This maximizes backend flexibility but increases frontend effort.

---

## 6. Summary

| Approach | Frontend tasks | Backend work |
|----------|----------------|--------------|
| **BFF / API Gateway** (recommended) | **Zero** (only base URL config) | Implement BFF that routes and maps all legacy paths to org/user/device/role services. |
| **Per-domain adapter** | Low (1 env + 1 thin adapter per domain) | Microservices expose stable APIs; frontend adapts once per domain. |
| **Per-endpoint change** | Medium (each hook/API call updated) | Microservices only; frontend does all mapping. |

**Use case coverage:** All organization, user, and device flows from the three legacy docs and all frontend endpoints from `MICROSERVICE_API_ENDPOINTS_ORG_USER_DEVICE.md` are mapped in Section 2 and Section 3. Gaps (e.g. link/unlink, org count, device list by action, validate-contacts) are called out in Section 4.4 and can be implemented in the respective microservice or BFF.

**Recommendation:** Implement the **BFF/API Gateway** with the routing and request/response mappings in Section 3 so the frontend team has **zero code changes** and only a single base URL configuration change.

---

## 7. Frontend Team – Minimal Task Checklist

Use this as the single reference for frontend work. All use cases and flows from `ORGANIZATION_REFACTOR_USE_CASES.md`, `USER_USE_CASES_COMMON_USER_DATA.md`, and `MICROSERVICE_API_ENDPOINTS_ORG_USER_DEVICE.md` are covered by the mapping in Section 3.

### 7.1 If BFF/API Gateway is implemented (recommended)

| # | Task | Owner | Done |
|---|------|--------|------|
| 1 | Point `NX_PUBLIC_REST_API_BASE_URL` to the BFF/gateway URL (no code changes). | Frontend / DevOps | ☐ |

**No other frontend tasks.** All legacy paths, request bodies, and response shapes remain as-is; the BFF performs routing and mapping (Section 3).

### 7.2 If BFF is not implemented (minimal frontend changes)

| # | Task | Owner | Done |
|---|------|--------|------|
| 1 | Add env: `NX_PUBLIC_ORG_API_BASE_URL`, `NX_PUBLIC_USER_API_BASE_URL`, `NX_PUBLIC_DEVICE_API_BASE_URL` (or keep single base if gateway routes by path). | Frontend | ☐ |
| 2 | **Organization:** In `Organization.api.ts` (and useOrganization hooks), call org base URL for: organization-list → `POST /organization/list`; organization-details → `GET /organization/{id}`; create-update-org → split to `POST /organization`, `PUT /organization/{id}`; link-unlink-org, get-linked-orgs, set-org-status, organization-count. Map responses to `data.data.items`, `data.organizationInfo`, `data.adminDetails`, `nextPaginationKey` (see Section 3.1). | Frontend | ☐ |
| 3 | **User:** In `Users.api.ts` (and hooks), call user base URL for: user-list → `GET /organization/{organizationId}/users` (query limit, offset, type); get-user-details → `GET /user/organization/{organizationId}/{userId}` or `GET /user/organization`; invite-handler → `POST /user`; manage-user-profile → `PUT /updateUser`; activate-deactivate-user; get-image-signedUrl; organization-user-count; validate-contacts. Map responses to `data.data.items`, `data` user shape (Section 3.2). | Frontend | ☐ |
| 4 | **Device:** In useDevices/useDevice, call device base URL for: get-device-list, add-device-recommendation, remove-device-recommendation. Map to `data.data.items`, `success`, `message` (Section 3.3). | Frontend | ☐ |
| 5 | **Roles:** Keep `NX_PUBLIC_ROLE_PERMISSION_API_BASE_URL`; map main REST role-list, new-update-role, transfer-role, delete role, role-permissions-details to Role API paths (Section 3.4). | Frontend | ☐ |
| 6 | **Auth / Forms / Packages / Content:** Leave login, forgot-password, create-password, reset-password, get-image-signedUrl (if shared), get-forms, get-root-forms, assign-org-forms, get-info-content, list-all-packages on existing backend or proxy (Section 3.1, 3.2, 3.5). | Frontend | ☐ |

### 7.3 Flow coverage verification

- **Organization flows:** Create org, update org info, get details, list/list children, delete, set status, link/unlink, get linked orgs, org count, role-list, forms, packages, info content → Section 2.1 and Section 3.1.
- **User flows:** List org users, get user details, invite/create user, manage profile, activate/deactivate, login/auth, image URL, org user count, validate contacts, role assign, user forms → Section 2.2 and Section 3.2.
- **Device flows:** Get device list (org/patient/recommend/category), add/remove recommendation, org devices in create-update-org → Section 2.3 and Section 3.3.

---

## 8. Implemented Microservice Paths (BFF / Backend Reference)

Exact paths as defined in **organization-service** and **user-service** `serverless.yml`. Use these when implementing the BFF or when frontend calls microservices directly.

### 8.1 Organization Service

| Method | Path | Handler / purpose |
|--------|------|-------------------|
| GET | `/health` | Health check |
| POST | `organization` | Create organization |
| GET | `organization/{organizationId}` | Get organization |
| POST | `organization/list` | List organizations |
| PUT | `organization/{organizationId}` | Update organization |
| DELETE | `organization/{organizationId}` | Delete organization (soft) |
| PUT | `organization/{organizationId}/metadata` | Update org metadata |
| GET | `organization/metadata` | Get org metadata (if defined) |
| GET | `organization/{organizationId}/files` | List org files |

**Note:** Link/unlink, get linked orgs, set org status, organization count may be implemented in the same service under different paths or in separate Lambdas; BFF should route legacy paths to these or to stubs until implemented.

### 8.2 User Service

| Method | Path | Handler / purpose |
|--------|------|-------------------|
| GET | `/health` | Health check |
| POST | `user` | Create user (invite-handler equivalent) |
| GET | `user/organization/{organizationId}/{userId}` | Get user by org + user |
| GET | `user/organization` | Get current user (from token) |
| PUT | `updateUser` | Update user (manage-user-profile equivalent) |
| DELETE | `user/{userId}/organization/{organizationId}` | Remove user from org / delete user |
| POST | `user/{userId}/organization/{organizationId}` | Assign user to organization |
| GET | `user/{userId}/organizations` | List user's organizations |
| PUT | `user/{userId}/metadata` | Update user metadata |
| GET | `user/{userId}/files` | List user files |
| GET | `organization/{organizationId}/users` | List organization users (user-list equivalent) |

**Frontend legacy path mapping:**
- `POST /user-list` with body `organizationID` → BFF calls `GET {USER_SERVICE}/organization/{organizationId}/users` with query `limit`, `offset`, `type`.
- `GET /get-user-details` (no params) → BFF calls `GET {USER_SERVICE}/user/organization` (token).
- `GET /get-user-details?userID=x` → BFF calls `GET {USER_SERVICE}/user/organization/{organizationId}/{userId}` (org from token or context).
- Assign/remove user from org: BFF calls user-service `POST`/`DELETE` `user/{userId}/organization/{organizationId}`; organization-service may proxy these to user-service (see refactor docs).

### 8.3 Device Service

Paths to be confirmed from device-service `serverless.yml` (e.g. `/get-device-list`, `/add-device-recommendation`, `/remove-device-recommendation` or REST-style equivalents). BFF maps legacy POST paths to device-service (Section 3.3).
