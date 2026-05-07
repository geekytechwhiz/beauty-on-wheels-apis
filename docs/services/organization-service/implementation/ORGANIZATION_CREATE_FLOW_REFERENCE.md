# Organization Create Flow Reference

This document captures the current implementation for creating an organization in `organization-service`.

## Endpoint

- Route: `POST /organization`
- Serverless function: `createOrganization`
- Handler file: `apps/organization-service/src/handlers/createOrganization.ts`

## High-Level Flow

1. Request enters `withLambdaHandler(...)`.
2. `validateCreateOrganization` validates and normalizes payload.
3. Handler resolves `creatorId` from auth context/claims.
4. Handler generates `organizationId` when not provided.
5. Handler calls `RoleRepository.createDefaultRoles(organizationId, authHeader)`.
6. If role creation fails, request throws `CREATE_DEFAULT_ROLES_FAILED` (500).
7. Handler calls `OrganizationService.createOrganization(payload, correlationId)`.
8. Service builds organization record with defaults and derived fields.
9. Repository writes item to DynamoDB with a conditional put (no overwrite).
10. Service publishes `OrganizationCreated.v1` event.
11. Handler returns:
    - `newOrganizationID`
    - `hospitalImage`

## UI Onboarding Sequence (Updated Product Flow)

The current UI onboarding sequence is:

1. `Organisation Details`
2. `Organisation Setup` (Admin Creation + Health Profile)
3. `Allocate Modules`
4. `Linked Organisations`
5. `Agreement & Forms`

How this maps to backend behavior:

- **Step 1: Organisation Details**
  - Creates the base org record (`ORG_DETAILS`) via `POST /organization`.
  - This is the flow documented in this file.
- **Step 2: Organisation Setup**
  - Creates/assigns org admin user in user/role domain (`POST /user`).
  - Captures Health Profile selections (Category, Condition, Language, Country of Operation).
  - Health Profile can be persisted via organization update APIs (`PUT /organization/{organizationId}` or `PUT /organization/{organizationId}/metadata`) based on schema ownership.
- **Step 3: Allocate Modules**
  - Triggers feature/module APIs (for example `/org/{organizationId}/features` in package/features domain).
  - This can update org-linked config fields and `modifiedDate`.
- **Step 4: Linked Organisations**
  - Uses org linking endpoints and writes link records (`ORG_LINK#...`) in organization domain.
- **Step 5: Agreement & Forms**
  - Captures legal/form artifacts (service may vary by environment/integration).

Note: Step 2+ operations can modify the existing `ORG_DETAILS` item, so post-create snapshots may differ from the initial create payload.

## Validation and Normalization

Implemented in `apps/organization-service/src/validation/request.validators.ts`:

- Ensures body exists and is an object.
- Runs `normalizeOrganizationPayload`.
- Defaults `adminDetails` to `[]` if missing.
- Validates against `createOrganizationSchema`.
- Stores normalized payload at `req.validatedCreateBody`.

## Generated and Default Values

From `apps/organization-service/src/services/organization.service.ts`:

- `organizationId`: input value or generated UUID in handler.
- `status`: defaults to `PENDING`.
- `traceId`: auto UUID when not provided.
- `createdAt`: current epoch milliseconds.
- `modifiedDate`: current epoch milliseconds.
- `deleted`: `false`.
- `modifiedBy`: defaults to `ROOT_ADMIN`.
- `organizationInfo.modifiedDate`: injected when `organizationInfo` is object.
- `organizationInfo.organizationID`: injected when `organizationInfo` is object.
- `searchFields`: auto-derived lowercase object when not provided.

## DynamoDB Write (Organization Record)

Table: `organization-table-${stage}` via `ORGANIZATION_TABLE`.

Primary record key:

- `pk = ORG#{organizationId}`
- `sk = ORG_DETAILS`

GSI fields for list access pattern:

- `gsi1pk = ORG_LIST`
- `gsi1sk = ORG#{organizationId}`

Conditional write protection (repository):

- `ConditionExpression: attribute_not_exists(pk) AND attribute_not_exists(sk)`
- Throws `OrganizationAlreadyExistsError` when record already exists.

## Fields Stored on Create

The create path stores all payload-supported org profile fields plus indexing/housekeeping fields:

- Identity/contact: `name`, `email`, `phone`, `address`, `city`, `state`, `country`, `countryCode`, `postalCode`
- Org metadata: `organizationType`, `organizationSize`, `noOfBranches`
- Media/profile: `hospitalImage`, `googleMapsLink`, `hospitalBio`, `licenseNumber`
- Config/content: `scheduleConf`, `defaultSetting`, `goals`, `thresholds`, `workingHours`
- Service/facility: `specialization`, `certifications`, `servicesOffered`, `appointmentType`, `facilityType`, `equipmentAvailable`, `emergencySupport`
- Corporate/wellness: `industryType`, `wellnessPrograms`, `onsiteFacilities`, `employeeCoverage`, `insurancePartnerships`, `remoteWellnessSupport`, `corporateDiscounts`
- Admin/system: `adminDetails`, `modules`, `devices`, `supportedVitals`, `organizationInfo`, `searchFields`
- Business profile: `website`, `taxId`, `registrationNumber`, `description`, `industry`, `size`
- Tracking/indexing: `createdAt`, `createdBy`, `modifiedBy`, `traceId`, `status`, `modifiedDate`, `deleted`, `itemType`, `lsi_createdAt`, `lsi_entityType`, `lsi_organizationType`, `lsi_status`

## Event Published

After successful write, service publishes `OrganizationCreated.v1` with:

- `organizationId`
- `name`
- `email`
- `status`
- `createdDate`
- `correlationId` (when available)

Publisher file: `apps/organization-service/src/events/event.publisher.ts`.

## Failure Points

- Validation failure -> `400 VALIDATION_ERROR` (or `BAD_REQUEST`).
- Default role creation failure -> `500 CREATE_DEFAULT_ROLES_FAILED`.
- Duplicate org key -> `OrganizationAlreadyExistsError` (from conditional put).
- SNS publish failure may fail request depending on runtime credentials/stage behavior in publisher.

## Important Note

Current create flow includes default role creation before org write. If roles succeed but org write fails, there is no compensating rollback in this path.
