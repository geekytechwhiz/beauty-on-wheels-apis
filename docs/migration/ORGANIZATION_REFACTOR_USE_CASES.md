#  Account Organization – Refactor Use Cases & New Organization Table

## 1. Current State Summary

The **facility_account_organization** module is a single, large module with many Lambdas sharing the same **USER_TABLE** (and PACKAGE_TABLE) with mixed entity types and complex pk/sk patterns. One handler (**new_update_facility_account_organization**) does create, update org info, update admin, update modules, update devices, and update supported vitals in a single ~900-line flow with branching.

---

## 2. Current Use Cases (by Handler)

| # | Handler / Flow | Use Case | Table(s) / Keys |
|---|----------------|----------|------------------|
| 1 | **new_update_facility_account_organization** | **Create organization** (new org when `getOrgDetails.length === 0`) | USER_TABLE: `pk=ORG_LIST`, `sk=ORG#<orgId>`, sk1 (hierarchy), sk2=PENDING, sk3 (name search), organizationInfo, adminDetails, modules, devices, searchFields, status |
| 2 | **new_update_facility_account_organization** | **Update organization info** (name, address, type, size, website, bio, goals, thresholds, hospitalImage, etc.) | Same item; `updateOrgBasicDetails` |
| 3 | **new_update_facility_account_organization** | **Add/update admin** (adminDetails, create in Cognito via LOGIN_LAMBDA or SAVE_ROLE_LAMBDA, assign role) | Same org item + USER_TABLE user records, Invoke Lambda |
| 4 | **new_update_facility_account_organization** | **Update org modules (permissions)** | Same org item `modules`; Role Lambda; ORG#orgId + ORG_PERMISSION#id |
| 5 | **new_update_facility_account_organization** | **Update org devices** (add/remove device mappings, supportedVitals) | Same org item; ORG_DEVICES#orgId / ORG_DEVICES#deviceId |
| 6 | **new_update_facility_account_organization** | **Update supported vitals only** | Same org item `supportedVitals` |
| 7 | **new_update_facility_account_organization** | **Org update history** | USER_TABLE: ORG_UPDATES#orgId, UPDATES#timestamp |
| 8 | **delete_facility_handler** | **Soft-delete organization** (set deleteFlag=1 on org item; write ORG_UPDATES delete event) | USER_TABLE: same org item + ORG_UPDATES |
| 9 | **list_facility_account_organization** | **List organizations** (filter by status, type, adminName, orgName, country, state, city, assignedPackagesName; pagination) | USER_TABLE: pk=ORG_LIST; indexes pk-sk3, pk-sk4 |
| 10 | **list_facility_account_organization** | **Get children of an org** (by orgId, hierarchy via sk1) | USER_TABLE: pk=ORG_LIST, sk=ORG#orgId; index pk-sk1-index |
| 11 | **get_organization_details** | **Get single org details** (org + permissions, packages, supported relations, linked orgs, mobile screens) | USER_TABLE org item; PACKAGE_TABLE; Lambda getMobileScreens |
| 12 | **link_unlink_org** | **Link two organizations** (ROOT_ADMIN only; both must exist; toOrg must be ACTIVE) | USER_TABLE: ORG_LINK#fromOrg / ORG_LINK#toOrg; ORG_UPDATES for both |
| 13 | **link_unlink_org** | **Unlink two organizations** | Delete ORG_LINK items; ORG_UPDATES |
| 14 | **org_status_update** | **Update org status** (e.g. PENDING → ACTIVE; ROOT_ADMIN only) | Update org item `status`; on PENDING→ACTIVE optionally invoke Invite Lambda to create admin user |
| 15 | **mapping_handler** (DynamoDB stream) | **On INSERT**: increment org count by organizationType | USER_TABLE: ORG_COUNT partition (fetch_organization_count) |
| 16 | **mapping_handler** (DynamoDB stream) | **On MODIFY, status→ACTIVE**: create default roles, create features mapping, map education videos, create org reward rules from root rules | USER_TABLE: ROLE#orgId, ORG_FEATURES, ORG_FEATURES_UPDATES; PACKAGE_TABLE: feature mappings; REWARDS table |
| 17 | **mapping_handler** (DynamoDB stream) | **On MODIFY, modules changed**: remove permissions for removed keys | removePermissions(removedPermissions, orgId, rootId) |
| 18 | **mapping_handler** (DynamoDB stream) | **On MODIFY, organizationType changed**: update linked org types | updateLinkedOrgTypesIfChanged |
| 19 | **fetch_organization_count** | **Get organization counts** (total and by type) | USER_TABLE: pk=ORG_COUNT_PARTITION_KEY (e.g. ORG_COUNT), items per type |
| 20 | **update_preferred_org** | **Set user’s preferred org** by orgType (e.g. hospital, corporate) | USER_TABLE: user preferred-org mapping |
| 21 | **get_linked_orgs** | **Get linked organizations** for an org | USER_TABLE: pk=ORG_LINK#orgId |
| 22 | **get_qr_code / get_random_qr_code / qr_code_generation / random_qr_code_generation** | QR code generation / retrieval for org | S3 / Lambda |
| 23 | **webportal_content (get/manage)** | Get/manage webportal content for org | DynamoDB |
| 24 | **org_disable_script** | Disable org (script) | USER_TABLE |
| 25 | **org_list_entry_update_package_script** | Update org list entry for packages (script) | USER_TABLE |
| 26 | **organization_aggregation_script** | Aggregation script for organizations | DB |

---

## 2.1 Organization Update Scenarios (Detailed)

All code paths that **modify** organization-related records (org main item, org links, org updates, org devices, org permissions, etc.), in table form.

| # | Scenario | Handler / Source | Trigger / API | What is updated | Conditions | Table / Keys |
|---|----------|------------------|---------------|------------------|-------------|---------------|
| 1 | **Create organization** | new_update_facility_account_organization | API (POST/PUT with body) | New org item created; org update history item | `getOrgDetails.length === 0` and `organizationInfo` present | USER_TABLE: `pk=ORG_LIST`, `sk=ORG#<orgId>` (putItem); `ORG_UPDATES#orgId`, `UPDATES#ts` (putItem) |
| 2 | **Update organization info** | new_update_facility_account_organization | API (body: organizationInfo) | organizationInfo (name, address, type, size, website, googleMapsLink, hospitalBio, scheduleConf, goals, defaultSetting, thresholds, contact, hospitalImage, workingHours, specialization, certifications, etc.); searchFields; traceId; accountAlias | Org exists; at least one org info field changed | USER_TABLE: same org item via `updateOrgBasicDetails`; optional `ORG_UPDATES#orgId` (putItem) |
| 3 | **Update admin details** | new_update_facility_account_organization | API (body: adminDetails) | adminDetails on org item (adminName, phoneNumber, emailAddress, profilePic, adminId, namePrefix, phoneCode, adminAddress, position, department); sk4 (admin name for search) | Org exists; adminDetails present; adminId may be existing or new | USER_TABLE: org item `adminDetails`, `sk4`; USER#adminId USER_BASIC_DETAILS#orgId (updateUser); optional Invite/ChangeMail Lambda |
| 4 | **Update admin role on org** | new_update_facility_account_organization | API (after admin/modules flow) | org item: adminDetails.adminRole, adminDetails.roleName | When assigning or updating admin role | USER_TABLE: org item via `updateOrgRole` |
| 5 | **Update org modules (permissions)** | new_update_facility_account_organization | API (body: modules) | org item: `modules` | Org exists; orgModules present; validated against permissible permissions | USER_TABLE: org item via `updateOrgBasicDetails`; `ORG_UPDATES#orgId`; Role Lambda; optionally `ORG#orgId` `ORG_PERMISSION#id` (updateUserPermission) |
| 6 | **Update org devices** | new_update_facility_account_organization | API (body: devices) | ORG_DEVICES#orgId / ORG_DEVICES#deviceId items (put or delete); optionally org item `devices` when no prior devices | Org exists; orgDevices array present | USER_TABLE: putItem/deleteItem ORG_DEVICES mappings; optional updateOrgBasicDetails for `devices` |
| 7 | **Update supported vitals only** | new_update_facility_account_organization | API (body: supportedVitals) | org item: `supportedVitals` | Org exists; supportedVitals array present (and matched to meta) | USER_TABLE: org item via `updateOrgBasicDetails` |
| 8 | **Update org status** | org_status_update | API (body: organizationId, status) | org item: `status`, `sk2`, `modifiedDate`; when status=HOLD: `holdDate`; when ACTIVE/DISABLED: REMOVE holdDate | ROOT_ADMIN; status in [ACTIVE, HOLD, DISABLED] | USER_TABLE: org item via `updateOrgStatus`; on PENDING→ACTIVE optionally Invite Lambda |
| 9 | **Soft-delete organization** | delete_facility_handler | API (body: organizationID) | org item: `deleteFlag = '1'`; new audit item for delete event | Org exists; not already deleted | USER_TABLE: org item via `updateItemBasedOnIndex`; putItem `ORG_UPDATES#orgId`, `UPDATES#ts` |
| 10 | **HOLD → DISABLED (cron)** | org_disable_script | Scheduled/cron | org item: `status=DISABLED`, `sk2=DISABLED`, `modifiedDate`; REMOVE `holdDate` | Orgs where sk2=HOLD and holdDate &lt;= 15 days ago; deleteFlag ≠ 1 | USER_TABLE: org item via `updateOrgListEntry` |
| 11 | **Sync assigned packages to org** | org_list_entry_update_package_script | Script (no API) | org item: `assignedPackages`, `assignedPackagesName` | For each org; packages from PACKAGE_TABLE for ORG#orgId | USER_TABLE: org item via `updateOrgWithPackages` |
| 12 | **Link organizations** | link_unlink_org | API (body: fromOrg, toOrg, action=LINK) | New ORG_LINK#fromOrg/ORG_LINK#toOrg items (both directions); ORG_UPDATES items for both orgs | ROOT_ADMIN; both orgs exist; toOrg status=ACTIVE | USER_TABLE: putItem ORG_LINK items; putItem ORG_UPDATES for fromOrg and toOrg |
| 13 | **Unlink organizations** | link_unlink_org | API (body: fromOrg, toOrg, action=UNLINK) | Delete ORG_LINK items (both directions); ORG_UPDATES items for both orgs | ROOT_ADMIN; both orgs exist | USER_TABLE: deleteItem ORG_LINK; putItem ORG_UPDATES |
| 14 | **Enable/disable org (sign_up)** | sign_up/enable_disable_organization | API POST /enable-disable-organization | org item: `status=DISABLED`, `sk2=DISABLED` | organizationID in body; org exists | USER_TABLE: org item via `updateStatus` |
| 15 | **Stream: org INSERT** | mapping_handler | DynamoDB stream (INSERT on org item) | ORG_COUNT partition: increment count for organizationType | New org record inserted | USER_TABLE: ORG_COUNT (or similar) via `incrementOrganizationCount` |
| 16 | **Stream: status → ACTIVE** | mapping_handler | DynamoDB stream (MODIFY, status PENDING→ACTIVE) | ROLE#orgId items (default roles); ORG_FEATURES in PACKAGE_TABLE; ORG_FEATURES_UPDATES; VIDEO#orgId (education); REWARDS rules for org | newImage.status=ACTIVE, old status PENDING; newImage.modules present | USER_TABLE / PACKAGE_TABLE: roles, features, videos, reward rules |
| 17 | **Stream: modules changed** | mapping_handler | DynamoDB stream (MODIFY, modules diff) | Remove permission items for removed module keys (removePermissions) | oldImage.modules vs newImage.modules; removed keys length &gt; 0 | USER_TABLE: ROLE#orgId permission-related cleanup |
| 18 | **Stream: organizationType changed** | mapping_handler | DynamoDB stream (MODIFY, organizationType diff) | ORG_LINK items: update `sk1` to new organizationType for all linked orgs of this org | newImage.organizationInfo.organizationType ≠ oldImage | USER_TABLE: ORG_LINK#orgId ORG_LINK#linkedOrgId via `updateOrgType` (sk1) |
| 19 | **Update user preferred org** | update_preferred_org | API (body: userId, organizationId, orgType) | USER#userId PREFERRED_ORG#orgId item (put or update isActive/deletedAt/sk1); deactivate same orgType preferred orgs | Org exists; orgType valid | USER_TABLE: user preferred-org records only (does **not** update org record) |

**Note:** *update_preferred_org* and *fetch_organization_count* do not modify the main org record; *webportal_content* and QR handlers manage separate content/assets, not the org item itself.

---

## 3. Current Data Model (Relevant Keys in USER_TABLE)

| Entity | pk | sk | Notes |
|--------|----|----|--------|
| Org record | ORG_LIST | ORG#&lt;orgId&gt; | Single item per org: organizationInfo, adminDetails, modules, devices, status, searchFields, sk1 (hierarchy), sk2, sk3 (name), sk4 (admin name) |
| Org update history | ORG_UPDATES#&lt;orgId&gt; | UPDATES#&lt;timestamp&gt; | Audit trail |
| Org permission | ORG#&lt;orgId&gt; | ORG_PERMISSION#&lt;id&gt; | Per-org permission overrides |
| Org link | ORG_LINK#&lt;orgId&gt; | ORG_LINK#&lt;linkedOrgId&gt; | Bidirectional link |
| Org devices | ORG_DEVICES#&lt;orgId&gt; | &lt;deviceId&gt; | Org → device |
| Device → org | ORG_DEVICES#&lt;deviceId&gt; | &lt;orgId&gt; | Device → org |
| Role | ROLE#&lt;orgId&gt; | ROLE#&lt;roleId&gt; | Created by mapping_handler when status→ACTIVE |
| Org features | ORG_FEATURES | &lt;featureId&gt;#&lt;orgId&gt; | In PACKAGE_TABLE |
| Org features updates | ORG_FEATURES_UPDATES#&lt;featureId&gt; | UPDATES#&lt;orgId&gt;#&lt;ts&gt; | USER_TABLE |
| Org count | ORG_COUNT (or similar) | &lt;orgType&gt; | For fetch_organization_count |
| Meta | ORG_META | e.g. SUPPORTED_RELATIONS, DEFAULT_SETTINGS, schedule, supported vitals | Reference data |

---

## 4. Why It’s “Messy”

- **Single monolithic create/update handler**: One API and one Lambda handle create org, update org info, update admin, update modules, update devices, update supported vitals with deep branching and many Lambdas (Login, Role, Assign, ChangeMail, ImagePath).
- **Shared table**: USER_TABLE holds orgs, org updates, org links, org permissions, roles, user data, meta; PACKAGE_TABLE holds feature mappings. Hard to scale and reason about.
- **Inconsistent naming**: Mix of ORGANIZATIONID, organizationId, orgId; different CONSTANTS files (CONSTANTS vs CONSTANTS.js).
- **Tight coupling**: Org creation/update triggers DynamoDB stream → mapping_handler → roles, features, rewards, education videos, form rules.
- **Cross-cutting concerns**: Org details, admin (user) creation, permissions, devices, and links are all intertwined in one flow.

---

## 5. Use Cases for a New “Organization” Table (Microservice-Oriented)

A dedicated **Organization** table (or org-specific access pattern) should own **core organization identity and profile** only. Other domains (roles, features, devices, links, counts) become separate services/tables that reference `organizationId`.

### 5.1 Organization Table – Suggested Use Cases

| Use Case | Description | Suggested API / Service |
|----------|-------------|--------------------------|
| **Create organization** | Create a new org with core info (name, type, address, contact, status=PENDING, parentOrgId, hierarchy). No admin/user creation here. | `POST /organizations` – Organization Service |
| **Get organization** | Get one org by id (core profile only). | `GET /organizations/:id` – Organization Service |
| **Update organization** | Update core org profile (name, address, type, size, website, bio, goals, thresholds, contact, workingHours, scheduleConf, etc.). | `PATCH /organizations/:id` – Organization Service |
| **Delete organization** | Soft-delete (e.g. deleteFlag or status=DELETED). | `DELETE /organizations/:id` – Organization Service |
| **List organizations** | List with filters (status, type, name, country, state, city, pagination). | `GET /organizations` – Organization Service |
| **List child organizations** | List children by parentOrgId (hierarchy). | `GET /organizations?parentId=:id` or `GET /organizations/:id/children` – Organization Service |
| **Organization exists** | Check existence (e.g. for update_preferred_org, link_unlink). | Internal `getOrganization(id)` or `GET /organizations/:id` (404 = not found) |

### 5.2 What Stays Outside the Organization Table (Other Microservices)

| Concern | Use Case | Target |
|---------|----------|--------|
| **Admin user** | Create/update org admin (Cognito, user record, assign role) | User / Invite microservice |
| **Org status** | PENDING → ACTIVE (and trigger “create admin” / default roles) | Organization Service + event to Mapping/Role service |
| **Modules / permissions** | Update org modules; sync to role service | Role / Permission microservice |
| **Devices** | Add/remove org–device mappings; supported vitals | Device microservice |
| **Org links** | Link/unlink two orgs | Organization Service (link table or same service) |
| **Default roles & features** | When org becomes ACTIVE | Trigger (event/stream) → Role service, Feature/Package service |
| **Org update history** | Audit log | Organization Service (e.g. ORG_UPDATES#orgId) or separate Audit service |
| **Org count by type** | Aggregates | Organization Service or small Analytics service |
| **Preferred org (user)** | User’s preferred org by type | User/Profile microservice |
| **QR / webportal** | QR and webportal content | Keep as separate Lambdas or small services |

---

## 6. Proposed New Organization Table Design (DynamoDB)

Single table or dedicated table for **organization core only**:

| Attribute | Type | Description |
|-----------|------|-------------|
| **pk** | S | `ORG#<orgId>` (or keep `ORG_LIST` for compatibility) |
| **sk** | S | `PROFILE` (single item per org) or `ORG#<orgId>` |
| **id** | S | orgId (accountAlias or generated) |
| **parentId** | S | parentOrgId for hierarchy |
| **name** | S | organizationName |
| **type** | S | organizationType |
| **status** | S | PENDING \| ACTIVE \| HOLD \| DELETED |
| **address** | M | city, country, countryCode, address, postalCode, state |
| **contact** | M | emailAddress, phoneCode, phoneNumber |
| **website** | S | optional |
| **googleMapsLink** | S | optional |
| **hospitalImage** | S | optional |
| **hospitalBio** | S | optional |
| **organizationSize** | S | optional |
| **noOfBranches** | S | optional |
| **scheduleConf** | M | optional |
| **workingHours** | M | optional |
| **goals** | L/M | optional |
| **thresholds** | L/M | optional |
| **defaultSetting** | M | optional (e.g. languages) |
| **searchFields** | M | normalized for list filters (name, city, country, state, organizationType) |
| **createdAt** | N | timestamp |
| **modifiedAt** | N | timestamp |
| **createdBy** | S | userID |
| **modifiedBy** | S | userID |
| **deleteFlag** | S/N | soft delete |
| **traceId** | S | optional |

**GSI** for list:  
- **pk = ORG_LIST** (or tenantId), **sk = status#type#name** (or similar) for list by status/type/name.  
- **pk = parentId**, **sk = orgId** (or createdAt) for children.

Admin, modules, devices, and supportedVitals are **not** stored in this table; they are either in the same table under different pk/sk (e.g. `ORG#<orgId>#ADMIN`, `ORG#<orgId>#MODULES`) or in separate services/tables.

---

## 7. Microservice Split (High Level)

1. **Organization Service**
   - Table: Organization (core profile only).
   - APIs: Create, Get, Update, Delete, List, List children.
   - Publishes events: OrganizationCreated, OrganizationUpdated, OrganizationStatusChanged, OrganizationDeleted.

2. **Org Admin / Onboarding**
   - Consumes OrganizationCreated / OrganizationStatusChanged (e.g. PENDING→ACTIVE).
   - Creates admin user (Cognito + user record + assign role) via existing Invite/User flows.

3. **Role / Permission Service**
   - Consumes OrganizationStatusChanged (ACTIVE) or event from Organization Service.
   - Creates default roles for org; updates org modules/permissions; manages ORG_PERMISSION and ROLE#orgId.

4. **Org–Device Service**
   - Manages ORG_DEVICES#orgId and device↔org mappings; supportedVitals for org.

5. **Org Link Service**
   - Manages ORG_LINK#orgId; link/unlink with validation (both exist, toOrg ACTIVE).

6. **Mapping / Feature Service**
   - Consumes stream or event when org becomes ACTIVE; creates default features mapping, education videos, reward rules (filtered from root).

7. **Org Count / Analytics**
   - Increment/decrement counts by type on create/delete/status; query for dashboard.

8. **Preferred Org**
   - Part of User/Profile service; store user’s preferred org by orgType.

---

## 8. Migration Path (Short)

1. Introduce **Organization Service** with new Organization table (or clear pk/sk pattern) and implement: Create, Get, Update, Delete, List, List children.
2. Keep existing **create-update-org** API temporarily: have it call Organization Service for create/update core profile, and keep existing logic for admin/modules/devices in place (or move stepwise to Lambdas that call the new service).
3. Move **org status update** into Organization Service; on PENDING→ACTIVE publish event for mapping_handler / Role service / Admin creation.
4. Replace direct USER_TABLE org reads in **list**, **get_organization_details**, **link_unlink**, **delete**, **update_preferred_org**, **fetch_organization_count** with Organization Service (or shared client that reads from new table).
5. Extract **admin creation/update**, **modules**, **devices**, **supported vitals** into separate flows that call Organization Service for “org exists” and then perform their own writes.
6. Deprecate the monolithic **new_update_facility_account_organization** branching; replace with distinct APIs per use case (e.g. PATCH org, POST org admin, PATCH org modules, PATCH org devices).

---

## 9. Summary Table – Use Cases for New Organization Table

| Use case | In current module | In new Organization table / service |
|----------|-------------------|--------------------------------------|
| Create organization (core) | new_update (branch) | ✅ Create org profile only |
| Update organization (core) | new_update (branch) | ✅ Update org profile |
| Delete organization | delete_facility_handler | ✅ Soft-delete org |
| Get organization | get_organization_details | ✅ Get by id (core); details can aggregate from other services |
| List organizations | list_facility_account_organization | ✅ List with filters + children |
| Org status update | org_status_update | ✅ Update status; emit event for admin/roles |
| Org link / unlink | link_unlink_org | ✅ Or dedicated link service with org lookup |
| Admin create/update | new_update (branch) | ❌ User/Invite microservice |
| Modules/permissions | new_update (branch) | ❌ Role microservice |
| Devices / supportedVitals | new_update (branch) | ❌ Device microservice |
| Default roles/features on ACTIVE | mapping_handler | ❌ Role/Feature service (triggered by event) |
| Org count by type | fetch_organization_count | ✅ Or small analytics service |
| Preferred org (user) | update_preferred_org | ❌ User/Profile service |

This gives a clear set of **use cases for the new Organization table** and a path to refactor the messy module into a **microservice-based** design.

---

## 10. Where Linked Organization Functionality Is Used

The **linked organization** feature (ORG_LINK between two orgs) is used in these use cases:

| Use case | Where | How |
|----------|--------|-----|
| **Get organization details** | `facility_account_organization/get_organization_details` | Calls `getLinkedOrgs(organizationID)` and returns `data.linkedOrganizations` so the org profile includes the list of linked orgs. |
| **Get linked orgs (standalone API)** | `facility_account_organization/get_linked_orgs` | POST `/get-linked-orgs` with `organizationId` (and optional `orgType`, `userId` for preferred org). Returns linked orgs for that org; used for dropdowns, partner selection, etc. |
| **Link / unlink org (admin)** | `facility_account_organization/link_unlink_org` | POST `/link-unlink-org` with `fromOrg`, `toOrg`, `action` (LINK \| UNLINK). ROOT_ADMIN only; creates or removes ORG_LINK records. |
| **Org type change (stream)** | `facility_account_organization/mapping_handler/utils.js` | When an org’s `organizationType` changes, `updateLinkedOrgTypesIfChanged` uses `getLinkedOrgs(orgID, newImage.organizationType, null)` to sync linked-org type metadata. |
| **Package / service listing** | `package_module/get_available_services` | Calls `getLinkedOrgs(linkedOrgIds)` for addons and packages to enrich service listing with linked-org info. |
| **Services by list** | `package_module/get_services_by_list` | `getLinkedOrgs(orgIds)` to build org map for service results. |
| **User service / addon details** | `package_module/get_user_service_details`, `get_user_addon_service` | `getLinkedOrgs(orgIds)` to attach linked-org details to user’s services/addons. |
| **User active package** | `package_module/get_user_active_package` | `getLinkedOrgs` for addon’s `linkedOrgId` and org IDs. |
| **Purchase history** | `package_module/get_purchase_history` | `getLinkedOrgs(orgIds)` for orgs in purchase history to show linked-org info. |
| **Package access check** | `package_module/get_package`, `get_all_packages` | `isLinkedOrg(organizationID, requestedOrgId)` to allow access only when requester org is linked to the package’s org. |
| **Consultation** | `consultation/invoke_lambda` | Invokes `get_linked_orgs` Lambda (e.g. to show or filter by linked orgs in consultation flows). |

**Package module note:** There, “linked org” often means the org that owns or offers a package/addon (`linkedOrgId` on the package/addon). That is separate from the ORG_LINK relationship; the package module still uses **getLinkedOrgs** (or its own DB.getLinkedOrgs) to resolve org details and to enforce **isLinkedOrg** for package access.
