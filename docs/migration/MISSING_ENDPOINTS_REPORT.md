# Endpoint Coverage Report – 3 Services

Scan of **organization-service**, **user-service**, and **device-service** against the expected legacy → new endpoint mapping.  
**Result:** All expected capabilities are implemented. A few paths differ from the “ideal” names; these are noted below.

---

## 1. Organization Service

| Expected | Method | Defined in serverless | Status |
|----------|--------|------------------------|--------|
| POST /organization/list | POST | `path: organization/list`, method: post | ✅ Present |
| GET /organization/{organizationId} | GET | `path: organization/{organizationId}`, method: get | ✅ Present |
| POST /organization (create) | POST | `path: organization`, method: post | ✅ Present |
| PUT /organization/{organizationId} (update) | PUT | `path: organization/{organizationId}`, method: put | ✅ Present |
| POST /organization/link-unlink | POST | `path: organization/link-unlink`, method: post | ✅ Present |
| POST /organization/linked | POST | `path: organization/linked`, method: post | ✅ Present |
| POST /organization/status | POST | `path: organization/status`, method: post | ✅ Present |
| POST /organization/count | POST | `path: organization/count`, method: post | ✅ Present |

**Missing:** None.

---

## 2. User Service

| Expected | Method | Defined in serverless | Status |
|----------|--------|------------------------|--------|
| GET /organization/{organizationId}/users | GET | `path: organization/{organizationId}/users`, method: get | ✅ Present |
| GET /user (current user) | GET | — | ⚠️ **Path difference** (see below) |
| GET /user/organization/{organizationId}/{userId} | GET | `path: user/organization/{organizationId}/{userId}`, method: get | ✅ Present |
| POST /user (invite/create) | POST | `path: user`, method: post | ✅ Present |
| PUT /user/{userId}/organization/{organizationId} (manage profile) | PUT | — | ⚠️ **Path difference** (see below) |
| POST /user/activate-deactivate | POST | `path: user/activate-deactivate`, method: post | ✅ Present |
| POST /user/organization-user-count | POST | `path: user/organization-user-count`, method: post | ✅ Present |
| POST /user/validate-contacts | POST | `path: user/validate-contacts`, method: post | ✅ Present |

**Path differences (not missing, different path):**

1. **Get current user**  
   - Expected: `GET /user` (no path params).  
   - Actual: `GET /user/organization` (no path params; userId/organizationId from token).  
   - Same use case; BFF or client should call `GET /user/organization` for “current user”.

2. **Manage user profile**  
   - Expected: `PUT /user/{userId}/organization/{organizationId}`.  
   - Actual: `PUT /updateUser` (body carries userId, organizationId, profile fields).  
   - Same use case; BFF or client should call `PUT /updateUser` for profile updates.

**Missing:** No capabilities missing; only path naming differs for the two cases above.

---

## 3. Device Service

| Expected | Method | Defined in serverless | Status |
|----------|--------|------------------------|--------|
| POST /devices/search or GET /devices/list | POST / GET | `path: devices/search`, method: post; `path: devices/list`, method: get | ✅ Both present |
| POST /devices/recommendations/add | POST | `path: devices/recommendations/add`, method: post | ✅ Present |
| POST /devices/recommendations/remove | POST | `path: devices/recommendations/remove`, method: post | ✅ Present |

**Missing:** None.

---

## 4. Summary

| Service | Expected endpoints | All present? | Notes |
|---------|--------------------|--------------|--------|
| Organization | 8 | ✅ Yes | — |
| User | 7 (+ 2 path differences) | ✅ Yes | Current user: use `GET /user/organization`. Manage profile: use `PUT /updateUser`. |
| Device | 3 (list/search + add + remove recommendation) | ✅ Yes | — |

**Conclusion:** No expected endpoint is missing. For BFF or frontend, use:

- **Get current user:** `GET /user/organization`
- **Manage user profile:** `PUT /updateUser`

If you want exact paths (`GET /user`, `PUT /user/{userId}/organization/{organizationId}`), add thin routes in the BFF that proxy to these, or add the corresponding routes in user-service.
