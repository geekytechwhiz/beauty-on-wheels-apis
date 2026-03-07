# Create User Refactor — Behavior Comparison Report

## SECTION 1 — SAFE MATCHES

- **Response contract**: Both implementations return `{ invitedUser: result.userID }`. Same shape and field name.
- **Role assignment after create**: Both call `assignUserRole(roleIds[0], organizationID, result.userID, ...).catch(() => {})` with the same arguments and swallow errors.
- **Role ID normalization**: Both use the same logic (array or single value → string array) via `UserValidationService.normalizeRoleIds` / handler `roleIds`.
- **DynamoDB primary user write**: Same key pattern `pk: ORG#${organizationID}`, `sk: USER#${userID}` and condition `attribute_not_exists(pk) AND attribute_not_exists(sk)`.
- **User–organization mapping write**: Same key pattern `pk: USER#${userID}`, `sk: ORG#${organizationID}` (no condition).
- **Doctor assignment**: Same flow when `assignDoctor` is present — `getUser(doctorId, org)`, `saveDoctorPatientLink`, `updatePatientReporter` with same reporter fields. Doctor processor uses the same repository methods and key patterns.
- **Friend/family linking**: When `friendNFamily` is provided, same flow — `searchFnf` then `addMember` with same parameters (relation, relationship, emergencyContact, manageHealth). FnF processor matches old logic.
- **Cognito checks**: Both check email/phone existence before create and throw `UserAlreadyExistsError` on conflict.
- **Organization validation**: Same rules — org must exist and status must not be `on_hold`, `disabled`, `not_exist` (same error codes and messages when using `UserValidationService.validateOrganization`).
- **Validator**: New handler is intended to use the same `validateCreateUser` (and thus same request contract); the new handler file just doesn’t wrap with `withLambdaHandler`/validator in the snippet reviewed.

---

## SECTION 2 — MISSING LOGIC

### 2.1 `friendNFamily` and `assignDoctor` not passed into the service

- **Old**: Handler passes `body?.userInfo?.friendNFamily` and `body?.userInfo?.assignDoctor` into `userService.createUser(..., body?.userInfo?.friendNFamily, body?.userInfo?.assignDoctor)`.
- **New**: Handler only passes `req.validatedCreateUser` (userInfo, userRole, userType, organizationID, userID). `createUserSchema` does **not** include `friendNFamily` or `assignDoctor` on `userInfo`, so they are not in `validatedCreateUser.userInfo`. The new handler never reads `req.body?.userInfo?.friendNFamily` or `req.body?.userInfo?.assignDoctor`.
- **Effect**: In the new flow, F&F linking and doctor assignment never run (processors receive `undefined`).

**Fix (handler):** Pass F&F and assign-doctor from body into the service, e.g.:

```ts
// create-user.ts handler
const body = req.body ?? {};
const result = await userService.createUser({
  userInfo: {
    ...userInfo,
    friendNFamily: body?.userInfo?.friendNFamily,
    assignDoctor: body?.userInfo?.assignDoctor,
  },
  userRole,
  userType,
  userID,
  organizationID,
  correlationId,
  authHeader: authHeader ?? '',
});
```

(Or add optional `friendNFamily` / `assignDoctor` to the service input and set them from `body?.userInfo` in the handler.)

---

### 2.2 New user’s `userID` not set before Cognito and DB

- **Old**: Service sets `data.userID = data.code || ulid()` when missing, then uses that same value for Cognito custom attributes and for the user record.
- **New**: `buildUserData` does not set `userID`. Service never assigns a new user ID. Cognito is called with `userData.userID` (undefined → empty string). Factory is called with `{ ...userData, organizationID }` (no `userID`) so it generates a new `ulid()` for the stored user.
- **Effect**: Cognito gets `custom:userID = ''` while DynamoDB gets a different, newly generated ID. Downstream systems that rely on Cognito’s userID will be wrong.

**Fix (service):** Generate the new user’s ID once and use it everywhere:

```ts
// CreateUserService.createUser — after validation, before buildUserData
const newUserId = (userInfo?.code as string) || ulid();

const userData = buildUserData(userInfo, userType, roleDetails?.roleName ?? "");
userData.userID = newUserId;
// ... then pass userData to Cognito and to UserFactory.createX({ ...userData, organizationID })
```

Ensure `userData` (and thus the factory input) includes `userID: newUserId` so the same ID is used in Cognito and in both DB writes.

---

### 2.3 Org details for notifications

- **Old**: Service calls `getOrganizationViaApi(...)` and keeps `orgDetails` for notification template data (ORG_NAME, ORG_ADDRESS, ORG_INFO, etc.).
- **New**: Service calls `UserValidationService.validateOrganization(...)`, which does **not** return the org; it only throws. So `orgDetails` is `undefined` when passed to `sendWelcomeNotification`.
- **Effect**: Notification template data (e.g. `ORG_NAME`, `ORG_ADDRESS`) is missing or wrong.

**Fix:** Either have `validateOrganization` return the org when valid, or fetch org separately for notifications, e.g.:

```ts
const orgDetails = await getOrganization(organizationID, authHeader);
UserValidationService.validateOrganization(organizationID, authHeader); // or inline the checks using orgDetails
// use orgDetails in sendWelcomeNotification
```

---

### 2.4 ADMIN role and `saveRoles` / org features

- **Old**: If `definedRoleCode === 'ADMIN'` and the role has no existing features, handler calls `packagRepository.getOrgFeatures(organizationID, authHeader)` and `roleRepository.saveRoles(..., orgFeatures, authHeader)`.
- **New**: No call to package/role repositories for ADMIN or org features. No `saveRoles`.
- **Effect**: New ADMIN roles may not get org features written; behavior differs from the old implementation.

**Fix:** Reintroduce the same ADMIN/features/saveRoles logic in the new handler or in a dedicated step in the service (using the same repos or equivalent API).

---

### 2.5 `invitedBy`, `inviteCode`, `invitedID` on stored user

- **Old**: User record includes `invitedBy: invitedBy || data.invitedBy || ''`, `inviteCode: code ? \`INVITE#${code}\` : undefined`, `invitedID: code || undefined`.
- **New**: Factory-created user (Patient/Staff/FnF) does not set `invitedBy`, `inviteCode`, or `invitedID` on the object written to DynamoDB.
- **Effect**: Stored user items are missing these attributes; any reader expecting them will see a behavior change.

**Fix:** When building the user for DB (in the factory or in the service before calling the factory), set:

- `invitedBy`: inviter user ID (e.g. from handler `userID` / service input).
- `inviteCode`: `userInfo.code ? \`INVITE#${userInfo.code}\` : undefined`.
- `invitedID`: `userInfo.code || undefined`.

Use the same semantics as the old service (including fallbacks for `invitedBy`).

---

### 2.6 `logoutRequired` and other legacy defaults

- **Old**: User object sets `logoutRequired: data.logoutRequired ?? false` (and other defaults).
- **New**: Factory does not set `logoutRequired`. Other legacy flags may also be omitted.
- **Effect**: Stored documents may differ from the old shape and defaults.

**Fix:** Ensure the object passed to `repository.createUser` includes the same defaults as the old implementation (e.g. `logoutRequired`, and any other fields the old code set) so the written item is identical.

---

## SECTION 3 — POTENTIAL BEHAVIOR CHANGES

### 3.1 Role details source and shape

- **Old**: Uses `userRepository.getRolePermissions(roleIds[0], organizationID)` (DynamoDB ROLES_TABLE), returning items with `definedRoleCode`, `roleName`, etc. Uses first match where `SK === \`ROLE#${roleIds[0]}\`` or first item.
- **New**: Uses `roleServiceClient.getRoleDetails(userRole, organizationID, authHeader)` (HTTP). Return type is `PermissionDTO[] | null`. `PermissionDTO` has `roleName` and `features`, but **no `definedRoleCode`**. Code uses `roleDetails?.roleName` and `roleDetails?.definedRoleCode` — but `roleDetails` is an array, so `roleDetails?.roleName` is undefined, and `definedRoleCode` is not on the DTO.
- **Effect**: `roleName` passed to Cognito and to `buildUserData` may be wrong. `definedRoleCode` is always undefined, so the branch `roleCode === "FRIEND" || roleCode === "FAMILY"` never runs; FnF is only created when `userType === 'FNF'` is used in a separate branch. If the new code only branches on `userType` and not on `roleCode`, FnF creation may still work for `userType === 'FNF'`, but role-driven behavior (e.g. FRIEND/FAMILY from role) is lost unless the role client returns something equivalent to `definedRoleCode` or the code is updated to use the first element of the array and/or a different field.

**Recommendation:** Align role data with old behavior: either use the same DynamoDB role lookup for create-user, or ensure the role service returns (or is mapped to) `roleName` and `definedRoleCode` and that the service uses the first role when the API returns an array (e.g. `const role = Array.isArray(roleDetails) ? roleDetails[0] : roleDetails`).

---

### 3.2 FnF branch when `definedRoleCode` is missing

- **New**: `if (roleCode === "FRIEND" || roleCode === "FAMILY")` uses `createFnF`; `else if (userType === "STAFF")` uses `createStaff`; else uses `createPatient`. If `roleCode` is always undefined (see 3.1), then for `userType === 'FNF'` the code goes to the `else` and calls `createPatient`, which is wrong.
- **Effect**: FnF users could be stored as patients unless `userType === 'FNF'` is explicitly handled in the same branch as FnF.

**Fix:** Treat FnF by role or by userType, e.g.:

```ts
if (roleCode === "FRIEND" || roleCode === "FAMILY" || String(userType || "").toUpperCase() === "FNF") {
  user = UserFactory.createFnF({ ...userData, organizationID });
} else if ...
```

And ensure `roleCode` is set when the role source provides it (see 3.1).

---

### 3.3 Notification mechanism and template data

- **Old**: Builds rich template data (e.g. WEB_DNS_URL, HOSPITAL_ID, TYPE, DEVICE, ORG_INFO, ORG_ADDRESS, user-type-specific fields), then calls `notifyUser(...)`, which **publishes an event** (e.g. `UserCreatedNotificationRequested`) to SNS. Actual sending is done by a consumer. Notifications are **skipped** when `definedRoleCode === 'FRIEND' || 'FAMILY'`.
- **New**: `UserNotificationService.sendWelcomeNotification` **directly** calls `sendEmail`, `sendSMS`, `sendPush` with a small template data set (`USER_FIRST_NAME`, `ORG_NAME`, `ORG_ADDRESS`). No SNS event. No skip for FRIEND/FAMILY.
- **Effect**: (1) Different delivery path (event vs direct). (2) F&F users get a welcome in the new flow but not in the old. (3) Template data is reduced; templates that expect the old fields may break or render incorrectly.

**Recommendation:** Either keep the old behavior (publish same event, same template data, skip for F&F), or explicitly accept the new behavior and update templates and runbooks. If the requirement is “behavior must remain EXACTLY the same,” restore the old notification flow and template data and F&F skip.

---

### 3.4 Phone number storage (raw vs normalized)

- **Old**: Stores `phoneNumber: phoneNumberForDB` (raw phone), and uses normalized phone for Cognito and notifications.
- **New**: Factory uses `this.normalizePhone(input.phoneNumber)` (trim only in factory); builder may pass through contact phone. If the new path stores a normalized or differently formatted value, stored documents could differ.
- **Recommendation:** Ensure the value written to DynamoDB for `phoneNumber` matches the old “raw” behavior (e.g. same as `phoneNumberForDB` in the old service).

---

### 3.5 ConditionalCheckFailedException → UserAlreadyExistsError

- **Old**: `user.repository.ts` `createUser` catches DynamoDB errors and, when `name === 'ConditionalCheckFailedException'`, throws `UserAlreadyExistsError(user.userID)`.
- **New**: `UserRepositoryV2.createUser` uses `BaseRepository.put`, which does not map that condition to `UserAlreadyExistsError`; the raw AWS error is thrown.
- **Effect**: Callers (and API contract) that expect `UserAlreadyExistsError` for duplicate user will get a different error type and possibly different status/message.

**Fix:** In `UserRepositoryV2.createUser`, catch the put error and rethrow `UserAlreadyExistsError(user.userID)` when the error is `ConditionalCheckFailedException`.

---

## SECTION 4 — CONTRACT VALIDATION

- **Request**: The new handler is designed to use the same validated payload (`validatedCreateUser` with `userInfo`, `userRole`, `userType`, `organizationID`, `userID`). The **body** is not used for `friendNFamily` / `assignDoctor` in the new handler, so the *effective* request contract for those two features is not the same until the handler is fixed (Section 2.1).
- **Response**: Same — `{ invitedUser: result.userID }`. No change to field names or casing.

Once the handler passes `body?.userInfo?.friendNFamily` and `body?.userInfo?.assignDoctor` (and any other body-only fields the old API used), request contract can be considered unchanged.

---

## SECTION 5 — DATABASE WRITE VALIDATION

- **Primary user item**: Key pattern and condition match (`pk`/`sk`, `attribute_not_exists`). **Attributes**: New implementation omits `invitedBy`, `inviteCode`, `invitedID` and may omit other legacy fields (e.g. `logoutRequired`); see Sections 2.5 and 2.6. So keys are the same, but the item body is not identical.
- **User–org mapping**: Key pattern and unconditional put match.
- **Doctor–patient links and reporter update**: Same keys and logic in the doctor processor and old repository; no change when the processor is actually invoked (requires fixing 2.1).

So: key patterns and condition expressions are the same; attribute set and default values are not yet identical.

---

## SECTION 6 — SIDE EFFECT VALIDATION

| Side effect              | Old behavior                                      | New behavior                                                                 | Match? |
|--------------------------|---------------------------------------------------|-------------------------------------------------------------------------------|--------|
| Cognito user creation    | Same pool, same attributes; userID from data      | Same pool; userID can be empty (see 2.2)                                     | No     |
| Role assignment          | `assignUserRole(...).catch(() => {})` after create| Same call and args                                                           | Yes    |
| Friend/Family linking    | When `friendNFamily` passed; searchFnf + addMember| Same logic in processor but **never receives data** (see 2.1)                 | No     |
| Doctor assignment        | When `assignDoctor` passed; link + update reporter| Same logic in processor but **never receives data** (see 2.1)                 | No     |
| Notifications            | Publish SNS event; skip for F&F; rich template    | Direct send; no F&F skip; reduced template; no org details (see 2.3, 3.3)     | No     |

So: role assignment matches. Cognito, F&F, doctor assignment, and notifications do not match until the listed fixes are applied.

---

## SECTION 7 — FINAL VERDICT

**The refactor is not safe as-is.** Several behaviors and stored data differ from the old implementation.

**Risks:**

1. **F&F and doctor flows never run** because `friendNFamily` and `assignDoctor` are not passed from the handler (Section 2.1).
2. **Cognito and DB disagree on user ID** because the new user’s ID is not generated and passed through (Section 2.2).
3. **Notifications** use a different mechanism, different template data, and no F&F skip; org details are missing (Sections 2.3, 3.3).
4. **Stored user records** lack `invitedBy`, `inviteCode`, `invitedID` and possibly other defaults (Sections 2.5, 2.6).
5. **Duplicate user** responses change because `ConditionalCheckFailedException` is not mapped to `UserAlreadyExistsError` (Section 3.5).
6. **Role source and shape** differ; `definedRoleCode` and correct `roleName` are not guaranteed (Section 3.1); FnF user type can be wrong (Section 3.2).
7. **ADMIN role / saveRoles** and org-features logic is missing (Section 2.4).

**Recommendation:** Apply the fixes in Sections 2.1–2.6 and 3.2, 3.5, and align role data (3.1) and notifications (2.3, 3.3) and ADMIN/saveRoles (2.4) with the old implementation before treating the refactor as behavior-preserving.
