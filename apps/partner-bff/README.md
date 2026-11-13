# Partner BFF

This is the existing Partner Backend-for-Frontend Lambda application. It composes read-only manager screens; it does not own a database and does not implement booking, assignment, staffing, banking, or visit-execution writes.

## Routes

All routes use the repository's platform API Gateway authorizer. The caller must have a manager role or manager read permission and an active **owner** vendor membership.

| Route | Query parameters |
| --- | --- |
| `GET /partner/manager/home` | none |
| `GET /partner/manager/work` | `date`, `communityId`, `visitWindowId`, `view=all|active|completed`, `pageSize` (1-50), `cursor` |
| `GET /partner/manager/planning` | `date`, `communityId`, `visitWindowId`, `tab=unassigned|assigned|availability`, `pageSize` (1-50), `cursor` |

Responses use the platform envelope and expose `schemaVersion`, response-wide `asOf`, `timezone`, applied filters, source freshness, section availability, and page cursors. A cursor is bound to the resolved vendor, date, filters, and tab/view; it cannot be reused with another scope.

The BFF uses the existing `Asia/Kolkata` operations calendar because that is the current domain scheduling timezone. It never converts an unknown capacity or dated availability confirmation to zero/true. When community labels or crews fail to load, IDs and core work remain available with the affected section marked unavailable. If issue data fails, no “no blockers” conclusion is made: blocker counts are `null` and the next-action section is unavailable.

## Authentication and trust boundary

There are two independent boundaries:

1. Mobile application → BFF: the existing platform authorizer verifies the application token and supplies server-side identity, roles, and permissions in `authContext`.
2. BFF → domain services: the BFF invokes narrowly scoped, non-HTTP Lambda handlers using the BFF Lambda execution role. AWS Lambda Invoke IAM authenticates the workload using the AWS SDK default credential provider (including rotating execution-role credentials); no user token is forwarded or exchanged.

The BFF ignores client `vendorId`, `userId`, role, and permission headers. It first resolves canonical operational membership through `vendor-service-api-<stage>-getOperationalAccess`. Each direct handler then revalidates the delegated actor and vendor against the same Vendor membership service before reading domain data. Thus IAM permission alone cannot select a vendor outside the user’s current membership.

The execution role is limited to these exact functions for its stage:

- `vendor-service-api-<stage>-getOperationalAccess`
- `vendor-service-api-<stage>-partnerManagerRead`
- `booking-service-<stage>-partnerManagerRead`

The two `partnerManagerRead` handlers have no API Gateway event. They accept only the direct-Lambda payload, are protected by Lambda invocation IAM, and return an error envelope for malformed actor context or unauthorized delegated membership. There is no internal HTTP header bypass, shared secret, user-JWT forwarding, or unauthenticated local fallback.

## Domain read adapters

`booking-service` adds a bounded `partnerManagerRead` Lambda handler for `overview`, `work`, and `planning`. It uses existing date-keyed package-visit repositories, validates filters and opaque cursors, caps an aggregate at 1,500 visits, and returns only the requested page for work/planning. `vendor-service` adds a corresponding handler for crew display data, accepted commitments, and community directory labels.

The explicit `blocksVisit` issue flag is authoritative for the read model and completion guard. An unresolved issue without that flag is not reported as blocking. New blocking issues persist `blockingStartedAt` at the server-side creation instant; manager-home returns that value in `nextAction.blockingStart.at`. Historical rows without the field remain explicitly unavailable rather than treating `issue.createdAt` as a blocker timestamp. For a blocking issue scoped to a community rather than a visit, `affectedVisitCount` is that community's not-started and in-progress visits today.

`todayProgress.currentWindow` is the visit window in progress (aggregated across communities), or the next one to start today, with `state`, `startTime`/`endTime`, `remainingVisits`, and `remainingMinutes` (active) or `minutesUntilStart` (upcoming). It is `null` when no remaining window has valid times. Each assigned crew in `upcomingPlan.groups[].crews[]` now has a dated operational `availability` and `capacity`: Vendor supplies the live roster `availabilityStatus` and `capacityPerDay`, while BFF combines that with Booking's complete daily assigned workload. Capacity is expressed in the Vendor 30-minute slot-unit, not a guessed visit count. `planAhead[].crewCapacity` gives the corresponding daily fleet total.

## Local verification

Build and unit tests do not need AWS credentials because they use explicit test doubles:

```sh
pnpm nx build partner-bff
pnpm exec jest --config apps/partner-bff/jest.config.cts --runInBand
pnpm --dir apps/partner-bff run openapi
pnpm exec serverless package --config apps/partner-bff/serverless.yml --stage dev
```

An actual local invocation needs normal AWS credential resolution with `lambda:InvokeFunction` on the three functions above. Missing function configuration or credentials results in an actionable dependency error; the service never falls back to a public endpoint or unauthenticated mock.

Generated artifacts are `openapi.json` and `postman.json` in this directory. Deployment is intentionally not part of this implementation.
