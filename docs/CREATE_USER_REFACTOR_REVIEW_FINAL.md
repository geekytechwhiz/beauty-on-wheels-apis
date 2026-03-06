# Create User Refactor — Final Behavior Comparison Report

## SECTION 1 — SAFE MATCHES

- **Response contract**: Both return `{ invitedUser: result.userID }`. Field name and shape unchanged.
- **Handler org validation**: New handler uses `getOrganization(organizationID, authHeader)` and same status check (`on_hold`, `disabled`, `not_exist`) with same error codes (`ORGANIZATION_NOT_FOUND`, `ORGANIZATION_NOT_AVAILABLE`).
- **Role resolution in handler**: New handler uses `userRepository.getRolePermissions(roleIds[0], organizationID)` with same SK/match logic (including `item.sk` fallback), sets `definedRoleCode` and `roleName`, and runs the same ADMIN branch (`getOrgFeatures` + `saveRoles`) when `definedRoleCode === 'ADMIN'` and role has no features.
- **friendNFamily / assignDoctor**: New handler passes `body?.userInfo?.friendNFamily` and `body?.userInfo?.assignDoctor` into the service; F&F and doctor processors receive the same inputs when body carries them.
- **Role assignment after create**: Same `assignUserRole(roleIds[0], organizationID, result.userID, userInfo.name, userInfo.contact?.email ?? '', userInfo.contact?.phone ?? '', userInfo.profilePic, authHeader).catch(() => {})` with same arguments.
- **DynamoDB user write**: Same key pattern — `pk: ORG#${organizationID}`, `sk: USER#${userID}` via `UserKeys.orgPk` / `UserKeys.userSk` (equivalent to `ORG#`, `USER#`). Same condition: `attribute_not_exists(pk) AND attribute_not_exists(sk)`.
- **DynamoDB user–org write**: Same key pattern — `pk: USER#${userID}`, `sk: ORG#${organizationID}` via `UserKeys.userPk` / `UserKeys.orgSk`. Unconditional put.
- **Duplicate user error**: `UserRepositoryV2.createUser` maps `ConditionalCheckFailedException` to `UserAlreadyExistsError(user.userID)`, matching old repository behavior.
- **Stored user fields**: New flow sets `invitedBy`, `inviteCode`, `invitedID`, `logoutRequired`, and `definedRoleCode` (when present) on the object passed to `createUser` / `assignUserToOrganization`, matching old user shape.
- **New user ID**: New flow sets `newUserId = (userInfo?.code as string)?.trim() || ulid()` and uses it for Cognito and for the factory/repository, so one ID is used consistently.
- **FnF / doctor processors**: Same logic — `handleFriendFamilyLink` and `handleDoctorAssignment` call the same `FriendFamilyService` / `UserRepository` methods with the same parameters (searchFnf + addMember; getUser + saveDoctorPatientLink + updatePatientReporter).
- **Notification mechanism**: New flow uses `notifyUser` (SNS event `UserCreatedNotificationRequested`) with the same rich template data (ORG_NAME, ORG_INFO, STAFF/FNF/USER-specific fields, notifyPhone, channels) and skips send when `definedRoleCode` is FRIEND or FAMILY; notification failures are caught and logged without failing the request.
- **Validator**: New handler is intended to be wired with the same `validateCreateUser` (and thus same request contract); the new handler file does not export `withLambdaHandler` in the snippet — ensure the entry point still uses the same validator.

---

## SECTION 2 — MISSING LOGIC

### 2.1 Request validator wiring

- **Old**: Handler is exported as `main = withLambdaHandler(handler, { validator: validateCreateUser })`.
- **New**: Handler is exported as a plain `handler`; it does not wrap with `withLambdaHandler` or attach `validateCreateUser`.
- **Effect**: If the Lambda entry point is switched to the new handler without wrapping, request validation (and thus the same request contract) may not run.
- **Fix**: Ensure the create-user Lambda entry still invokes the handler through `withLambdaHandler(handler, { validator: validateCreateUser })`, or export an equivalent `main` from the new handler file that does so.

### 2.2 In-service validation (user type, identifiers, MRN)

- **Old**: `user.service.ts` `createUser` validates: allowed `userType` list (`STAFF`, `USER`, `ADMIN`, `FNF`), STAFF email required, USER/FNF must have email or phone, and for USER ensures MRN exists (generates if missing). It also normalizes legacy aliases (email/phone_number), splits fullName into firstName/lastName, and normalizes phone for Cognito.
- **New**: `CreateUserService` does not run these checks explicitly. It relies on `UserValidationService.validateOrganization` and on request validation (createUserSchema). The schema’s `superRefine` enforces STAFF email and USER/FNF email-or-phone but does not enforce the full allowed userType set; MRN is set inside the factory for patients but there is no explicit “invalid user type” throw.
- **Effect**: Requests with e.g. `userType: 'ADMIN'` or an invalid user type may be accepted by the schema and then routed to the default branch (e.g. patient). Old flow would throw for disallowed user type; new flow may create a patient instead of failing.
- **Fix**: Either add the same validation in the service (allowedUserTypes, STAFF/USER/FNF rules) and throw the same errors, or tighten the request schema so that only allowed user types and identifier rules are accepted (and document that ADMIN is handled like STAFF or explicitly rejected).

### 2.3 Cognito custom attribute `role`

- **Old**: `user.service.ts` passes `customAttributes.role: JSON.stringify(userRoleArray)` to Cognito (user-service’s `cognito.service.createUser`), and the service sets `custom:role`.
- **New**: `CognitoUserService` (service-clients) passes `userType`, `userID`, `organizationID`, `roleName`, `permissions` but does **not** pass `role` in custom attributes.
- **Effect**: Cognito user attributes will not have `custom:role` in the new flow; any downstream use of that attribute will see a behavior change.
- **Fix**: In the service-clients Cognito user creation (or in the create-user flow before calling it), add `role: JSON.stringify(userRoleArray)` (or equivalent) to the Cognito custom attributes if the old behavior is required. Ensure the Cognito service in the path actually writes `custom:role` when provided.

---

## SECTION 3 — POTENTIAL BEHAVIOR CHANGES

### 3.1 roleName when handler provides it

- **Old**: Handler has two blocks that call `getRolePermissions`. The second overwrites `userData.roleName` with `exactRoleMatch?.roleName || ''` (no `definedRoleCode` fallback).
- **New**: Handler has one block and sets `roleName = exactRoleMatch?.roleName || definedRoleCode || ""`.
- **Effect**: When the role record has no `roleName`, old passes `roleName: ''` to the service; new passes `definedRoleCode || ''`. Minor difference in what the service and Cognito receive as roleName.
- **Recommendation**: If strict parity is required, set `roleName = exactRoleMatch?.roleName ?? ""` in the new handler (and keep a single getRolePermissions call).

### 3.2 Phone number stored in DB

- **Old**: Stores `phoneNumber: phoneNumberForDB` where `phoneNumberForDB = rawPhone || ''` and `rawPhone = data.phoneNumber ? String(data.phoneNumber).trim() : ''` (trimmed, no + prefix in DB).
- **New**: Factory uses `normalizePhone(input.phoneNumber)` (trim). Builder passes `userInfo.contact?.phone` (no trim). So the value going into the factory is from builder; factory then trims. So stored value is trimmed. Same as old for typical input. If builder ever passed untrimmed data and factory did not trim, there could be a difference; currently factory trims, so behavior matches.

### 3.3 userType ADMIN

- **Old**: Single `User` object is built with `...data`; `userType` can be ADMIN and is stored as-is.
- **New**: Branching is `roleCode === FRIEND/FAMILY` → FnF, `userType === 'STAFF'` → Staff, else → Patient. So `userType === 'ADMIN'` goes to the default and creates a **Patient** (with `itemType: 'USER'`), not a staff-like user with userType ADMIN.
- **Effect**: ADMIN users would be created as patients in the new flow instead of as staff/admin-style users.
- **Fix**: Add an explicit branch for ADMIN (e.g. treat like STAFF for factory choice) or reject ADMIN in validation if the product only expects STAFF/USER/FNF.

### 3.4 assignUserToOrganization error handling

- **Old**: `user.repository` `assignUserToOrganization` catches errors and logs `user_org_assign_error`, then rethrows.
- **New**: `UserRepositoryV2.assignUserToOrganization` does not wrap the put in try/catch; errors propagate without the same log event.
- **Effect**: Same error propagation, but different logging on failure. Observability may differ.
- **Recommendation**: Add equivalent try/catch and log in `UserRepositoryV2.assignUserToOrganization` if log parity is required.

---

## SECTION 4 — CONTRACT VALIDATION

- **Request**: The new handler reads the same validated payload from `req.validatedCreateUser` (userInfo, userRole, userType, organizationID, userID) and passes `body?.userInfo?.friendNFamily` and `body?.userInfo?.assignDoctor` into the service. So the effective request contract (validated shape + body for F&F/doctor) matches once the same validator is applied (see 2.1).
- **Response**: Unchanged — `{ invitedUser: result.userID }`. No change to field names or casing.

---

## SECTION 5 — DATABASE WRITE VALIDATION

- **Keys and conditions**: Identical. User write: `pk = ORG#${organizationID}`, `sk = USER#${userID}`, condition `attribute_not_exists(pk) AND attribute_not_exists(sk)`. User–org write: `pk = USER#${userID}`, `sk = ORG#${organizationID}`, no condition.
- **Attributes**: The new implementation writes the same logical fields (invitedBy, inviteCode, invitedID, logoutRequired, definedRoleCode when present, plus all factory fields). The exact set of attributes may differ if the factory or builder omit or rename any field that the old `User` type wrote (e.g. optional fields the old code set to defaults). A field-by-field comparison of the old `User` object vs the new factory output + `userForDb` overlay would be needed to guarantee 1:1 attribute parity; the main legacy and key fields are aligned.

---

## SECTION 6 — SIDE EFFECT VALIDATION

| Side effect              | Same as before? | Notes |
|--------------------------|-----------------|--------|
| Cognito user creation    | Mostly          | Same pool, same existence checks, same userID. New path does not set `custom:role` (see 2.3). |
| Role assignment          | Yes             | Same `assignUserRole` call and arguments after create. |
| Friend/Family linking    | Yes             | Same when `body?.userInfo?.friendNFamily` is passed; processor logic matches. |
| Doctor assignment        | Yes             | Same when `body?.userInfo?.assignDoctor` is passed; processor uses same repository methods. |
| Notifications            | Yes             | Same SNS event, same template data and F&F skip; failures logged, not thrown. |

---

## SECTION 7 — FINAL VERDICT

**The refactor is mostly safe but has a few gaps and small risks.**

**Risks to address:**

1. **Validator wiring (2.1)**: Ensure the create-user Lambda still runs `validateCreateUser` (e.g. via `withLambdaHandler(handler, { validator: validateCreateUser })`) so request contract and validation are unchanged.
2. **In-service validation / userType (2.2, 3.3)**: Restore or mirror the old service checks (allowed user types, STAFF/USER/FNF rules) and decide how to handle `userType: 'ADMIN'` (same as STAFF or explicit reject).
3. **Cognito `custom:role` (2.3)**: Add `role` to Cognito custom attributes in the new path if downstream systems depend on it.
4. **Optional: roleName fallback (3.1)** and **assignUserToOrganization logging (3.4)** for full parity.

**Safe to keep as-is:**

- Response and request shape (with validator applied).
- DynamoDB key patterns and condition expressions.
- F&F and doctor linking, role assignment, notification flow (SNS + template + F&F skip), and duplicate-user error mapping.
- Use of a single new user ID for Cognito and DB and storage of invitedBy, inviteCode, invitedID, logoutRequired, definedRoleCode.

**Suggested fixes (concise):**

- **2.1** In the new handler file (or entry), export `main = withLambdaHandler(handler, { validator: validateCreateUser })` and use `main` as the Lambda handler.
- **2.2 / 3.3** In `CreateUserService.createUser`, after reading input, validate `userType` against `['STAFF','USER','ADMIN','FNF']` and throw the same error as the old service; add a branch so that when `userType === 'ADMIN'` the same factory path as STAFF is used (or document that ADMIN is not supported and reject it in the schema).
- **2.3** When calling Cognito user creation, include `role: JSON.stringify(Array.isArray(userRole) ? userRole : userRole ? [userRole] : [])` (or equivalent) in the custom attributes payload and ensure the Cognito service writes `custom:role`.
