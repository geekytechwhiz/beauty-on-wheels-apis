# Organization, User & Device Microservice – API Endpoints Reference

This document lists all API endpoints expected by the frontend for **organization**, **users**, and **device** domains after migration to the microservice. It is derived from components, hooks, services, and related files.

**Base URL (main REST API):** `process.env['NX_PUBLIC_REST_API_BASE_URL']`  
**Role Permission API (separate):** `process.env['NX_PUBLIC_ROLE_PERMISSION_API_BASE_URL']`

---

## 1. ORGANIZATION ENDPOINTS

### 1.1 POST `/organization-list`

**Purpose:** List organizations with optional pagination.

**Source files:**
- `libs/x-apis/src/lib/services/Organization/Organization.api.ts` (getOrganizations)
- `libs/x-apis/src/lib/hooks/useOrganization/useOrganization.ts` (fetchTotalOrganizations, fetchOrganizations, useFetchAllOrganizationsQuery via RTK)

**Request payload:**
```ts
OrganizationRequest = {
  organizationId?: string;
  nextPaginationKey?: string;
  [x: string]: any;  // e.g. limit, filters
}
```

**Response (expected):**
```ts
{
  data: {
    data: { items: Organization[] };  // or data.items
    success: boolean;
    statusCode: number;
    nextPaginationKey?: string | null;
  };
  lastEvaluatedKey?: string | null;  // used in some callers
}
```

**Organization type (item):**
```ts
{
  createdDate: number;
  organizationID: string;
  sk: string;
  sk1: string;
  modifiedDate: number;
  address: Address;
  pk: string;
  organizationInfo?: {
    name?: string;
    address: { country?: string; state?: string; city?: string; };
  };
}
```

**Address:** `{ country, state, city, line2, line1, postalCode }`

---

### 1.2 GET `/organization-details?organizationID={id}`

**Purpose:** Get single organization details.

**Source files:**
- `libs/x-apis/src/lib/services/Organization/Organization.api.ts` (getOrganizationDetails)
- `libs/x-apis/src/lib/hooks/useOrganization/useOrganization.ts` (fetchOrganizationDetails, getEditOrganizationData, setupOrganizationSettings)

**Request:** Query param `organizationID` (string).

**Response (expected):**
```ts
{
  data: {
    success?: boolean;
    data: {
      organizationInfo: {
        address: Address;
        name: string;
        hospitalImage: string;
        googleMapsLink: string | null;
        hospitalBio: string;
        website: string;
        organizationID: string;
        emailAddress: string;
        phoneCode: string;
        phoneNumber: string;
        [key: string]: any;
      };
      adminDetails: {
        adminName: string;
        phoneCode: string;
        phoneNumber: string;
        emailAddress: string;
        profilePic: string;
        [key: string]: any;
      };
      status: string;
      [key: string]: any;
    };
  };
}
```

---

### 1.3 POST `/create-update-org`

**Purpose:** Create/update organization, admin, modules, or devices (multi-use).

**Source files:**
- `libs/x-apis/src/lib/services/Organization/Organization.api.ts` (addOrganization, updateOrgPermissions)
- `libs/x-apis/src/lib/hooks/useOrganization/useOrganization.ts` (createOrganization, createAdmin, addModule, addDevicesToOrg)

**Request payload (varies by use case):**

- **Create/update org:**
```ts
{
  accountAlias?: string;
  organizationInfo: AddOrganizationRequest | IUpdateOrganizationInfo;
}
```
- **Create/update admin:**
```ts
{
  accountAlias: string;
  adminDetails: { adminName, phoneNumb?, phoneNumber?, profilePic, emailAddress, namePrefix?, phoneCode? };
  adminId?: string;
}
```
- **Add/update modules:**
```ts
{
  accountAlias: string;
  adminId: string;
  roleId?: string;
  modules: ModuleRequest;  // { [key: string]: { [key: string]: number } }
}
```
- **Update org permissions (role):**
```ts
{
  roleId: string;
  adminId: string;
  accountAlias: string;
  modules: any;
}
```
- **Add devices to org:**
```ts
{
  accountAlias: string;
  roleId: string;
  devices?: any[];
}
```

**AddOrganizationRequest (organizationInfo):**
```ts
{
  organizationType: string;
  organizationName: string;
  organizationAdd: { city, state, country, address, postalCode };
  emailAddress: string;
  phoneNumber: string;
  phoneCode: string;
  website: string;
  googleMapsLink: string;
  hospitalImage: string;
  hospitalBio: string;
  createBranch: boolean;
  organizationSize: string;
  scheduleConf: null;
}
```

**Response (expected):**
- Success: `{ data: { success, message, newOrganizationID?, adminId?, roleId? }, status?: number }`
- Used for alerts and redirects; exact shape varies by operation.

---

### 1.4 POST `/link-unlink-org`

**Purpose:** Link or unlink organizations.

**Source files:**
- `libs/x-apis/src/lib/services/Organization/Organization.api.ts` (linkUnlinkOrg)
- `libs/x-apis/src/lib/hooks/useOrganization/useOrganization.ts` (linkUnlinkOrganization)

**Request payload:** `any` (passed through from callers).

**Response:** Full axios response; success/error handled via response/error.

---

### 1.5 POST `/get-linked-orgs`

**Purpose:** Get linked organizations (e.g. by org type).

**Source files:**
- `libs/x-apis/src/lib/services/Organization/Organization.api.ts` (getLinkedOrgs)
- `libs/x-apis/src/lib/hooks/useOrganization/useOrganization.ts` (getLinkedOrganizations, setupLinkedOrgs)
- `libs/x-apis/src/lib/hooks/usePrescription/usePrescription.ts`
- `libs/x-apis/src/lib/hooks/useMedication/useMedication.ts`
- `libs/x-apis/src/lib/hooks/useCareTeam/useCareTeam.ts`
- `libs/x-apis/src/lib/hooks/useAssignedServiesPackages/useAssignedServicesPackage.ts`

**Request payload:**
```ts
{
  organizationId: string;
  orgType?: 'LAB' | 'PHARMACY' | string;  // used in Prescription
}
```

**Response (expected):**
```ts
{
  data: {
    success: boolean;
    data: {
      items: Array<{
        organizationId: string;
        name: string;
        organizationType: string;
        [key: string]: any;
      }>;
    };
  };
}
```

---

### 1.6 POST `/set-org-status`

**Purpose:** Set organization status (e.g. ACTIVE).

**Source files:**
- `libs/x-apis/src/lib/services/Organization/Organization.api.ts` (updateOrgStatus)
- `libs/x-apis/src/lib/hooks/useOrganization/useOrganization.ts` (setOrgStatusToActive, updateOrganizationStatus)

**Request payload:**
```ts
{
  organizationId: string;
  status: string;  // e.g. 'ACTIVE'
}
```

**Response:** Full response; success/error used for UI.

---

### 1.7 POST `/role-list`

**Purpose:** Get roles/modules for an organization (used in org context).

**Source files:**
- `libs/x-apis/src/lib/services/Organization/Organization.api.ts` (moduleListWithOrgId)
- `libs/x-apis/src/lib/hooks/useOrganization/useOrganization.ts` (getOrganizationRoleListWithID)
- `libs/x-apis/src/lib/services/Roles/Roles.api.ts` (getRoles)

**Request payload:**
```ts
{
  organizationID: string;
}
```

**Response (expected):**
- Organization.api: raw response; list stored in Redux `setOrgRoles(list.data.data)`.
- Roles.api: `RolesApiResponse`: `{ data: Role[], success: boolean, statusCode: number }`.
- **Role:** `{ roleId, roleName, roleType?, createdDate, message?, permissions? }`

---

### 1.8 POST `/get-info-content`

**Purpose:** Fetch info content (onboarding/content).

**Source files:**
- `libs/x-apis/src/lib/services/Organization/Organization.api.ts` (getInfoContent)
- `libs/x-apis/src/lib/hooks/useOrganization/useOrganization.ts` (fetchInfoContent)

**Request payload:** None (POST with empty body or `{}`).

**Response:** Full response; used as-is.

---

### 1.9 POST `/organization-count`

**Purpose:** Get organization count.

**Source files:**
- `libs/x-apis/src/lib/hooks/useOrganization/useOrganization.ts` (getOrganizationCounts)

**Request payload:** `{}`

**Response:** `result?.data` used (exact shape not typed).

---

### 1.10 POST `/list-all-packages`

**Purpose:** List all packages (org/feature context).

**Source files:**
- `libs/x-apis/src/lib/hooks/useOrganization/useOrganization.ts` (getAllPackages)

**Request payload:** `{}`

**Response:** `result?.data` used.

---

### 1.11 POST `/get-forms`

**Purpose:** Get assigned forms/documents for an organization.

**Source files:**
- `libs/x-apis/src/lib/hooks/useOrganization/useOrganization.ts` (setupAssignedAgreementForms) – body: `{ organizationId }`
- `libs/x-apis/src/lib/hooks/useOrganizationForms/useOrganizationForms.ts` (getAssignedForms)
- `libs/x-apis/src/lib/hooks/useDocuments/useDocuments.ts` (listAllForms) – body: `{ organizationId }`

**Request payload:**
```ts
{
  organizationId: string;
  [key: string]: any;  // useOrganizationForms spreads requestBody
}
```

**Response (expected):**
- Status 200; `data.forms` (and optionally `data.documents`) used.
- useOrganization expects `data.forms` as object keyed by formType, with `formType`, `formTitle` etc.
- useDocuments returns `{ documents: response.data.documents, forms: response.data.forms }`.

---

### 1.12 POST `/get-root-forms`

**Purpose:** Get root-level forms (e.g. by organization).

**Source files:**
- `libs/x-apis/src/lib/hooks/useOrganizationForms/useOrganizationForms.ts` (getRootForms)

**Request payload:**
```ts
IGetRootFormsParams = {
  organizationId?: string;
}
```

**Response (expected):** `{ documents, forms }` – see useOrganizationForms.type.ts (DocumentMetadata, FormMetadata).

---

### 1.13 POST `/assign-org-forms`

**Purpose:** Assign forms to an organization.

**Source files:**
- `libs/x-apis/src/lib/hooks/useOrganizationForms/useOrganizationForms.ts` (assignOrgForms)

**Request payload:** `requestBody` (any); spread as `{ ...requestBody }`.

**Response (expected):** `data?.statusCode === 200`; return `data?.data`.

---

## 2. USER ENDPOINTS

### 2.1 POST `/user-list`

**Purpose:** List users (by organization, with optional type and pagination).

**Source files:**
- `libs/x-apis/src/lib/services/Users/Users.api.ts` (getUsers)
- `libs/x-apis/src/lib/services/Organization/Organization.api.ts` (fetchUserListWithOrgId)
- `libs/x-apis/src/lib/services/Patients/Patients.api.ts` (getUsers – patient list context)
- `libs/x-apis/src/lib/hooks/useOrganization/useOrganization.ts` (fetchOrganizationUsers via fetchUserListWithOrgId)
- `libs/x-apis/src/lib/hooks/useScheduler/useScheduler.tsx` (STAFF user lists)

**Request payload:**
```ts
{
  organizationID: string;
  limit: number;
  nextPaginationKey?: string;
  type?: string;  // e.g. 'STAFF'
}
```

**Response (expected):**
```ts
{
  data: {
    data: { items: User[] };
    nextPaginationKey?: string | null;
    success?: boolean;
  };
}
```

**User (item):**
```ts
{
  createdAt?: number;
  emailAddress?: string;
  fullName?: string;
  organizationID?: string;
  phoneNumber?: string;
  profilePic?: string;
  roleID: string;
  roleName: string;
  status?: boolean;
  userID?: string;
  userType?: string;
}
```

**GetUsersApiResponse (normalized):** `{ success: true, data: items, nextPaginationKey }`

---

### 2.2 GET `/get-user-details` (optional query `userID`)

**Purpose:** Get current user details (no params) or a specific user by `userID`.

**Source files:**
- `libs/x-apis/src/lib/hooks/useLogin/useLogin.ts` (getUserDetails – no params; getUser – params.userID)
- `libs/x-apis/src/lib/services/Users/Users.api.ts` (getUserDetails – by id)

**Request:**  
- No body. Query: none (current user) or `userID={id}`.

**Response (expected):**
```ts
{
  success: boolean;
  data?: {
    userID?: string;
    organizationID?: string;
    fullName?: string;
    firstName?: string;
    lastName?: string;
    emailAddress?: string;
    phoneNumber?: string;
    profilePic?: string;
    roleID?: string;
    [key: string]: any;
  };
}
```

---

### 2.3 POST `/invite-handler`

**Purpose:** Invite/create user (staff/patient).

**Source files:**
- `libs/x-apis/src/lib/services/Users/Users.api.ts` (createUser)
- `libs/x-apis/src/lib/hooks/usePatientData/usePatientData.ts` (create patient)

**Request payload:** User create payload; includes `userInfo` (e.g. profilePic, name, email, role, etc.). If profilePic is File, frontend first calls `/get-image-signedUrl` and uploads, then sends picUrl.

**Response (expected):**
```ts
{
  success: boolean;
  message: string;
  [key: string]: any;
}
```

---

### 2.4 POST `/manage-user-profile`

**Purpose:** Create/update user profile (edit user, staff availability, patient profile).

**Source files:**
- `libs/x-apis/src/lib/services/Users/Users.api.ts` (editUseApi, editStaffAvailability)
- `libs/x-apis/src/lib/hooks/usePatientData/usePatientData.ts` (update profile / manage-user-profile)

**Request payload:** Varies; includes fields like `userId`, `organizationId`, `firstName`, `lastName`, `profilePic`, `action?: 'UPLOAD'`, and availability/schedule data when used for staff.

**Response (expected):**
```ts
{
  success: boolean;
  message: string;
  [key: string]: any;
}
```

---

### 2.5 POST `/activate-deactivate-user`

**Purpose:** Activate or deactivate a user.

**Source files:**
- `libs/x-apis/src/lib/services/Users/Users.api.ts` (UpdateUserStatusWithId)

**Request payload:**
```ts
{
  action: string;   // e.g. 'activate' | 'deactivate'
  patientId?: string;
  userId?: string;  // passed in code as first arg
}
```

**Response:** Full response; success/error used for UI.

---

### 2.6 POST `/get-image-signedUrl`

**Purpose:** Get pre-signed URL for image upload (user, org, etc.).

**Source files:**
- `libs/x-apis/src/lib/services/Users/Users.api.ts` (getImageSignedUrl)
- `libs/x-apis/src/lib/hooks/useOrganization/useOrganization.ts` (getImageSignedUrl)
- `libs/x-apis/src/lib/hooks/usePatientData/usePatientData.ts`
- `libs/x-apis/src/lib/hooks/usePrescription/usePrescription.ts`

**Request payload:**
```ts
{
  action: string;   // e.g. 'user', 'hosp'
  userID?: string;
  organizationID?: string;
  fileType?: string;  // prescription
}
```

**Response (expected):**
```ts
{
  signedURL: string;
  picUrl: string;
  [key: string]: any;
}
```

---

### 2.7 POST `/organization-user-count`

**Purpose:** Get user count for organization(s).

**Source files:**
- `libs/x-apis/src/lib/services/Users/Users.api.ts` (getUserCounts)

**Request payload:** `{}`

**Response:** `result?.data` used.

---

### 2.8 POST `/validate-contacts`

**Purpose:** Validate email/phone (e.g. uniqueness).

**Source files:**
- `libs/x-apis/src/lib/services/Users/Users.api.ts` (validateEmailPhone)

**Request payload:**
```ts
{
  emailAddress: string;
  phoneNumber: string;  // phoneCode + phone
}
```

**Response:** `result?.data` used.

---

### 2.9 Login / Auth (user context)

**POST `/login`**  
- **Source:** useLogin (loginUser, otpVerify), useLogin (getOtp when pathName !== 'resetpassword'), errorHandler (token refresh).  
- **Request:**  
  - Login: `LoginData`: `{ emailAddress, password }`.  
  - OTP: `VerifyData`: `{ secretCode, sessionToken }`.  
  - Refresh: `{ refreshToken }`.  
- **Response:** `VerifyResponse`: `{ success, accessToken, refreshToken, updateToken, expiresIn, message, orgStatus, organizationID, statusCode, tokenType, userStatus, error? }`.

**POST `/forgot-password`**  
- **Source:** useLogin (getOtp when pathName === 'resetpassword').  
- **Request:** user identifier (e.g. email).  
- **Response:** includes `sessionToken` for OTP step.

**POST `/create-password`**  
- **Source:** useLogin (createPassword).  
- **Request:** `PasswordData`: `{ key, password, confirmPassword }`.  
- **Response:** `{ success, accessToken? }`.

**POST `/reset-password`**  
- **Source:** useLogin (resetPassword).  
- **Request:** `ResetData`: `{ key, password, resetCode }`.  
- **Response:** standard API response.

---

## 3. DEVICE ENDPOINTS

### 3.1 POST `/get-device-list`

**Purpose:** Get device list by action: organization, patient, recommend, or deviceCategory.

**Source files:**
- `libs/x-apis/src/lib/hooks/useDevices/useDevices.ts` (getDevicesList, getRecommendedDevicesList, getPatientDevices, getCategoryList)
- `libs/x-apis/src/lib/hooks/useDevices/useDevice.ts` (fetchDevices, getCategories)
- `libs/x-apis/src/lib/hooks/useOrganization/useOrganization.ts` (setupDevices – action 'patient')

**Request payload:**
```ts
{
  action: 'organization' | 'patient' | 'recommend' | 'deviceCategory';
  category?: string;
  searchValue?: string;
  organizationID?: string;
  patientUserId?: string;
}
```

**deviceRequest (useDevices.type):**
```ts
{
  category?: string;
  searchValue?: string;
  organizationID?: string;
  patientUserId?: string;
}
```

**Response (expected):**
```ts
{
  data: {
    data: {
      items: any[];  // Device items or category strings (for deviceCategory)
    };
    success?: boolean;
  };
}
```

- For `action: 'deviceCategory'`, `items` is array of category name strings.
- For other actions, `items` is array of device objects (e.g. deviceId, displayName, category, etc.).

---

### 3.2 POST `/add-device-recommendation`

**Purpose:** Add device(s) recommendation to a patient.

**Source files:**
- `libs/x-apis/src/lib/hooks/useDevices/useDevices.ts` (recomendDeviceToPatient)
- `libs/x-apis/src/lib/hooks/useDevices/useDevice.ts` (assignDeviceToSinglePatient)

**Request payload:**
```ts
{
  patientUserId?: string;
  devices: any[];  // array of device objects to recommend
  [key: string]: any;
}
```

**Response (expected):**
```ts
{
  success: boolean;
  message: string;
  [key: string]: any;
}
```

---

### 3.3 POST `/remove-device-recommendation`

**Purpose:** Remove a device recommendation from a patient.

**Source files:**
- `libs/x-apis/src/lib/hooks/useDevices/useDevice.ts` (removeDeviceFromPatient)

**Request payload:**
```ts
{
  deviceId: string;
  patientUserId: string;
}
```

**Response (expected):**
- `response.data.success` and `response.status === 200` used; optional `message`.

---

## 4. ROLES (MAIN REST API – org/user context)

These are under the main REST base URL and used in org/user flows.

### 4.1 POST `/role-list`

- See **1.7 POST `/role-list`** (Organization section).

### 4.2 POST `/new-update-role`

**Purpose:** Create or update role.

**Source files:**
- `libs/x-apis/src/lib/services/Roles/Roles.api.ts` (createRole, editRole)

**Request payload:** `RoleCreateUpdate`: `{ roleId?, roleName?, permissions?, organizationId }`.  
**Response:** `response.data` as `Role` (roleId, roleName, roleType?, createdDate, message?, permissions?).

### 4.3 POST `/transfer-role`

**Purpose:** Transfer role (e.g. reassign users).

**Source files:**
- `libs/x-apis/src/lib/services/Roles/Roles.api.ts` (transferRole)

**Request payload:** `{ fromRoleId: string; toRoleId: string }`.  
**Response:** `response.data`.

### 4.4 DELETE `/{id}` (role delete)

**Purpose:** Delete role by id.

**Source files:**
- `libs/x-apis/src/lib/services/Roles/Roles.api.ts` (deleteRole)

**Request:** DELETE with role id in path.  
**Response:** `response.data`.

### 4.5 GET `/role-permissions-details?name={roleId}`

**Purpose:** Get role permission details.

**Source files:**
- `libs/x-apis/src/lib/services/Roles/Roles.api.ts` (getRoleDetails)

**Request:** Query `name` = roleId.  
**Response:** Full response; used for role details UI.

---

## 5. ROLE PERMISSION API (SEPARATE BASE URL)

Base: `NX_PUBLIC_ROLE_PERMISSION_API_BASE_URL`

**Source file:** `libs/x-apis/src/lib/hooks/useRole/useRole.ts`

### 5.1 GET `/{base}/org/{organizationId}/roles`

**Purpose:** List roles for organization.

**Request:** Path only.  
**Response:** `{ success, data: { items: any[] } }`; stored in Redux `setOrgRoles(data?.data?.items)`.

### 5.2 POST `/{base}/org/{organizationId}/roles`

**Purpose:** Create role.

**Request:** `postBody` (any).  
**Response:** `{ success, message, data? }`.

### 5.3 GET `/{base}/org/{organizationId}/roles/{roleId}/users`

**Purpose:** Get users assigned to a role.

**Request:** Path only.  
**Response:** `data` returned.

### 5.4 POST `/{base}/org/{organizationId}/roles/{roleId}/delete-and-reassign`

**Purpose:** Delete role and reassign users.

**Request:** `postBody` (any).  
**Response:** `{ success, message }`.

---

## 6. USER/ORG-RELATED FORMS & DOCUMENTS

### 6.1 POST `/get-user-forms`

**Source:** `libs/x-apis/src/lib/hooks/useDocuments/useDocuments.ts` (listUserForms), Patients.api (getUserForms).

**Request:** `TGetUserFormPayload` (e.g. organizationId, userId).  
**Response:** `response?.data?.data` (array of forms).

### 6.2 POST `/assign-user-form`

**Source:** `libs/x-apis/src/lib/hooks/useDocuments/useDocuments.ts` (AssignUserForm).

**Request:** `TAssignUserForm`.  
**Response:** `{ success, message }`.

---

## 7. FEATURES (ORG MODULES) – IF PART OF SAME MICROSERVICE

**Source:** `libs/x-apis/src/lib/hooks/useFeatures/useFeatures.ts`

- **GET `/features`** – List all features (getFeatures).
- **GET `/org/{orgId}/features`** – Get assigned features for org (getAssignedFeatures); used in useOrganization setupModules.
- **POST `/org/{orgId}/features`** – Assign features (assignFeatures).

If these are not in the org/user/device microservice, they can be excluded or documented separately.

---

## 8. FILES COVERED (SUMMARY)

| Area           | Files |
|----------------|--------|
| Organization   | Organization.api.ts, useOrganization.ts, useOrganization.type.ts, useOrganizationForms.ts, useOrganizationPackages.ts (list-all-packages, org count) |
| Users          | Users.api.ts, useLogin.ts, useLogin.types.ts, useUsers (useUsers.type.ts), usePatientData (invite, manage-user-profile), useScheduler (user-list) |
| Devices        | useDevices.ts, useDevice.ts, useDevices.type.ts, useOrganization (get-device-list, create-update-org devices) |
| Roles (main)    | Roles.api.ts, useRoles.type.ts |
| Role (perm API)| useRole.ts |
| Auth/Login      | useLogin.ts, response.type.ts, errorHandler.ts |
| Forms/Docs      | useOrganizationForms.ts, useOrganizationForms.type.ts, useDocuments.ts |
| Patients (user-list, get-user-forms) | Patients.api.ts |
| RTK/Base       | baseApi.tsx, apiSlice.ts (injectCrudEndpoints), baseQuery.ts |

---

## 9. RTK QUERY ENDPOINTS (SAME CONTRACTS)

- **Organizations:** `POST /organization-list` – injected as `fetchAllOrganizations` / `useFetchAllOrganizationsQuery`; transform returns `response?.data?.items` filtered by `organizationInfo?.name`.
- **Package list:** `POST /services/get-all-packages` – injected in useOrganizationPackages; not org/user/device core but listed for completeness.

All of the above endpoints should be implemented or proxied in the organization, user, and device microservice so that existing components, hooks, and services continue to work without change.
