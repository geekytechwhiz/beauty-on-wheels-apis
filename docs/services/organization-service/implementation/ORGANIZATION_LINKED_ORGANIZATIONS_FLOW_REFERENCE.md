# Organization Linked Organizations Flow Reference

This document captures Step 4 of org onboarding: **Linked Organizations**.

## Step Context

- Parent: `TLH-114 Org Onboarding and Metadata`
- UI step: `Linked Organisations` / `Linked Organizations`
- Sequence position: Step 4 (after `Create Admin`)

## Repository Mapping

- Documentation repo: `api-hub`
- Endpoint definition repo: `api-hub`
- Service owning endpoint: `apps/organization-service`
- Route evidence file: `api-hub/apps/organization-service/serverless.yml`

## API Called (Observed)

- Endpoint: `POST /dev/organization/link-unlink`
- Base URL example: `https://9qe3rgipg3.execute-api.us-east-1.amazonaws.com`
- Full example: `POST https://9qe3rgipg3.execute-api.us-east-1.amazonaws.com/dev/organization/link-unlink`
- Body example:
  - `fromOrg: "mo9n6qxbf30ab20b"`
  - `toOrg: "mlgcza8l6deac5ff"`
  - `action: "LINK"` (or `UNLINK`)

## Route Evidence (`apps/organization-service/serverless.yml`)

Route/function mapping:

- Function: `linkUnlinkOrganization`
- Handler: `src/handlers/linkUnlinkOrganization.main`
- HTTP event:
  - `path: organization/link-unlink`
  - `method: post`

Related read endpoint in same service:

- `GET /organization/linked`

## Implementation Trace

- Handler: `src/handlers/linkUnlinkOrganization.ts`
- Service method: `OrganizationService.linkUnlinkOrganizations(...)`
- Repository methods:
  - `createLink(fromOrg, toOrg, fromOrgType, toOrgType)`
  - `deleteLink(fromOrg, toOrg)`
  - `createOrgUpdate(organizationId, updates, createdBy)`

## Expected DynamoDB Impact (`organization-table-dev`)

This step does **not** create a new org. It writes link and audit records.

For `action = LINK`:

- Creates two bidirectional link records:
  - `pk = ORG_LINK#{fromOrg}`, `sk = ORG_LINK#{toOrg}`, `itemType = ORG_LINK`
  - `pk = ORG_LINK#{toOrg}`, `sk = ORG_LINK#{fromOrg}`, `itemType = ORG_LINK`
- Creates two org update audit records:
  - `pk = ORG_UPDATES#{fromOrg}`, `sk = UPDATES#{timestamp}`, `itemType = ORG_UPDATE`
  - `pk = ORG_UPDATES#{toOrg}`, `sk = UPDATES#{timestamp}`, `itemType = ORG_UPDATE`

For `action = UNLINK`:

- Deletes both bidirectional `ORG_LINK` records.
- Creates two new `ORG_UPDATE` audit records describing unlink action.

Important behavior:

- Link is allowed only if `toOrg` exists and is `ACTIVE`.
- If either org is missing, request fails.
- Current implementation writes link/audit records; it does not directly modify `ORG_DETAILS` fields in this call path.

## Verification Checklist (Per Run)

After calling `POST /organization/link-unlink`, verify:

1. `ORG_LINK` record exists under both directions for `LINK` action.
2. `ORG_UPDATES` audit entries were created for both orgs.
3. `itemType` values are correct (`ORG_LINK`, `ORG_UPDATE`).
4. `fromOrg` and `toOrg` values are correctly paired in both records.
5. For `UNLINK`, confirm both directional `ORG_LINK` records are removed.

## Suggested Loop Artifacts

- API request summary (`POST /organization/link-unlink` + body)
- Before snapshot (`ORG_LINK#{fromOrg}` and `ORG_LINK#{toOrg}`)
- After snapshot (`ORG_LINK#{fromOrg}` and `ORG_LINK#{toOrg}`)
- `ORG_UPDATES` records (both org IDs)
- Delta summary
- Verification checklist result

## Risks / Notes

- This step is highly stateful: if one side record is missing, linked-org UI can look inconsistent.
- Audit entries are append-only (`UPDATES#{timestamp}`), so each action should add new rows.
- Do not paste long-lived bearer tokens in shared docs. Redact or rotate tokens before saving.
