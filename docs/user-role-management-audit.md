# User Role Management Audit

Audit date: 2026-10-09

## Findings

| Area | Status | Evidence |
| --- | --- | --- |
| Application role source of truth | Implemented in Identity Service, not User Service | `apps/identity-v1-service/src/repositories/identity.repository.ts` stores one immutable `USER#{userId}/ROLE#{roleId}` record per assignment. `apps/user-service/src/types/records.ts` contains no role field. |
| Multiple roles | Implemented | `getUserRoles` queries all `ROLE#` records; `ensureUserRoleMapping` conditionally creates one mapping and does not replace other mappings. |
| Default CUSTOMER | Implemented | `apps/identity-v1-service/src/services/registration.service.ts` calls `prepareApplicationRolesForToken`, which creates the CUSTOMER mapping. |
| VENDOR role | Implemented | `libs/authentication-core/src/lib/auth/application-roles.ts` recognizes CUSTOMER, VENDOR, and ADMIN. |
| HTTP role API | Partially implemented | `POST /users/{userId}/roles` and `DELETE /users/{userId}/roles/{role}` exist in Identity Service, but accept ADMIN only (`roles.schema.ts`, `roles.service.ts`, and `serverless.yml`). They do not allow customer self-promotion. |
| Event role API | Implemented for the requested MVP transition | Vendor now publishes `Vendor.EmailVerified` only from the authoritative Vendor profile email-verification transition after all onboarding sections are complete. Identity consumes it and adds VENDOR idempotently. |
| Retry, DLQ, idempotency | Implemented | Vendor stream has partial batch failures, three retries, and a DLQ. Identity's EventBridge target has three retries and a DLQ; duplicate role mapping writes return `exists`. |
| Token/authorizer integration | Implemented | Cognito pre-token generation reads the mappings into the access-token `roles` claim (`pre-token-generation.ts`). The custom authorizer always re-reads Identity before authorizing (`libs/authentication-core/src/lib/auth/authenticate.ts`). |

## Changes made

- Added the strict `Vendor.EmailVerified` shared event contract and stable idempotency key.
- Added a Vendor DynamoDB stream publisher. It requires a new `emailVerifiedAt` value and all onboarding sections before emitting the event.
- Changed vendor email verification eligibility to require complete onboarding, so completion cannot be bypassed by verifying an earlier link.
- Added the Identity consumer and routed the existing Identity EventBridge/DLQ infrastructure to `Vendor.EmailVerified` instead of the approval event.
- Centralized role persistence behind `grantUserRole`; both the event path and existing ADMIN HTTP grant use that idempotent mapping operation.

## HTTP API decision

The existing API remains intentionally restricted to ADMIN assignment/removal. A secure HTTP VENDOR grant cannot be implemented from the current repository without an authoritative Vendor Service eligibility endpoint callable through the existing service-principal mechanism. No such endpoint or service-to-service credential contract exists. Accepting client `vendorId` as evidence, or querying Vendor DynamoDB directly from Identity, would violate the security constraints.

Required follow-up for manual VENDOR grants: Vendor Service must expose an internal, service-principal-protected eligibility operation that returns the canonical owner user ID plus completed-onboarding and verified-email state. Identity can then authorize an internal/admin caller and invoke the same `grantUserRole` function used by the event consumer.

## JWT behavior

Existing access tokens do not gain VENDOR automatically. A refresh/login invokes Cognito's pre-token-generation trigger, which issues a fresh `roles: ["CUSTOMER", "VENDOR"]` claim. The authorizer does not trust a stale claim for retained privileges: it intersects it with current Identity mappings on every authorization request. Thus revocations take effect before token expiry; grants require a refreshed token for the new privilege to be usable.

## Verification note

`libs/event-platform` type checking passed. Full application builds are currently blocked by unrelated pre-existing type errors in `libs/utils/src/middleware/error.middleware.ts` and `libs/authentication-core/src/lib/cognito/cognito-user-attributes.ts`. Direct Jest startup is also blocked by the repository's TypeScript/Jest `moduleResolution: bundler` configuration mismatch under the installed Node 18 runtime.
