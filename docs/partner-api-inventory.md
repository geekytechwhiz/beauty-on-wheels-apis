# Partner API inventory

Reviewed against the backend on 2026-10-11. The supplied deployment exports omitted request and response schemas. This inventory uses handlers, Zod validators, services, and tests as the contract.

Examples in `docs/contracts/partner-session.openapi.yaml` and `docs/contracts/partner-session.postman_collection.json` are test-backed. They are not captured responses from a deployed stage.

## Completed workflow

Identity and Vendor stay separate. Call them in this order:

1. `POST {identity}/otp/send` with `{ destination, userType: "VENDOR" }`.
2. `POST {identity}/otp/verify` with `{ destination, otp }`. Save `accessToken` and `refreshToken`.
3. `GET {identity}/me` with `Authorization: Bearer <accessToken>`.
4. `GET {vendor}/vendors/me` with the same token.
5. `GET {vendor}/vendors/{vendorId}/branches` using `vendorId` from step 4.

`POST /auth/refresh-token` takes `{ refreshToken }` and does not use the Authorization header. Refresh after a role change before calling Vendor again, because Vendor authorization reads the access token.

### Mobile mapping

| API field | Client use |
| --- | --- |
| `data.userId` | Local identity id |
| `data.phoneNumber` | Local phone |
| `data.roles` | Application roles `CUSTOMER`, `VENDOR`, `ADMIN` |
| `data.roleId` | Legacy profile role. Ignore for authorization |
| `data.userType` | Registration classification. Not a substitute for `roles` |
| `data.vendorId` plus `data.membership.role` | Owner membership. `owner` only |
| `data.data[].branchId` | Branch id. The list is nested once inside the envelope |
| `data.data[].name` | Branch name |

There is no `capabilities` field and no branch `timeZone`. Do not read `passwordHash`, OTP values, or refresh-token hashes from these responses.

### Additive changes

- `GET /me` now always returns `roles`. Existing fields are unchanged.
- `GET /vendors/me` adds `membership.role: "owner"` only when `hasVendor` is true. The no-vendor body is unchanged.

No published success field was removed or renamed. Error responses again use the platform envelope and the thrown status code. A temporary handler that answered every error with HTTP 400 and `{ title, description, severity }` was restored to that envelope. Zod validation is HTTP 400 with `error.code` `VALIDATION_ERROR`.

## Reconciliation

| Service | Method:endpoint | Partner screen/action | Existing request/response contract | Gap | Required change | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| Identity | POST /otp/send | Start or resend OTP | Existing and compatible. Body `destination` required; `userType` optional `CUSTOMER` or `VENDOR`, default `CUSTOMER`. HTTP 200 envelope, `data.success` and `data.referenceId`. TTL 5 minutes. OTP is not returned. Public. | Older swagger text said 202. | None. Mobile sends `userType: "VENDOR"`. | Done |
| Identity | POST /otp/verify | Establish session | Existing and compatible. Body `destination`, `otp` (1–12). HTTP 200 `accessToken`, `refreshToken`, `expiresIn`, `tokenType: "Bearer"`. A new identity receives the challenge `userType` as its application role. Invalid OTP is 400 `INVALID_OTP`. Inactive account is 403 `ACCOUNT_NOT_ACTIVE`. | Response has no vendor, branches, or session id. | None in Identity. Mobile calls Vendor next. | Done |
| Identity | POST /auth/refresh-token | Refresh access | Existing and compatible. Body `refreshToken`. Public. HTTP 200 tokens. 401 `INVALID_REFRESH_TOKEN` or `USER_INACTIVE`. | None for this workflow. | None. | Done |
| Identity | GET /me | Current identity | Existing and compatible. Bearer token. HTTP 200 identity fields plus `roles`. 401 `UNAUTHORIZED`. 404 `USER_NOT_FOUND`. | No `capabilities`. `roleId` is not an application role. | Mobile maps `userId` and `phoneNumber`. | Done |
| Vendor | GET /vendors/me | Owner membership | Existing; backend enhancement required for staff. Bearer token. Owner: `hasVendor`, `vendorId`, `status`, `onboarding`, `nextAction`, `membership.role: "owner"`. No owner: `hasVendor: false`, `nextAction: "START_ONBOARDING"`, no `membership`. 401 when unauthenticated. | Staff linked by `userId` are not resolved. No permitted branch ids and no capabilities on this resource. | Staff membership remains a later change. Branches are the next call. | Done for owners |
| Vendor | GET /vendors/{vendorId}/branches | Permitted branches | Existing; mobile mapping required. Owner receives every branch. Admin may read another vendor. Other callers get 403 `FORBIDDEN`. Missing id is 400. Unknown vendor is 404. Payload is `data.data[]` with `branchId`, `name`, `isPrimary`, optional phone, email, address, geo. No pagination. | No `timeZone`. No staff branch filter, because staff rows do not store branches. | Mobile maps `branchId` to id and `name` to name. | Done for owners |
| Identity | POST /auth/logout | Logout | Existing; mobile mapping required. Bearer token. Handler returns HTTP 200 with `data: null`. Cognito sign-out and all sessions are revoked. Swagger text says 204. | Status text in serverless disagrees with the handler. | Document 200. Do not treat swagger 204 as the contract. | Later |
| Identity | GET /sessions | List sessions | Existing; backend enhancement required. Bearer token. Returns session records, including `refreshTokenHash`. | Sensitive hash is on the wire. Shape is not `{ id, label, detail, current }`. | Redact the hash before Partner uses this list. | Later |
| Identity | DELETE /sessions/{sessionId} | Revoke one session | Existing and compatible. Caller can revoke only their own session. 404 `SESSION_NOT_FOUND`. 401 without a user. | None for ownership. | None in this batch. | Later |
| Identity | POST /auth/change-password | Change password | Existing and compatible. Bearer token. Body `oldPassword`, `newPassword`. | Password policy is the service implementation, not a published strength schema. | None in this batch. | Later |
| Vendor | POST /vendors | Create vendor | Existing; mobile mapping required. Bearer token. Zod requires `businessName`, `contactName`; `vendorType` is `INDIVIDUAL` or `BUSINESS`. One vendor per owner. | UI `{ businessName, businessType }` does not match. | Mobile sends `contactName` and `vendorType`. | Later |
| Vendor | GET/PUT/PATCH /vendors/{vendorId}/onboarding | Onboarding draft | Existing; mobile mapping required. Sectioned draft: `BUSINESS_INFO`, `OWNER_DETAILS`, `ADDRESS`, `BRANCH`, `DOCUMENTS`, `BANK_DETAILS`. | UI flat field names are not the request body. | Map each step to `section` plus that section's Zod object. | Later |
| Vendor | POST /vendors/{vendorId}/documents/upload-url and complete | Document upload | Existing; backend enhancement required. Routes and document Zod exist. | Required types, checksum, and scan lifecycle were not re-verified in this batch. | Do not submit documents until that contract is confirmed. | Later |
| Vendor | GET /vendors/{vendorId}/documents | Document list | Existing; backend enhancement required. Route exists. | Pagination and download metadata were not re-verified here. | Confirm before the documents screen. | Later |
| Vendor | POST /vendors/{vendorId}/submit-review | Submit for review | Existing; backend enhancement required. Route exists. | Preflight error body was not published in this batch. | Confirm before submit. | Later |
| Vendor | GET /vendors/{vendorId}/status-history | Status history | Existing; mobile mapping required. Route exists and is owner/admin scoped with other vendor reads. | UI actor/reason shape was not mapped here. | Map after reading the history presenter. | Later |
| Vendor | GET/PATCH /vendors/{vendorId} | Business profile | Existing; mobile mapping required. GET returns the vendor profile without bank secrets. PATCH has a Zod update schema. | UI `{ name, email, phone }` is not the field set. | Map `businessName`, `email`, `phoneNumber`. | Later |
| Vendor | GET/PUT /vendors/{vendorId}/bank-details | Bank account | Existing; mobile mapping required. Responses mask the account number. | UI holder/account/IFSC names differ from `accountHolderName`, `accountNumber`, `ifscCode`. | Use the bank Zod schema. Do not expect the full account number back. | Later |
| Vendor | POST /vendors/{vendorId}/branches | Create branch | Existing; mobile mapping required. Zod: `name` required; phone, email, address, geo, `isPrimary` optional. | UI community and daily capacity are not branch fields. | Send `name` and address. Capacity is not this resource. | Later |
| Vendor | GET/POST /vendors/{vendorId}/service-areas | Coverage | Existing; backend enhancement required. Zod create/update exists. | Not proven to be the onboarding "service community" field. | Do not bind that field to this route yet. | Later |
| Vendor | GET/POST/PUT /vendors/{vendorId}/communities | Communities | Existing; backend enhancement required. Replace and add schemas exist. | Partner has no community search client. | Leave unused until a community picker exists. | Later |
| Catalog | GET /services | Browse services | Existing; backend enhancement required. Route is in service-catalog. | Category, search, and pagination were not re-verified. Partner still reads a fixture. | Confirm the catalog DTO before replacing the fixture. | Later |
| Vendor | GET/PUT /vendors/{vendorId}/services | Linked services | Existing; backend enhancement required. Replace schema exists. | Not proven to be the offering-approval resource. | Do not use it as offering review. | Later |
| Vendor | GET/PUT /vendors/{vendorId}/packages | Linked packages | Existing; mobile mapping required. Routes and replace schema exist. | No Partner package screen. | Leave unused. | Later |
| Vendor | GET /capabilities and vendor capabilities | Capability claims | Existing; backend enhancement required. Catalog and vendor claim routes exist. | UI free text is not a capability id. | Do not submit notes to this route. | Later |
| Vendor | Staff CRUD | Team | Existing; backend enhancement required. Create/update Zod: `name`, `phoneNumber`, optional `userId`, `email`, `role`, `status` `ACTIVE` or `INACTIVE`. No branch array. | Invitation route is not implemented. Staff cannot resolve membership from `GET /vendors/me`. | Keep team screens on fixtures. | Later |
| Booking | GET /vendors/{vendorId}/bookings | Job queue | Existing; backend enhancement required. Authorizer is present. Same handler as `GET /bookings` and `GET /customers/{customerId}/bookings`. Query `customerId` or `vendorId` also filters `GET /bookings`. | Service does not check vendor ownership or branch scope. No pagination schema. Zod body is not used on GET. | Do not ship the queue until ownership is enforced. | Later |
| Booking | GET /bookings/{bookingId} | Job detail | Existing; backend enhancement required. Authorizer is present. | Detail DTO and vendor/branch authorization were not proven. | Read the booking presenter before mapping the screen. | Later |
| Booking | POST confirm, check-in, start, complete, cancel | Job transitions | Existing; backend enhancement required. Authorizer is present. No request body is validated. Transitions: `CREATED` or `PENDING` to `CONFIRMED` or `CANCELLED`; `CONFIRMED` to `CHECKED_IN` or `CANCELLED`; `CHECKED_IN` to `IN_PROGRESS`; `IN_PROGRESS` to `COMPLETED`. Response is `{ id, bookingStatus }`. Create/update use `BookingSchema`. Status values are the existing uppercase codes. | UI notes, verification booleans, and cancel reason have no request fields. | Do not send those fields. They are ignored only if a body is rejected; these routes do not run the booking Zod schema. | Later |
| Booking | Assign, checklist, photos, issue report | Job extras | Missing capability. | No routes. | Do not map these to cancel or vendor documents. | Later |
| Vendor | GET/PUT /vendors/{vendorId}/operating-hours | Weekly hours | Existing; mobile mapping required. Body `{ operatingHours: [{ dayOfWeek, closed, openTime?, closeTime? }] }`. Days are `MONDAY`–`SUNDAY`. Times are `HH:mm`. Vendor-scoped, not branch-scoped. | UI weekday `0..6` and branch id do not match. | Map day names. Do not send a branch id here. | Later |
| Availability | GET/PUT /vendors/{vendorId}/working-hours | Weekly hours | Existing; backend enhancement required. Separate from vendor operating hours. Zod allows optional `dayOfWeek` `MON`–`SUN`, `openTime`, `closeTime`. No `closed` flag. Authorizer is present. | Two hour resources exist. | Pick one resource before the hours screen. | Later |
| Availability | GET/POST /vendors/{vendorId}/slots, GET /slots/{slotId}, POST /slots/{slotId}/block, POST /slots/{slotId}/unblock | Slots | Existing; backend enhancement required. Routes and authorizer exist. `slots.schema.ts` exports no validator. | Request and response DTOs are not published. | Do not treat the UI slot fixture as the contract. | Later |
| Availability | GET/POST /vendors/{vendorId}/holidays | Closures | Existing; backend enhancement required. Routes and authorizer exist. `holidays.schema.ts` exports no validator. | Date, reason, and booking side effects are not published. | Do not ship holiday create from the fixture. | Later |
| Operations | Alerts, notification preferences | Inbox and reminders | Missing capability. | No routes in the inspected services. | Keep local. | Later |
| Finance | Earnings and payouts | Finance screens | Missing capability. | No ledger or payout routes in the inspected services. | Keep local. Masked bank display stays on vendor bank details. | Later |
| Support | Support request | Help form | Missing capability. | No route. | Confirmation must not invent a reference. | Later |
| Offering | Offering requests and pause/resume | Offerings | Missing capability. | Vendor service and package routes are not this workflow. Postman-only paths are not implemented. | Leave on fixtures. | Later |
| Catalog | Request a new shared service | Catalog expansion | Missing capability. | `POST /services` is not a Partner request API. | Do not call it from Partner. | Later |
| Vendor | POST /vendors/{vendorId}/staff/invitations | Invite staff | Missing capability. | Staff create is immediate CRUD, not an invitation. | Do not call a path that is not in serverless. | Later |

## Tests

Focused Jest runs, not deployed calls:

- Identity `services.spec` and `otp.schema.spec`: OTP validation, verify tokens, current identity roles, and unauthenticated `/me`.
- Vendor `vendors.service.spec`, `branches.service.spec`: membership success and 401; branch success, 401, cross-vendor 403, admin allow, missing id, and unknown vendor.
- Utils `error.middleware.spec`: validation errors keep HTTP 422 when the thrown status is 422. Zod request validation is HTTP 400.

## Remaining gaps

- Staff cannot complete membership or a branch-scoped list.
- Branch responses have no time zone.
- `GET /sessions` still returns `refreshTokenHash`.
- Booking list and transitions are authorized at the gateway but not scoped to the caller's vendor or branch in the service.
- Availability slots and holidays have routes and no Zod request schema.
- Onboarding, documents, offerings, finance, alerts, and support stay out of this batch.
