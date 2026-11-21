# Partner BFF

This is the Partner Backend-for-Frontend Lambda application. It composes read-only manager screens; it does not own a database and does not implement booking, assignment, staffing, banking, or visit-execution writes.

## Routes

All routes use the repository's platform API Gateway authorizer. The caller must have a manager role or manager read permission and an active **owner** vendor membership.

| Route | Query parameters |
| --- | --- |
| `GET /partner/{vendorId}/manager/home` | none |
| `GET /partner/{vendorId}/manager/work` | `date`, `communityId`, `visitWindowId`, `view=all\|active\|completed`, `pageSize` (1-50), `cursor` |
| `GET /partner/{vendorId}/manager/planning` | `date`, `communityId`, `visitWindowId`, `tab=unassigned\|assigned\|availability`, `pageSize` (1-50), `cursor` |

Responses use the platform envelope and expose `schemaVersion`, response-wide `asOf`, `timezone`, applied filters, source freshness, section availability, and page cursors. A cursor is bound to the resolved vendor, date, filters, and tab/view; it cannot be reused with another scope.

The BFF uses the existing `Asia/Kolkata` operations calendar because that is the current domain scheduling timezone. It never converts an unknown capacity or dated availability confirmation to zero/true. When community labels or crews fail to load, IDs and core work remain available with the affected section marked unavailable. If issue data fails, no “no blockers” conclusion is made: blocker counts are `null` and the next-action section is unavailable.

## Authentication and trust boundary

There are two independent boundaries:

1. Mobile application → BFF: the existing platform authorizer verifies the Cognito access token and supplies server-side identity, roles, and permissions in `authContext`.
2. BFF → domain services: the BFF calls narrowly scoped **internal HTTP** routes on Booking and Vendor using `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`. The token is the SSM parameter `/{stage}/platform/internal-service-token` (owned by authorizer-service). The user JWT is never forwarded.

The shared authorizer accepts either a Cognito access token or the internal service token. Internal callers receive principal `internal-service` with role `INTERNAL`. Domain handlers for `/internal/*` assert that principal before reading data, then revalidate the delegated actor's vendor membership.

The BFF ignores client `vendorId`, `userId`, role, and permission headers for membership. Route `vendorId` is a target selector only. Downstream internal handlers re-check the delegated actor against Vendor membership before returning domain data.

### Downstream HTTP contracts

| Dependency | Method / path | Body |
| --- | --- | --- |
| Vendor membership | `POST {VENDOR_BASE_URL}/internal/operational-access` | `{ userId }` |
| Booking home/work/plan | `POST {BOOKING_BASE_URL}/internal/partner/manager/read` | `{ actor, action, query }` |
| Vendor crews / commitments / labels | `POST {VENDOR_BASE_URL}/internal/partner/manager/read` | `{ actor, includeCrews?, includeCommitments?, communityIds? }` |

Related public Postman routes that own the same domain data (not called directly by the BFF composition layer):

- Booking: `GET /vendors/{vendorId}/package-visits`, `GET /vendors/{vendorId}/operations/summary`
- Vendor: `GET /vendors/{vendorId}/crews`, `GET /vendors/{vendorId}/capacity-commitments`, `GET /vendors/{vendorId}/community-directory`

## Domain read adapters

`booking-service` exposes `POST /internal/partner/manager/read` for `overview`, `work`, and `planning`. It uses existing date-keyed package-visit repositories, validates filters and opaque cursors, caps an aggregate at 1,500 visits, and returns only the requested page for work/planning. Planning also carries a whole-scope assigned-workload aggregate in Vendor's 30-minute capacity unit, so capacity never depends on the selected tab or page. `vendor-service` exposes the matching internal route for crew display data, accepted commitments, and community directory labels.

Planning returns `data.capacity.configuredCapacity` from Vendor's currently eligible crews and `effectiveOperationalCapacity` after subtracting Booking's whole-scope assigned workload. Both values include their capacity unit and stay explicitly unavailable if either authoritative input is missing. `acceptedCommitmentCapacity` remains independent: it is `null` when the optional commitment read is unavailable rather than being invented as zero.

The explicit `blocksVisit` issue flag is authoritative for the read model and completion guard. An unresolved issue without that flag is not reported as blocking. New blocking issues persist `blockingStartedAt` at the server-side creation instant; manager-home returns that value in `nextAction.blockingStart.at`. Historical rows without the field remain explicitly unavailable rather than treating `issue.createdAt` as a blocker timestamp. For a blocking issue scoped to a community rather than a visit, `affectedVisitCount` is that community's not-started and in-progress visits today.

`todayProgress.currentWindow` is the visit window in progress (aggregated across communities), or the next one to start today, with `state`, `startTime`/`endTime`, `remainingVisits`, and `remainingMinutes` (active) or `minutesUntilStart` (upcoming). It is `null` when no remaining window has valid times. Each assigned crew in `upcomingPlan.groups[].crews[]` now has a dated operational `availability` and `capacity`: Vendor supplies the live roster `availabilityStatus` and `capacityPerDay`, while BFF combines that with Booking's complete daily assigned workload. Capacity is expressed in the Vendor 30-minute slot-unit, not a guessed visit count. `planAhead[].crewCapacity` gives the corresponding daily fleet total.

## Deploy notes

1. Deploy **authorizer-service** first so `/{stage}/platform/internal-service-token` exists (or set `INTERNAL_SERVICE_TOKEN` to a random value: `openssl rand -hex 32`).
2. Deploy **booking-service** and **vendor-service** so the `/internal/*` HTTP routes are live.
3. Deploy **partner-bff** with `BOOKING_BASE_URL` and `VENDOR_BASE_URL` set to each service's API Gateway stage base URL (no trailing slash).

## Local verification

Build and unit tests do not need AWS credentials because they use explicit test doubles:

```sh
pnpm nx build partner-bff
pnpm exec jest --config apps/partner-bff/jest.config.cts --runInBand
pnpm --dir apps/partner-bff run openapi
pnpm exec serverless package --config apps/partner-bff/serverless.yml --stage dev
```

Missing base URL or internal token configuration yields an actionable dependency error; the service never falls back to an unauthenticated mock.

Generated artifacts are `openapi.json` and `postman.json` in this directory.
