# Organization Allocate Modules Flow Reference

This document captures Step 3 of org onboarding: **Allocate Modules**.

## Step Context

- Parent: `TLH-114 Org Onboarding and Metadata`
- UI step: `Allocate Modules`
- Sequence position: Step 3 (after `Organization Setup`)

## Repository Mapping

- Documentation repo: `api-hub`
- Endpoint/infra repo: `Common-Backend`
- Infra evidence file: `Common-Backend/package_module/saml.yaml`

## API Called (Observed)

- Endpoint: `POST /dev/org/{organizationId}/features`
- Example: `/dev/org/mo9n6qxbf30ab20b/features`
- Request body: a large `features[]` payload that carries module, feature, and functionality access metadata.

Important:

- This endpoint is **not** part of the current `organization-service` route set (`/organization/...`).
- It belongs to the package/features domain, but it can still mutate org-linked data consumed by onboarding.

## Route Evidence (`package_module/saml.yaml`)

The endpoint is explicitly defined in package module API Gateway permissions:

- `GET /org/{orgId}/features` via `ListOrgFeaturesLambdaPermission`
- `POST /org/{orgId}/features` via `AssignOrgFeaturesLambdaPermission`

Notes:

- Infra uses `{orgId}` while UI/client examples often use `{organizationId}`.
- Both refer to the same identifier concept (organization ID in path).

## Payload Shape (Functional Summary)

Request body includes:

- `features[]`
  - `moduleType`, `moduleKey`, `moduleDisplayKey`, `moduleApplicableTo`, `moduleStatus`
  - `featureKey`, `displayKey`, `status`
  - `functionalities[]` with `key`, `access`, `allowedRoles`, `dependsOn`, `status`
  - metadata fields such as `groupKey`, `descriptionKey`, `iconName`, `pk`, `sk`, timestamps

## Expected DynamoDB Impact (ORG_DETAILS)

This step can update the existing org primary record:

- Item key remains unchanged:
  - `pk = ORG#{organizationId}`
  - `sk = ORG_DETAILS`
- Common mutation:
  - `modifiedDate` should increase
- Possible config mutations:
  - `organizationSize` normalization/override (for example `"null"` -> `"0"`)
  - `defaultSetting` subfields (for example `languages`) may be overwritten
  - nested `organizationInfo` may be updated in parallel with top-level fields, which can cause drift

## Observed Delta (From Provided Before/After Snapshots)

For org `ORG#mo9n6qxbf30ab20b`:

- `modifiedDate`
  - `1776837529961` -> `1776841695877`
- `organizationSize`
  - top-level: `"null"` -> `"0"`
  - `organizationInfo.organizationSize`: `"null"` -> `"0"`
- `defaultSetting.languages`
  - top-level: populated array -> `[]`
  - `organizationInfo.defaultSetting.languages`: populated array -> `[]`
- `organizationInfo.modifiedDate`
  - present before, absent in after snapshot

Fields that remained stable in your sample:

- `pk`, `sk`, `gsi1pk`, `gsi1sk`
- `status` (`PENDING`)
- `deleted` (`false`)
- `organizationId`, `name`, `traceId`

## Verification Checklist (Per Run)

After calling `/org/{organizationId}/features`, verify:

1. `ORG_DETAILS` item still exists with same `pk` + `sk`
2. `modifiedDate` increased from the previous snapshot
3. No unintended status/deletion changes
4. `defaultSetting` and `organizationInfo.defaultSetting` are both checked for overwrite/drift
5. `organizationSize` and `noOfBranches` are valid values (not `"null"` string unless intentionally used)

## Risks / Notes

- This step can unintentionally overwrite config fields initialized in Step 1.
- Top-level and nested `organizationInfo` values may diverge if both are independently mutated.
- Treat this step as a data-mutating step, not a read-only feature assignment step.

## Suggested Artifacts for Loop Page

Keep these sections under the Loop page:

- API request summary (`POST /org/{orgId}/features` + payload shape)
- Before snapshot (`ORG_DETAILS`)
- After snapshot (`ORG_DETAILS`)
- Delta summary (field-by-field)
- Validation checklist result

Security note:

- Do not paste long-lived bearer tokens in shared docs. Redact or rotate tokens before saving.