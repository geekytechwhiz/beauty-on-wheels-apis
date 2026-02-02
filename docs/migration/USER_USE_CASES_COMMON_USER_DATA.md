# User-Related Use Cases – common-user-data Table (USER_TABLE)

This document lists **all user-related use cases** in the codebase that read from or write to the **common-user-data** table (`USER_TABLE` / `${STAGE}_common_user_data`), in a format similar to the organization flow.

---

## 1. Overview

The **USER_TABLE** is a shared DynamoDB table that holds:

- **User identity & profile**: `USER#<userId>`, `USER_BASIC_DETAILS#<orgId>` (basic details per org)
- **Org user list**: `ORG_USER_LIST#<orgId>`, `USER#<userId>` (user membership in org)
- **User roles**: `USER_ROLE#<orgId>`, `USER_ROLE#<userId>` (role assignments)
- **Invites**: `INVITES#<userId>`, `INVITE#<code>`; `INVITE#<code>`, `INVITE_ROLE#<orgId>#<roleId>`
- **Links**: `ORG_USER_LINK#<orgId>`, `USER#<userId>`; `USER#<userId>`, `ORG_USER_LINK#<orgId>`; `USER#<staffId>`, `SCD_LINK#<patientId>` (staff–patient)
- **Preferred org**: `USER#<userId>`, `PREFERRED_ORG#<orgId>`
- **Devices**: `DEVICE_LIST#<userId>`, `DETAILS#<configDeviceId>`; `RECOMMEND#...` (device recommendations)
- **Friend & Family**: `INVITE_FF#<userId>`, inviter/member items; FNF link items
- **User updates / audit**: `USER_UPDATES#<userId>`, `UPDATES#<timestamp>`
- **Deactivation**: `DEACTIVATED_USER#<userId>`
- **Org/role/org-list/org-link/org-updates/org-count/org-meta** (see organization doc)

Many modules also **read** USER_TABLE for validation, profile, permissions, and listing; only **write** use cases are detailed in the first table below.

---

## 2. User-Related Use Cases (Writes to USER_TABLE)

All code paths that **create, update, or delete** user-related records in common-user-data.

| # | Scenario | Handler / Module | Trigger / API | What is updated (pk/sk or item type) | Conditions |
|---|----------|------------------|---------------|--------------------------------------|------------|
| 1 | **Create invite records** | invite_module/invite_handler | API (invite flow) | Put: `INVITES#userId` `INVITE#code`; `INVITE#code` `INVITE_ROLE#orgId#roleId` (per role) | Valid invite; org exists; roles resolved |
| 2 | **Signup – create user & org list entry** | sign_up/signup_login | API (signup after invite) | Put: USER#userId USER_BASIC_DETAILS#orgId; Put: ORG_USER_LIST#orgId USER#userId; Update: invite item sk1 → STATUS#REGISTERED | Invite valid; Cognito user created |
| 3 | **Login – update session & first-login reward** | sign_up/login, sign_up/login_v2 | API (login) | Update: USER#userId USER_BASIC_DETAILS#orgId (lastUsedAccount, prevLastUsedAccount, logoutRequired, isLoggedIn, tokenUpdatedAt; firstLoggedIn on first login) | Valid login |
| 4 | **Login – MFA status** | sign_up/login | API (login / MFA) | Update: USER#userId USER_BASIC_DETAILS#orgId (mfaStatus, mfaPhoneNumber; REMOVE oldMfaPhoneNumber, mfaVerified) | MFA flow |
| 5 | **Update user profile** | sign_up/post_manage_user_profile | API (profile update) | Update: USER#userId USER_BASIC_DETAILS#orgId (profile fields: name, gender, weight, height, address, locale, timeZone, profilePic, etc.; medicalHistory) | User exists in org |
| 6 | **Update user (generic attributes)** | sign_up/post_manage_user_profile | API | Update: USER#userId USER_BASIC_DETAILS#orgId (dynamic attributes) | Same |
| 7 | **Update org admin user details** | facility_account_organization/new_update_facility_account_organization | API (admin details) | Update: USER#adminId USER_BASIC_DETAILS#orgId (firstName, fullName, lastName, phoneNumber, profilePic, namePrefix, phoneCode, position, department, adminAddress) | Org admin update flow |
| 8 | **Activate / deactivate user in org** | sign_up/activate_deactivate_user | API | Update: ORG_USER_LIST#orgId userCat#userId (sk3, status, isActive) | ROOT_ADMIN or permitted; user in org |
| 9 | **Delete account – initiate / cancel** | sign_up/delete_account/delete_account_sqs_handler | API / SQS | Put: DEACTIVATED_USER (or similar); Delete: DEACTIVATED_USER#userId; Update: USER#userId USER_BASIC_DETAILS#orgId (delete_request_time, isDeleted) | Delete flow |
| 10 | **Role assign / unassign user** | role_service/role_assign_user | API | Put: USER_ROLE#orgId USER_ROLE#userId; Update: ORG_USER_LIST#orgId USER#userId (userCat); Delete: USER_ROLE item | Permissions check |
| 11 | **Role service impact (profile sync)** | role_service/role_service_impact | API / stream | Update: ORG_USER_LIST#orgId USER#userId (emailAddress, phoneNumber, firstName, middleName, lastName, profilePic, deleteFlag); Update: permission items; Put/Delete various role and mapping items | Profile or role change |
| 12 | **Create org–user link** | user_linking/create_org_user_link | API | BatchWrite: ORG_USER_LINK#orgId USER#userId; USER#userId ORG_USER_LINK#orgId | Org–user link create |
| 13 | **Create staff–patient link** | user_linking/create_org_user_link | API | BatchWrite: USER#staffId SCD_LINK#patientId; USER#patientId SCD_LINK#staffId | Staff–patient link create |
| 14 | **Link/unlink user (reporter, referred, assignees, etc.)** | user_linking/link_unlink_user | API | Update/Put/Delete: ORG_USER_LIST#orgId USER#userId; assignee/reporter/referred/dietician/healthCoach/careManager entries; UPDATES entries | ADD/REMOVE reporter, referrer, assignees, etc. |
| 15 | **Add Friend & Family** | friend_family_module/add_friend_family | API | Put: FNF item (e.g. INVITE_FF#userId or FNF link); Update: USER item (inviterId etc.) | FNF add |
| 16 | **Update Friend & Family** | friend_family_module/update_friend_family | API | Update: FNF item (sk1, sk2, createdDate, modifiedDate, createdBy, updates or keys) | FNF update |
| 17 | **Delete Friend & Family** | friend_family_module/delete_friend_family | API | Delete: FNF item | FNF delete |
| 18 | **Friend & Family stream impact** | friend_family_module/friend_family_impact | DynamoDB stream | Update/delete FNF or user-related items on stream events | Stream trigger |
| 19 | **Register device for user** | vitals_sync/device_user_registration | API | Put: DEVICE_LIST#userId DETAILS#configDeviceId; Update: same (modifiedDate, sk2, updates list) | Device registration |
| 20 | **Add device recommendation** | vitals_sync/add_device_recommendation | API | Put: RECOMMEND#... (pk/sk per recommendation model) | Recommendation add |
| 21 | **Remove device recommendation** | vitals_sync/remove_device_recommendation | API | Delete/Update: RECOMMEND#... items | Recommendation remove |
| 22 | **Update vitals tile order** | vitals_sync/get_vitals_tile_order | API | Update: user vitals tile order item in USER_TABLE | Tile order save |
| 23 | **Delete device(s)** | vitals_sync/delete_device, delete_multiple_devices | API | Delete: DEVICE_LIST#userId DETAILS#configDeviceId (and related) | Device delete |
| 24 | **Update preferred org** | facility_account_organization/update_preferred_org | API | Update/Put: USER#userId PREFERRED_ORG#orgId (isActive, deletedAt, sk1); deactivate same orgType preferred orgs | Org exists; orgType valid |
| 25 | **Set default profile** | sign_up/set_default_profile | API | Update: USER_TABLE (default profile for user) | User exists |
| 26 | **Change email / phone** | sign_up/change_email_phonenumber | API | Update: USER#userId USER_BASIC_DETAILS#orgId (mailPhoneChangeKey, emailPhoneStatus) | Cognito + USER_TABLE sync |
| 27 | **Manage approval (org user list)** | sign_up/manage_approval | API | Update: ORG_USER_LIST#orgId USER#userId (sk3, status – PENDING/APPROVED, isActive) | Approval flow |
| 28 | **Manage notes** | sign_up/manage_notes | API | Put/Update: user notes items in USER_TABLE | Notes CRUD |
| 29 | **Manage schedule config** | sign_up/manage_schedule_config | API | Update: USER_TABLE (schedule config for user/org) | Schedule config |
| 30 | **User impact (profile sync)** | sign_up/user_impact | API / stream | Update: user record (emailAddress, phoneNumber, fullName, firstName, middleName, lastName, profilePic, roleId, roleName, position, modifiedDate, deleteFlag) | Profile/role sync (e.g. DynamoDB stream) |
| 31 | **Org user list entry update script** | sign_up/org_user_list_entry_update_script | Script | Read USER_TABLE/PACKAGE_TABLE; may update org user list or related entries | Scheduled/script |
| 32 | **Update MRN script** | sign_up/update_mrn_number_script | Script | Update: invite or user-related MRN fields in USER_TABLE | Script |
| 33 | **Save pre-test** | sign_up/pre_test/save_pre_test | API | Put/Update: pre-test item (USER_TABLE) | Pre-test save |
| 34 | **Manage / clone availability schedule** | sign_up/availability_schedule | API | Put/Update: availability/schedule items in USER_TABLE | Availability CRUD |
| 35 | **Track download count** | sign_up/track_download_count | API | Update: USER_TABLE (download count or similar) | Download track |
| 36 | **Logout** | sign_up/logout | API | Update: USER#userId USER_BASIC_DETAILS#orgId (logoutRequired, isLoggedIn) | Logout |
| 37 | **Create password** | sign_up/create_password | API | May update USER_TABLE after password set (e.g. first-login flag) | Password set |
| 38 | **Assign user task** | tasks_module/assign_user_task | API | Update: USER#userId USER_BASIC_DETAILS#orgId (modifiedDate, isTaskCompleted); Put: TASK#userId TASK#taskId (TASKS_TABLE) | Task assign |
| 39 | **Complete user task** | tasks_module/complete_user_task | API | Update: task item; may update USER_TABLE (e.g. isTaskCompleted) | Task complete |
| 40 | **Redeem rewards points** | rewards_module/redeem_rewards_points | API | Put: USER_UPDATES#userId UPDATES#timestamp (reward redeemed audit) | Rewards redeem |
| 41 | **Assign form** | forms_module/assign_form | API | Put/Update: form assignment in USER_TABLE (or related table) | Form assign |
| 42 | **Save user document** | forms_module/save_user_document | API | Put/Update: user document item in USER_TABLE | Document save |
| 43 | **MFA / reset / forgot password** | mfa_password_microservice (mfa, reset_password, forgot_password, cancel_pending_mfa) | API | Update: USER#userId USER_BASIC_DETAILS#orgId (MFA status, pending MFA, etc.) | MFA/password flow |
| 44 | **Package – assign user package / plan** | package_module (assign_user_package, user_manage_plan, etc.) | API | Put/Update: USER_TABLE and/or PACKAGE_TABLE (user package, plan, payment status) | Package/plan assign |
| 45 | **Goals (user-related)** | goals_module/manage_goals | API | saveDetails to USER_TABLE (if used for user goals metadata); main goals in VITALS_TABLE | Goals save |
| 46 | **Thresholds (user/patient)** | thresholds_module/manage_thresholds, threshold_vitals_handler | API / stream | Put/Update: threshold meta/alert in USER_TABLE or COMMON_USER_TABLE (e.g. THLD_META#orgId THLD_META#patientId; threshold alerts) | Threshold config / alerts |
| 47 | **Error notification** | sign_up/error_notification | API | Put: error/notification item (USER_TABLE or related) | Error report |
| 48 | **Add/remove org devices** | vitals_sync/add_remove_org_devices | API | Put/Delete: ORG_DEVICES#orgId / ORG_DEVICES#deviceId (org-level; may affect user device visibility) | Org device mapping |

---

## 3. User-Related Read-Only Use Cases (USER_TABLE)

Handlers that **only read** from common-user-data for user/profile/org/roles (no writes in this table).

| # | Scenario | Handler / Module | Purpose |
|---|----------|------------------|---------|
| 1 | Get user profile | sign_up/get_user_profile | Read USER#userId USER_BASIC_DETAILS#orgId |
| 2 | User account list | sign_up/user_account_list | List ORG_USER_LIST#orgId; get user details, roles |
| 3 | Get org user list | sign_up/get_org_user_list | List users in org |
| 4 | Get organization details | facility_account_organization/get_organization_details | Read org + permissions; may read user/role data |
| 5 | Get linked orgs | facility_account_organization/get_linked_orgs | Read ORG_LINK#orgId |
| 6 | List / get roles | role_service/list_role_service, new_update_role_service | Read ROLE#orgId, USER_ROLE#orgId |
| 7 | Doctor/patient list | user_linking/doctor_patient_list | Read user links, roles, basic details |
| 8 | Fetch Friend & Family | friend_family_module/fetch_friend_family | Read FNF items |
| 9 | Get device list / recommendations | vitals_sync/get_device_list, add_device_recommendation (get) | Read DEVICE_LIST#userId, RECOMMEND#... |
| 10 | Get vitals tile order | vitals_sync/get_vitals_tile_order | Read user tile order |
| 11 | Fetch user readings | vitals_sync/fetch_user_readings | Read user/device/vital data |
| 12 | Login / auth | sign_up/login, login_v2, login_microservice | Read user for session validation |
| 13 | Get pre-test | sign_up/pre_test/get_pre_test | Read pre-test item |
| 14 | Get notes | sign_up/get_notes | Read notes |
| 15 | Check reminder / missed reminder | reminder_module | Read user/reminder data |
| 16 | Get prescriptions / lab reports | prescription_module, pharmacy_module | Read user-related data (may use USER_TABLE for profile/org) |
| 17 | Package / features / services | package_module (get_user_features, get_services_by_list, etc.) | Read USER_TABLE for user/org/package/features |
| 18 | Custom authorization | authorizer_service_setup/custom_authorization, initial_setup | Read user/org/role for auth decisions |
| 19 | Distributor / forwarder (stream)** | db_stream_microservice | Read stream records; may write to other tables |

---

## 4. Key pk/sk Patterns (User-Related) in USER_TABLE

| Entity | pk | sk | Notes |
|--------|----|----|--------|
| User basic details (per org) | USER#&lt;userId&gt; | USER_BASIC_DETAILS#&lt;orgId&gt; | Profile, contact, MFA, session (lastUsedAccount, isLoggedIn), delete_request_time, isDeleted |
| Org user list entry | ORG_USER_LIST#&lt;orgId&gt; | USER#&lt;userId&gt; or userCat#userId | userCat, sk1, sk2, sk3, status, isActive, emailAddress, fullName, roleID, reporterId, etc. |
| User role assignment | USER_ROLE#&lt;orgId&gt; | USER_ROLE#&lt;userId&gt; (or sk1/sk2 index) | Role per user per org |
| Invite (mapping) | INVITES#&lt;userId&gt; | INVITE#&lt;code&gt; | Invite code, status (sk1), email, phone, name |
| Invite role | INVITE#&lt;code&gt; | INVITE_ROLE#&lt;orgId&gt;#&lt;roleId&gt; | Role on invite |
| Org–user link | ORG_USER_LINK#&lt;orgId&gt; | USER#&lt;userId&gt; | User linked to org (e.g. patient org) |
| User → org link | USER#&lt;userId&gt; | ORG_USER_LINK#&lt;orgId&gt; | Reverse lookup |
| Staff–patient link | USER#&lt;staffId&gt; | SCD_LINK#&lt;patientId&gt; | Care team link |
| Preferred org | USER#&lt;userId&gt; | PREFERRED_ORG#&lt;orgId&gt; | sk1, orgType, isActive |
| Device (user) | DEVICE_LIST#&lt;userId&gt; | DETAILS#&lt;configDeviceId&gt; | User device registration |
| Device recommendation | RECOMMEND#... | (varies) | sk1=patientUserId, sk4=device id, etc. |
| User updates (audit) | USER_UPDATES#&lt;userId&gt; | UPDATES#&lt;timestamp&gt; | Audit trail |
| Deactivated user | DEACTIVATED_USER | &lt;userId&gt; | Pending delete |

---

## 5. Notes

- **Invite flow**: Invite handler writes **invite** records (INVITES, INVITE, INVITE_ROLE). The actual **USER#userId USER_BASIC_DETAILS#orgId** and **ORG_USER_LIST#orgId USER#userId** are created by **sign_up/signup_login** when the user completes signup (after Cognito and optional Login Lambda).
- **Login** updates session fields and optionally writes first-login reward activity (REWARDS_TABLE in login; USER_TABLE may hold USER_UPDATES or similar).
- **Organization**-related keys (ORG_LIST, ORG_UPDATES, ORG_LINK, ORG_DEVICES, ROLE, ORG_FEATURES, etc.) are documented in `facility_account_organization/ORGANIZATION_REFACTOR_USE_CASES.md`.
- Table name: typically `process.env.USER_TABLE` or `${STAGE}_common_user_data`; some modules use `COMMON_USER_TABLE` or `USER_DATA` for the same table.
