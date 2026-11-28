# Partner BFF

This is the Partner Backend-for-Frontend Lambda application. It composes read-only manager screens and the approved vendor-home dashboard; it does not own a database and does not implement booking, assignment, staffing, banking, or visit-execution writes.

## Routes

All routes use the repository's platform API Gateway authorizer (`securedAuthorizer`). The caller must have an eligible platform role and an active vendor membership for the path `vendorId` (owners and staff). Platform admins may select any vendor id.

| Route | Query parameters | Notes |
| --- | --- | --- |
| `GET /partner/{vendorId}/manager/home` | `date?`, `upcomingDays?` (1–7, default 3) | **Approved vendor-home BFF** (`operationId: getVendorHome`) |
| `GET /partner/{vendorId}/manager/work` | `date`, `communityId`, `visitWindowId`, `view=all\|active\|completed`, `pageSize` (1-50), `cursor` | Manager work screen |
| `GET /partner/{vendorId}/manager/planning` | `date`, `communityId`, `visitWindowId`, `tab=unassigned\|assigned\|availability`, `pageSize` (1-50), `cursor` | Manager planning screen |

No `/vendors/{vendorId}/home` alias is exposed. Domain `/vendors/*` routes remain owned by booking-service and vendor-service.

### Vendor home contract (migration)

`GET /partner/{vendorId}/manager/home` now returns the BFF-owned vendor-home payload:

```json
{
  "vendor": { "vendorId": "...", "membership": { "role": "owner|staff", "permissions": [] }, "status": "...", "nextAction": "...", "onboarding": {}, "detailsAcceptance": {} },
  "home": { "date": "YYYY-MM-DD", "timezone": "...", "today": {}, "tomorrow": {}, "upcoming": {} },
  "capacity": { "pendingProposals": [], "commitments": [] },
  "meta": { "generatedAt": "...", "partialData": false, "unavailableSections": [], "dashboardEligible": true }
}
```

The previous `schemaVersion` / `sections` / nested `data.nextAction|todayProgress|...` manager-home shape is **replaced**. Clients must migrate to this contract. Work and planning routes are unchanged.

Behavior highlights:

- Unrelated authenticated callers receive `403`.
- When `nextAction` is not `OPEN_VENDOR_DASHBOARD`, `home` is `null` and capacity widgets are empty (`dashboardEligible: false`).
- Operational `home` loads booking home-summary semantics for **owners and platform admins only**. Staff remain authenticated for vendor context; `home` is omitted and listed under `meta.unavailableSections` (`home`). Booking owner-only policy is not bypassed.
- Capacity proposals/commitments are optional widgets. Failures return `200` with `meta.partialData: true` and `unavailableSections` such as `capacity.pendingProposals`.
- Proposal `actionable` / `isPastDeadline` are derived by the BFF. Drafts are never returned. `REDUCED` / `CANCELLED` commitments are excluded from the home list.

Responses use the platform envelope `{ success, data, meta }`.

## Authentication and trust boundary

There are two independent boundaries:

1. Mobile application → BFF: the existing platform authorizer verifies the Cognito access token and supplies server-side identity, roles, and permissions in `authContext`.
2. BFF → domain services: the BFF calls narrowly scoped **internal HTTP** routes on Booking and Vendor using `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`. The token is the SSM parameter `/{stage}/platform/internal-service-token` (owned by authorizer-service). The user JWT is never forwarded.

The BFF ignores client `vendorId`, `userId`, role, and permission headers for membership. Route `vendorId` is a target selector only. Downstream internal handlers re-check the delegated actor against Vendor membership before returning domain data.

### Downstream HTTP contracts

| Dependency | Method / path | Body |
| --- | --- | --- |
| Vendor membership | `POST {VENDOR_BASE_URL}/internal/operational-access` | `{ userId }` |
| Booking home/work/plan/homeSummary | `POST {BOOKING_BASE_URL}/internal/partner/manager/read` | `{ actor, action, query }` |
| Vendor context / crews / commitments / proposals / labels | `POST {VENDOR_BASE_URL}/internal/partner/manager/read` | `{ actor, includeVendorContext?, includeCrews?, includeCommitments?, includeProposals?, proposalStatuses?, communityIds? }` |

Related public domain routes (composed via the internal adapters above; never called by clients through the BFF):

- Vendor: `GET /vendors/me`, `GET /vendors/{vendorId}/capacity-proposals`, `GET /vendors/{vendorId}/capacity-commitments`
- Booking: `GET /vendors/{vendorId}/home-summary`

## Deploy notes

1. Deploy **authorizer-service** first so `/{stage}/platform/internal-service-token` exists.
2. Deploy **booking-service** and **vendor-service** so the `/internal/*` HTTP routes are live (including `homeSummary` / vendor-home extras).
3. Deploy **partner-bff** with `BOOKING_BASE_URL` and `VENDOR_BASE_URL` set to each service's API Gateway stage base URL (no trailing slash).

## Local verification

```sh
pnpm nx build partner-bff
pnpm exec jest --config apps/partner-bff/jest.config.cts --runInBand
pnpm --dir apps/partner-bff run openapi
pnpm exec serverless package --config apps/partner-bff/serverless.yml --stage dev
```

Generated artifacts are `openapi.json` and `postman.json` in this directory. Approved catalog export also registers `partner-bff` in `api-spec.config.json`.
