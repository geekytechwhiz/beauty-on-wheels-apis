# Organization Status Activation Flow Reference

This document captures the onboarding activation step using **Set Organization Status**.

## Step Context

- Parent: `TLH-114 Org Onboarding and Metadata`
- UI stage: typically finalization after `Agreement & Forms`
- Operation: Activate organization

## Repository Mapping

- Documentation repo: `api-hub`
- Endpoint definition repo: `api-hub`
- Service owning endpoint: `apps/organization-service`
- Route evidence file: `api-hub/apps/organization-service/serverless.yml`

## API Called (Observed)

- Endpoint: `POST /dev/organization/status`
- Base URL example: `https://9qe3rgipg3.execute-api.us-east-1.amazonaws.com`
- Full example: `POST https://9qe3rgipg3.execute-api.us-east-1.amazonaws.com/dev/organization/status`
- Body example:
  - `organizationId: "mo9n6qxbf30ab20b"`
  - `status: "ACTIVE"` (allowed: `ACTIVE`, `HOLD`, `DISABLED`)

## Route Evidence (`apps/organization-service/serverless.yml`)

Route/function mapping:

- Function: `setOrgStatus`
- Handler: `src/handlers/setOrgStatus.main`
- HTTP event:
  - `path: organization/status`
  - `method: post`

## Implementation Trace

- Handler: `src/handlers/setOrgStatus.ts`
- Validator: `validateSetOrgStatus` (schema-backed)
- Service method: `OrganizationService.setOrganizationStatus(...)`
- Repository method: `OrganizationRepository.updateOrganizationStatus(...)`

## Expected DynamoDB Impact (`organization-table-dev`)

Primary item affected:

- `pk = ORG#{organizationId}`
- `sk = ORG_DETAILS`

For `status = ACTIVE`:

- `status` -> `ACTIVE`
- `lsi_status` -> `ACTIVE`
- `modifiedDate` -> updated timestamp
- `holdDate` -> removed (if previously present)

For `status = HOLD`:

- `status` -> `HOLD`
- `lsi_status` -> `HOLD`
- `modifiedDate` -> updated timestamp
- `holdDate` -> set to current timestamp

For `status = DISABLED`:

- `status` -> `DISABLED`
- `lsi_status` -> `DISABLED`
- `modifiedDate` -> updated timestamp
- `holdDate` -> removed

## Side Effects

- On `ACTIVE`, service attempts to notify org admins from `adminDetails`.
- Admin contact resolution may read user profile details via user-service (if `adminId` is present).
- This endpoint updates status fields; it does not create `ORG_LINK` records.

## Verification Checklist (Per Run)

After calling `POST /organization/status`, verify:

1. `ORG_DETAILS` item exists for target organization.
2. `status` and `lsi_status` match requested value.
3. `modifiedDate` increased from previous snapshot.
4. `holdDate` behavior is correct for the requested status.
5. No unintended changes to unrelated fields (`organizationId`, `name`, `defaultSetting`, `adminDetails`, link records).

## Suggested Loop Artifacts

- API request summary (`POST /organization/status` + request body)
- `ORG_DETAILS` before snapshot
- `ORG_DETAILS` after snapshot
- Delta summary (`status`, `lsi_status`, `modifiedDate`, `holdDate`)
- Validation checklist result

## Risks / Notes

- If `adminDetails` contains incomplete contact/user identifiers, activation notification may partially fail while status update still succeeds.
- Keep route ownership explicit: this is organization-service status management, not user-service or package/features flow.
- Do not paste long-lived bearer tokens in shared docs. Redact or rotate tokens before saving.
