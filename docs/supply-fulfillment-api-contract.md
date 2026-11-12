# Supply & Fulfilment API contract

The admin Supply & Fulfilment screen is composed from Vendor, Booking, Service Catalog, User, and Availability. There is no Supply service and no `/supply/*` route. The admin app’s current calls to Availability `/supply/metrics`, `/supply/capacity-windows`, `/supply/proposals`, `/supply/allocations`, `/supply/sales-controls`, `/supply/dispatch-orders`, and `/supply/proposals/{id}/decision` are not implemented. Use the operations below.

Shared TypeScript models: `docs/contracts/supply-fulfillment.types.ts`.

Authentication is the existing Cognito custom authorizer on each service. These routes do not add API keys, IAM auth, or a new permission model. Vendor-scoped routes still reject a caller who does not own that vendor, except where the existing admin check already allows a platform admin.

`items.length` on a paginated list is the page size. A response with `totalAvailability: "unavailable"` or `populationTotal: null` is not a population total.

## Screen mapping

| Screen area | Read | Write | Owning service |
| --- | --- | --- | --- |
| Active communities | `GET /communities?status=active` | existing community update | User |
| Approved / operational vendors | `GET /vendors?status=…&operationalStatus=…` | existing vendor review | Vendor |
| Capacity windows | commitments + demand, joined by the client | proposals and change requests | Vendor + Booking |
| Proposals | `GET /capacity-proposals` | create, send, revise, accept-counter, decline | Vendor |
| Allocation | sales controls + the commitments they reference | `PUT /admin/packages/{packageId}/sales-controls/{communityId}` | Catalog + Vendor |
| Sales controls | `GET /admin/sales-controls` | the same PUT | Catalog |
| Dispatch | `GET /ops/dispatch/package-visits` | existing `PUT /vendors/{vendorId}/package-visits/assignments` | Booking |
| Open issues | `GET /ops/issues` | triage, assign, request-action, resolve | Booking |

## Overview metrics

| Metric | Authoritative service | How to derive it | When it is unavailable |
| --- | --- | --- | --- |
| Active communities | User `GET /communities?status=active` | Count items only after `pagination.hasMore` is false on the last page | Any unread page. `items.length` is not the count. `pagination.total` is null. |
| Approved and operational vendors | Vendor `GET /vendors` | Same exhaustion rule, with `status` and `operationalStatus` filters. Do not count onboarding baseline capacity. | Any unread page. |
| Committed supply | Vendor commitments | Sum `quantity` for holding statuses (`ACTIVE`, `CHANGE_PENDING`, `REDUCED`) whose window overlaps the range. `quantity` is slot-units per service-window day. | Cross-vendor `GET /ops/capacity-commitments` when `coverage?.includesLegacyRows` is false, unless every vendor was also read from `GET /vendors/{vendorId}/capacity-commitments`. |
| Demand | Booking `GET /ops/demand/package-visits` | Use `totals.demandSlotUnits` only when `completeness` is `indexedRows` and the caller accepts the index-coverage reason. | `completeness` is `unavailable`, or visits saved before the operations schedule index have not been rewritten. |
| Supply gap | composed | `demandSlotUnits - committed quantity` for the same community and an overlapping service window. | Either side is unavailable. Do not fill the gap from availability slots or demo data. |
| Open operations issues | Booking `GET /ops/issues` | Use `pagination.total` only when `totalAvailability` is `complete`. | `mayHaveMore` is true. |

## Vendor Service

### Reused

- `GET /vendors` and `GET /vendors/{vendorId}` for partner filters.
- Vendor capability and community-coverage reads already on the vendor API for eligibility.
- `GET /capacity-proposals`, `POST /capacity-proposals`, `GET /capacity-proposals/{proposalId}`.
- `POST /capacity-proposals/{proposalId}/send`.
- `POST /capacity-proposals/{proposalId}/ops/revise`.
- `POST /capacity-proposals/{proposalId}/ops/accept-counter`.
- `POST /capacity-proposals/{proposalId}/ops/decline`.
- `GET /vendors/{vendorId}/capacity-commitments` — complete base-table list for one vendor.
- `GET /vendors/{vendorId}/capacity-change-requests`.
- `GET /ops/capacity-change-requests`.
- `POST /ops/capacity-change-requests/{requestId}/approve`.
- `POST /ops/capacity-change-requests/{requestId}/reject`.

State changes already use an `Idempotency-Key` and a version condition. The list response for ops change requests now includes `pagination.totalAvailability` so a 100-row cap is not reported as the population.

### Added: `GET /ops/capacity-commitments`

Use case: Capacity tab and supply-gap math across vendors.

Query: `vendorId`, `communityId`, `status` (`ACTIVE`, `CHANGE_PENDING`, `REDUCED`, `CANCELLED`), `fromDate` + `toDate` (window overlap, both required together), `dailyWindowStart`, `dailyWindowEnd` (`HH:mm` exact match on the stored daily window), `limit`, `cursor`.

The stored service window is a date range plus a daily clock. It is not the labels Weekend, Morning, or Night. Map those labels in the client only when they correspond to a known daily window.

With `vendorId`, the read is that vendor’s base table and `coverage?.includesLegacyRows` is true. Without `vendorId`, the read is the operations index. Commitments created before that index, and never updated, are absent.

```json
{
  "data": {
    "items": [
      {
        "commitmentId": "cmt-1",
        "proposalId": "cpr-1",
        "vendorId": "vendor-1",
        "communityId": "community-1",
        "scope": { "offeringId": "pkg_exterior_wash", "label": "Exterior wash" },
        "window": {
          "startDate": "2026-11-01",
          "endDate": "2026-11-30",
          "dailyWindow": { "startTime": "06:30", "endTime": "09:30" }
        },
        "quantity": 30,
        "rate": { "amountMinor": 14000, "currency": "INR" },
        "status": "ACTIVE",
        "reservedSoldQuantity": 12,
        "createdAt": "2026-11-01T00:00:00.000Z",
        "updatedAt": "2026-11-01T00:00:00.000Z"
      }
    ],
    "pagination": { "nextCursor": null, "hasMore": false },
    "coverage": {
      "path": "operationsIndex",
      "includesLegacyRows": false,
      "pageIsPopulation": false,
      "populationTotal": null,
      "reason": "Cross-vendor rows come from the operations index."
    }
  }
}
```

`reservedSoldQuantity` is slot-units already held or sold against the commitment. It is not a substitute for Booking demand.

Model: `OpsCapacityCommitmentListResponse` in `docs/contracts/supply-fulfillment.types.ts`. OpenAPI model: `OpsCapacityCommitmentListResponse`.

## Booking Service

### Reused

- `GET /ops/issues`
- `POST /ops/issues/{issueId}/triage`
- `POST /ops/issues/{issueId}/assign`
- `POST /ops/issues/{issueId}/request-action`
- `POST /ops/issues/{issueId}/resolve`
- `POST /ops/package-visits/{visitId}/completion-review`
- `GET /vendors/{vendorId}/package-visits`
- `GET /vendors/{vendorId}/package-visits/summary`
- `GET /vendors/{vendorId}/package-visits/assignments`
- `PUT /vendors/{vendorId}/package-visits/assignments`
- `DELETE /vendors/{vendorId}/package-visits/{visitId}/assignment`

Platform admins already pass the vendor operations check, so dispatch assignment stays on the vendor assignment route. No second assignment API was added. Crew assignment does not create or change a capacity commitment.

`GET /ops/issues` now returns `pagination.total` only when every selected status partition was fully read. Otherwise `total` is null and `totalAvailability` is `unavailable`.

### Added: `GET /ops/dispatch/package-visits`

Use case: Dispatch tab across vendors.

Query: `date` (required, `YYYY-MM-DD`), `communityId`, `vendorId`, `visitWindowId`, `status`, `search` (registration, service name, or visit id), `limit` (1–100, default 50), `cursor`.

Persistence: scheduled package visits are written to Booking `GSI4` (`OPS_SCHEDULE#{date}`). Unscheduled visits are not in this index. Visits last saved before the index exist on the vendor-scoped routes and appear here after their next save.

```json
{
  "definition": "Operations dispatch queue of scheduled package visits across vendors.",
  "items": [
    {
      "visitId": "visit-1",
      "planId": "plan-1",
      "vendorId": "vendor-1",
      "communityId": "community-1",
      "visitWindowId": "morning",
      "visitWindowName": "Morning",
      "status": "SCHEDULED",
      "scheduledDate": "2026-11-03",
      "startTime": "08:00",
      "serviceName": "Exterior wash",
      "durationMinutes": 45,
      "slotUnits": 2,
      "registrationNumber": "KL07AB1234",
      "assignedCrew": { "crewId": "crew-1", "assignedAt": "2026-11-02T10:00:00.000Z" }
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false,
    "total": null,
    "totalAvailability": "unavailable",
    "totalReason": "items.length is not the day’s visit population."
  },
  "coverage": {
    "source": "packageVisitOpsScheduleIndex",
    "includesVisitsWrittenBeforeIndex": false,
    "reason": "Visits saved before the operations schedule index are absent."
  }
}
```

`assignedCrew` is who is rostered onto the visit. It is not capacity allocation.

### Added: `GET /ops/demand/package-visits`

Use case: needed supply for the Capacity and Allocation tabs.

Query: `communityId`, `fromDate`, `toDate` (max 31 days), optional `visitWindowId`.

`demandVisits` counts `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, and `MISSED`. `CANCELLED` is reported and excluded from demand. `UNSCHEDULED` entitlements are excluded. `demandSlotUnits` uses 30-minute rounding, matching Vendor `quantity`.

If the indexed read exceeds 5,000 visits, `totals` is null and `completeness` is `unavailable`. A partial count is not returned.

```json
{
  "communityId": "community-1",
  "fromDate": "2026-11-01",
  "toDate": "2026-11-07",
  "definition": "Booked package-visit demand.",
  "unit": {
    "name": "slotUnit",
    "minutes": 30,
    "compareWith": "Vendor Service commitment quantity for an overlapping service window."
  },
  "completeness": "indexedRows",
  "completenessReason": "Visits written before the operations schedule index are omitted.",
  "totals": {
    "demandVisits": 12,
    "demandSlotUnits": 18,
    "scheduled": 8,
    "inProgress": 1,
    "completed": 2,
    "missed": 1,
    "cancelled": 0
  },
  "byWindow": [
    {
      "visitWindowId": "morning",
      "visitWindowName": "Morning",
      "demandVisits": 12,
      "demandSlotUnits": 18,
      "scheduled": 8,
      "inProgress": 1,
      "completed": 2,
      "missed": 1,
      "cancelled": 0
    }
  ]
}
```

Until pre-index visits are rewritten, do not present `demandSlotUnits` as the full historical population. The completeness reason is the unavailable-source statement for that gap.

## Service Catalog

### Reused

- `GET /admin/packages`
- `PUT /admin/packages/{packageId}/sales-controls/{communityId}`

The PUT body is now declared as `SalesControlRequest`:

```json
{
  "enabled": false,
  "expectedVersion": 2,
  "reason": "Capacity gap of 10 visits. Hold checkout until the backup commitment is accepted.",
  "fulfilmentVendorIds": ["vendor-1"],
  "capacityCommitmentIds": ["cmt-1"]
}
```

`expectedVersion` is required when the row exists and omitted when it does not. `effectiveFrom` / `effectiveUntil` may be omitted or sent as `null` to leave the window unbounded. The write checks an active community, approved vendor coverage, and linked capacity commitments before `enabled: true`: each `capacityCommitmentId` must exist, still hold supply (`ACTIVE` / `CHANGE_PENDING` / `REDUCED`), match the sales-control community, belong to a `fulfilmentVendorIds` entry, and have `scope.offeringId` equal to the package id. Commitments missing `offeringId` (legacy `serviceScopeCode`-only rows) cannot open sales until migrated. Every fulfilment vendor must have at least one linked holding commitment. It does not edit the package definition, vendor capabilities, or the User Service community. Proposal acceptance alone never opens customer sales.

### Added: `GET /admin/sales-controls`

Use case: Sales Controls tab, and the package/community side of Allocation.

Query: `packageId`, `communityId`, `status` (`open`, `held`, `scheduled`, `expired`, `enabled`, `disabled`), `limit` (default 25), `offset`.

`eligibility` is the current checkout state:

- `open` — enabled and inside the effective window
- `held` — `enabled` is false
- `scheduled` — enabled, `effectiveFrom` is still in the future
- `expired` — enabled, `effectiveUntil` has passed

`total` is the filtered population. `items.length` is the page. The read walks stored sales-control rows (one package, or every package up to 200). Above that cap the call returns 409 and asks for `packageId` instead of a partial total.

`packageName` is the catalog label. `communityId` is not copied from User Service; load the name with `GET /communities/{communityId}`.

```json
{
  "items": [
    {
      "packageId": "pkg_1",
      "packageName": "Weekend Exterior",
      "communityId": "community-1",
      "enabled": false,
      "eligibility": "held",
      "reason": "Capacity gap of 10 visits. Hold checkout until the backup commitment is accepted.",
      "fulfilmentVendorIds": ["vendor-1"],
      "capacityCommitmentIds": ["cmt-1"],
      "version": 2,
      "updatedAt": "2026-11-02T00:00:00.000Z"
    }
  ],
  "total": 1,
  "pagination": {
    "limit": 25,
    "offset": 0,
    "nextOffset": null,
    "hasMore": false,
    "totalAvailability": "complete",
    "totalReason": "total is the filtered sales-control population, not the page length."
  }
}
```

## Allocation

Allocation is not a new record.

The screen’s package, community, primary vendor, backup vendor, and checkout lock are the sales-control row:

- `fulfilmentVendorIds[0]` is the primary vendor
- the next id, when present, is the backup vendor
- `eligibility !== "open"` is the lock (`isLocked`)
- `capacityCommitmentIds` are the committed-supply rows, read from Vendor Service

`neededVisits` is Booking `demandSlotUnits` for that community and window. `acceptedVisits` is the sum of overlapping commitment `quantity` values for those ids. `assignedCrewCount` comes from the dispatch visit list and is not stored as allocation.

Creating a second allocation table would duplicate the commitment and the sales control, so no allocation route was added.

## User Service

Reused without a new route:

- `GET /communities` — `search`, `status` (`active`, `inactive`, `all` for an admin), `cityId`, `localityId`, `postalCode`, `limit`, `cursor`
- `GET /communities/{communityId}` — admin community detail

Customers still receive only active directory rows. The list response now states that `total` is unavailable so a page is not the active-community count.

Community status stays in User Service. Coverage approval stays in Vendor Service. Sales eligibility stays in Catalog. Those records are not copied.

## Availability Service

Reused, unchanged:

- `GET /communities/{communityId}/availability` — bookable community occurrences
- `GET /vendors/{vendorId}/availability` — bookable vendor availability
- `GET /vendors/{vendorId}/slots` — slot inventory
- `GET /vendors/{vendorId}/working-hours` — operating hours

These are bookable time, not committed vendor supply. No operations supply route was added here.

## Migration

1. Stop calling Availability `/supply/*`.
2. Load each tab from the owning service in the table above.
3. Treat commitment and demand totals as unavailable while `includesLegacyRows` or `includesVisitsWrittenBeforeIndex` says older rows are missing. Rewriting a commitment (accept, change-request decision) or a package visit puts that row on the new index.
4. Deploy Booking with `GSI4` before relying on dispatch or demand. New and updated package visits populate the index; older visits do not until they are saved again.
5. Keep crew assignment on `PUT /vendors/{vendorId}/package-visits/assignments`.
