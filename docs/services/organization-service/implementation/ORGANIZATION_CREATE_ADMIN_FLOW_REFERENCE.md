# Organization Setup Flow Reference (Admin + Health Profile)

This document captures Step 2 of org onboarding: **Organization Setup** (Admin Creation + Health Profile).

## Step Context

- Parent: `TLH-114 Org Onboarding and Metadata`
- UI step: `Organization Setup`
- Sequence position: Step 2 (after `Organisation Details`)

## Repository Mapping

- Documentation repo: `api-hub`
- Endpoint definition repo: `api-hub`
- Service owning endpoint: `apps/user-service`
- Route evidence file: `api-hub/apps/user-service/serverless.yml`

## API Called (Observed for Admin Creation)

- Endpoint: `POST /dev/user`
- Base URL example: `https://e5gv0qum80.execute-api.us-east-1.amazonaws.com`
- Full example: `POST https://e5gv0qum80.execute-api.us-east-1.amazonaws.com/dev/user`

Important:

- This endpoint is **not** part of `organization-service` routes (`/organization/...`).
- It belongs to the `user-service` domain and is used during org onboarding to create the initial admin user.

## Route Evidence (`apps/user-service/serverless.yml`)

Route/function mapping from serverless config:

- Function: `createUser`
- Handler: `src/handlers/createUser.main`
- HTTP event:
  - `path: user`
  - `method: post`

Additional related route in same service:

- `createUserV1` mapped to `POST /v1/user`

## Payload Shape (Functional Summary)

Request body includes:

- `userInfo`
  - `name`, `namePrefix`, `profilePic`
  - `contact.email`, `contact.phoneCode`, `contact.phone`
  - `contact.address` (`address`, `country`, `state`, `city`, `postalCode`, `countryCode`)
  - `department`
- `userRole[]` (role IDs)
- `userType` (example: `STAFF`)
- `definedRoleCode` and `roleName` (example: `ADMIN`)
- `organizationID` (target org for admin creation)

## Health Profile Scope in Step 2

As per updated UI flow, Step 2 also captures multi-select Health Profile fields:

- `Category`
- `Condition`
- `Language`
- `Country of Operation`

Recommended persistence path:

- `PUT /organization/{organizationId}/metadata` for flexible custom fields.
- Or `PUT /organization/{organizationId}` if fields are promoted to first-class org schema fields.

## Expected Data Impact

This step is user-domain write heavy and may also affect org-linked metadata.

Expected writes:

- New user/admin record creation in user domain tables.
- Role association/assignment for that user (`userRole[]`, `roleName`, `definedRoleCode`).
- Organization-user linkage using `organizationID`.

Possible org-linked side effects (implementation-dependent):

- `ORG_DETAILS.adminDetails` update.
- `ORG_DETAILS.modifiedDate` update.

## Validation Checklist (Per Run)

After calling `POST /user`, verify:

1. Admin user record exists for `contact.email`.
2. User is linked to `organizationID`.
3. Requested role mapping is present (`ADMIN` and role IDs from `userRole[]`).
4. Duplicate admin user is not created on retries (idempotency/dup guard check).
5. If org record is touched, compare `ORG_DETAILS` before/after for only intended changes.

## Suggested Artifacts for Loop Page

- API request summary (`POST /user` + payload shape)
- User-domain before snapshot (if available)
- User-domain after snapshot
- Org `ORG_DETAILS` before/after (optional but recommended)
- Delta summary
- Validation checklist result

## Risks / Notes

- Route is outside `organization-service`; troubleshooting usually spans `user-service` + auth + role mapping.
- `organizationID` in payload uses uppercase `ID`, while some org records use `organizationId`; keep this naming difference explicit in docs.
- UI sequence can vary by environment (some flows show an extra step such as `Configure Device & Vitals` after Create Admin).

Security note:

- Do not paste long-lived bearer tokens in shared docs. Redact or rotate tokens before saving.
