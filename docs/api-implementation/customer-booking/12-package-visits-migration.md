# Package visits — migration and rollout

## What changed

- **Service Catalog**: optional `includedServices[].serviceKey`, optional `validityDays`, computed `entitlements[]` on offering responses. Published version still increments on composition changes; purchase snapshots remain immutable.
- **Booking**: on plan payment activation, materializes one DynamoDB `PackageVisit` item per entitlement unit under `CUSTOMER_PLAN#{planId}` / `VISIT#{ordinal}#{visitId}`. New visit APIs schedule/reschedule/cancel/start/complete with Availability reservation.
- **Availability**: optional `planId` / `packageVisitId` on slot allocations; package visits reserve with `bookingId = visitId`.

## Legacy one-time bookings

Unchanged. `POST /bookings` and existing booking items keep working. No rewrite of legacy booking rows.

## Legacy customer plans (pre-visit rows)

Plans paid before this deploy may lack `VISIT#` children. Payment replay and a safe backfill both call `createVisitsIfAbsent` (conditional puts). Backfill may:

1. Query GSI1 `CUSTOMER#*` / `PLAN#*` (or scan entityType CustomerPlan in controlled batches).
2. For each paid plan with entitlements and zero visits, call materialize + `createVisitsIfAbsent`.
3. Retry safely — existing visits short-circuit.

Do not invent visits for plans that have `remainingVisits = 0` and no entitlements.

## Rollout

1. Deploy Service Catalog (additive fields).
2. Deploy Availability (additive allocation attributes).
3. Deploy Booking (visit APIs + activation materialization).
4. Optionally run visit backfill for paid plans.

## Rollback

- Disable new visit HTTP routes / feature flag if needed; parent plans and one-time bookings remain readable.
- Do not delete visit rows on rollback if payments already created them — they are additive.
- Availability allocations without `planId`/`packageVisitId` remain valid.

## Product rules (current defaults)

| Topic | Rule |
| --- | --- |
| When visits are created | On successful plan payment (not at draft purchase) |
| When capacity is reserved | When a visit is scheduled / confirm-schedules |
| Entitlement consumption | On `COMPLETED` only (idempotent `entitlementConsumed`) |
| Cancelled visit | Releases reservation; does **not** consume entitlement |
| Missed visit | Status supported; default progress treats missed+consumed like completed; policy for auto-miss is unresolved |
| Cancellation window | Not enforced server-side yet (product TBD) |
| Dates | Staged: visits start `UNSCHEDULED`; vendor confirms per visit or via confirm-schedules |
