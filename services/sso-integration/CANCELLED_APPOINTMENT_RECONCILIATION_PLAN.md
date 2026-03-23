# Cancelled Appointment Reconciliation Plan (Implementation Ready)

## Objective

When sync runs, cancel only those appointments that are:
- present in our system for the same doctor + date range,
- missing in current TruTech data,
- currently in `confirmed` state.

Keep existing create/skip behavior unchanged.

## Final Rules (Locked)

1. Matching uses **only** `time + doctor + patient`.
2. `externalAppointmentId` is **not** used (not persisted reliably).
3. Only `confirmed` records are eligible for cancellation.
4. Cancel API payload uses `userAddonId` as `addonId`.
5. Reconciliation scope is per doctor and scheduler window (`fromDate`/`toDate`).

## Current Flow Reference

- `src/services/appointment-sync.service.ts`
  - `syncAppointments(...)` fetches TruTech appointments and calls `syncDoctorAppointments(...)`.
  - `processOneAppointment(...)` already does create/skip behavior.
- `src/services/appointment-sync/schedule-creation.service.ts`
  - create path already confirms via `/services/update-status` with `scheduleStatus: 'confirmed'`.

Current implementation now uses an asynchronous queue-based reconciliation step.

## Code Changes (Exact)

## 1) Add enqueue step in `syncAppointments(...)` (not inline cancel)

File: `src/services/appointment-sync.service.ts`

Insert after appointment fetch block (`appointmentsInput` or TruTech API).

Required call:

```ts
await this.enqueueCancellationReconciliation(
  appointments,
  context,
  fromDate,
  toDate,
);
```

Then continue current flow unchanged (`syncDoctorAppointments(...)` still runs).

## 2) Add queue publisher + worker flow

File: `src/services/appointment-sync.service.ts`

Add in service layer:

1. `enqueueCancellationReconciliation(appointments, context, fromDate, toDate)`
2. `buildMatchKey(doctorId, patientId, startEpoch, endEpoch)`
3. `publishCancellationReconciliation(payload)`

Add a new queue consumer (same pattern as existing workers):

4. `cancellation-reconciliation-worker` handler
5. `AppointmentSyncService.reconcileMissingAppointmentsAsCancelledFromQueue(...)`
6. `cancelConfirmedScheduleWithRetry(addonId, patientUserId, organizationId, context)`
7. `resolvePatientUserIdFromSchedule(item)`
8. `buildScheduleMatchKey(doctorUserId, patientUserId, scheduleTimeStamp|start/end)`

## 3) Queue message contract (new)

Event payload should include:

```ts
{
  tenantId: string,
  correlationId: string,
  organizationId: string,
  fromDate: string, // or epoch string
  toDate: string,   // or epoch string
  appointments: Array<{
    doctorExternalId: string,
    patientExternalId: string,
    startTime: string,
    endTime: string
  }>
}
```

Notes:
- Keep payload minimal but sufficient for matching.
- If payload size risk exists, publish doctor-wise messages instead of one large message.

## 4) Matching algorithm (mandatory)

Create key from:
- doctor
- patient
- time window

Recommended normalized key format:
- `doctor::<doctorId>|patient::<patientId>|start::<epoch>|end::<epoch>`

Normalization requirements:
- Convert schedule values (`08:30 AM`, `13-03-2026`, etc.) to epoch using schedule timestamp when available.
- Convert TruTech ISO timestamps to epoch.
- Use exact start and end epochs after normalization.

## 5) Worker reconciliation logic (doctor-wise)

Inside `AppointmentSyncService.reconcileMissingAppointmentsAsCancelledFromQueue(...)`:

1. Build doctor groups from TruTech appointments (by external doctor id).
2. Resolve internal doctor user id for each group.
3. Call `fetchSchedules` once for same window + org (no `userId` filter).
4. Split/filter fetched schedules by doctor in memory:
   - doctor source: `assignedStaffId` or `schedule.owner.userId`.
5. Compare doctor-specific schedule keys vs TruTech keys.
6. For missing keys, cancel only confirmed entries.

## 6) Cancellation candidate filter

A fetched schedule is cancellable only if all are true:

1. belongs to current doctor + org + window,
2. status is confirmed (`scheduledStatus === 'confirmed'` or `serviceStatus === 'confirmed'`),
3. match key not found in current TruTech set,
4. payload fields available:
   - `userAddonId`,
   - resolved patient `userId`,
   - `organizationId`.

Skip and warn if any required field is missing.

## `fetch/schedules` Request Shape (Final)

Use:

```ts
{
  fromDate: <epochMs>,
  toDate: <epochMs>,
  organizationID: <orgId>,
}
```

Do not pass `userId` in this request for reconciliation.  
Doctor-level scoping is done after fetch, in memory.

## 7) Cancel API call format

Use existing client method:
- `scheduleClient.updateServiceStatus(...)`

Payload:

```ts
{
  addonId: item.userAddonId,
  type: 'addon',
  userId: patientUserId,
  organizationId: item.organizationId,
  scheduleStatus: 'cancelled'
}
```

Use retry-with-backoff pattern same as confirm flow.

## 8) `fetchSchedules` mapping updates required

File: `src/clients/schedule-service.client.ts`

Ensure mapped objects used by reconciliation include:
- `userAddonId` (from parent item),
- `scheduledStatus`,
- `serviceStatus`,
- `organizationId`,
- `assignedStaffId` / owner doctor id,
- patient user id source:
  - `schedule.meta.userId` (first preference),
  - participant with `userType === 'USER'` (fallback),
- schedule timing source:
  - `schedule.scheduleTimeStamp` or normalized start/end.

## 9) Type updates required

File: `src/types/domain/appointment.types.ts`

Extend `Schedule` (or create reconciliation-specific type) to include:
- `userAddonId?: string`
- `scheduledStatus?: string`
- `serviceStatus?: string`
- `organizationId?: string`
- `assignedStaffId?: string`
- `scheduleTimeStamp?: string`
- `patientUserId?: string`

## 10) Logging and counters

In queue reconciliation path add logs:
- `reconciliation_enqueue_start`
- `reconciliation_enqueue_success`
- `reconciliation_worker_start`
- `reconciliation_schedules_fetched`
- `reconciliation_cancel_candidate`
- `reconciliation_cancel_success`
- `reconciliation_cancel_failed`
- `reconciliation_skip_missing_fields`
- `reconciliation_worker_complete`

Add counters to sync summary (or log-only if response schema unchanged):
- `cancelled`
- `cancelFailed`
- `cancelSkipped`

## 11) Safety and rollout

Add feature flag:
- `ENABLE_CANCELLED_APPOINTMENT_RECONCILIATION=true`

Behavior when disabled:
- no reconciliation, current flow only.

Behavior on reconciliation failure:
- enqueue failure: log error and continue normal create/skip flow.
- worker failure: rely on SQS retry/DLQ policy; avoid duplicate cancel via status guard.

## 12) Test checklist (must pass)

1. TruTech present + our absent -> create + confirmed.
2. TruTech present + our present -> skipped.
3. TruTech absent + our confirmed present -> cancelled.
4. TruTech absent + our cancelled/completed present -> not cancelled again.
5. Missing `userAddonId` or patient user id -> skipped with warning.
6. Multi-doctor payload -> each doctor reconciled independently.
7. Date range boundary appointments -> matched correctly after time normalization.
8. Retry on transient update-status failure -> succeeds or logs cancelFailed.
9. Queue publish failure does not fail appointment creation flow.
10. Worker retry processes message idempotently (no repeated cancel for non-confirmed states).

