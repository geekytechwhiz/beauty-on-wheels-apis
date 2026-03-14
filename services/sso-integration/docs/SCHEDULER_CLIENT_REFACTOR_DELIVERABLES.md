# Scheduler Client Refactor – Deliverables

This document describes the refactor that removes DynamoDB tables from the HMS Sync (sso-integration) microservice and delegates all pending-appointment and idempotency storage to the **Scheduler service** via **ScheduleServiceClient**.

---

## 1. Summary of Code Changes

### 1.1 Removed

- **PendingAppointmentsTable** and **AppointmentIdempotencyTable** from `serverless.yml` (resource definitions, env vars, IAM statements).
- **pending-appointment-store.ts** – DynamoDB-backed `DynamoDbPendingAppointmentStore` and `getPendingAppointmentStore()`.
- All direct DynamoDB usage in this service for pending appointments and idempotency.

### 1.2 ScheduleServiceClient (SchedulerClient) – New Methods

In `src/clients/schedule-service.client.ts` the following methods were added. They call **Scheduler service** HTTP APIs (base URL: `SCHEDULE_SERVICE_API_URL`).

| Method | Purpose |
|--------|---------|
| `storePendingAppointment(tenantId, pending, context)` | Store a pending appointment in the Scheduler service. |
| `getPendingAppointmentsByPatient(tenantId, patientExternalId, context)` | Get all pending appointments for a patient. |
| `removePendingAppointment(tenantId, patientExternalId, externalAppointmentId, context)` | Remove one pending appointment after successful processing. |
| `updatePendingAppointmentRetryCount(tenantId, patientExternalId, externalAppointmentId, retryCount, context)` | Update retry count when reprocess fails (below max retries). |
| `checkAppointmentIdempotency(tenantId, appointmentExternalId, context)` | Returns `{ alreadyProcessed, scheduleId? }`. Used before creating a schedule. |
| `markAppointmentProcessed(tenantId, appointmentExternalId, scheduleId, context)` | Record that an appointment was processed (after schedule creation). |

**API paths used (Scheduler service must implement these):**

- `POST /internal/pending-appointments` – store pending
- `GET /internal/pending-appointments?tenantId=&patientExternalId=` – list by patient
- `DELETE /internal/pending-appointments?tenantId=&patientExternalId=&externalAppointmentId=` – remove one
- `PATCH /internal/pending-appointments/retry-count` – update retry count
- `POST /internal/appointment-idempotency/check` – check idempotency
- `POST /internal/appointment-idempotency/mark` – mark processed

### 1.3 Service and Handler Updates

- **PendingAppointmentService** – Now takes `ScheduleServiceClient` instead of `IPendingAppointmentStore`. All add/get/remove/updateRetryCount go through the client. Methods that call the client take `SSORequestContext` for correlation and auth headers.
- **schedule-idempotency-store.ts** – No longer uses DynamoDB. `getScheduleIdempotency(tenantId, appointmentExternalId, context)` and `setScheduleIdempotency(tenantId, appointmentExternalId, scheduleId, context)` call `ScheduleServiceClient.checkAppointmentIdempotency` and `markAppointmentProcessed`.
- **schedule-creation-worker** – Passes `requestContext` into get/set idempotency. After `markAppointmentProcessed`, calls `scheduleClient.removePendingAppointment(tenantId, patientExternalId, appointmentExternalId, requestContext)` so that when an appointment is successfully scheduled (including from reprocess flow), it is removed from pending in the Scheduler service.
- **pending-appointment-reprocess-worker** – No longer uses `getPendingAppointmentStore()`. Uses `getScheduleServiceClient().getPendingAppointmentsByPatient(tenantId, patientExternalId, requestContext)` and builds `requestContext` via `buildSSORequestContextFromAppointmentMessage(tenantId, correlationId)`.
- **AppointmentSyncService** – Constructs `PendingAppointmentService` with `this.scheduleClient` and passes `context` into `addPendingAppointment`. `getPendingAppointmentsByPatient` now requires `context` as the third argument.

---

## 2. serverless.yml Changes

- Removed env vars: `PENDING_APPOINTMENTS_TABLE_NAME`, `APPOINTMENT_IDEMPOTENCY_TABLE_NAME`.
- Removed IAM block for DynamoDB (`dynamodb:GetItem`, `PutItem`, etc.) for `PendingAppointmentsTable` and `AppointmentIdempotencyTable`.
- Removed resources: `PendingAppointmentsTable`, `AppointmentIdempotencyTable`.

Queues and other resources are unchanged (AppointmentSyncQueue, ScheduleCreationQueue, PendingAppointmentReprocessQueue, etc.).

---

## 3. How the Scheduler Service Stores Pending and Idempotency

The **Scheduler service** owns the scheduling data store (e.g. its existing Scheduler DynamoDB table). This refactor assumes it uses a **single-table design** with an `entityType` (or equivalent) to distinguish record types.

### 3.1 Pending appointment (entityType: PENDING_APPOINTMENT)

- **tenantId**, **appointmentExternalId**, **patientExternalId**, **doctorExternalId**
- **payload** – full pending appointment payload (e.g. appointment, reason, timestamp, retryCount, etc.)
- **status** (e.g. `PENDING`)
- **createdAt**
- Optional: TTL for cleanup.

Access pattern: by tenant + patient (e.g. `getByPatient(tenantId, patientExternalId)`).

### 3.2 Appointment idempotency (entityType: APPOINTMENT_IDEMPOTENCY)

- **tenantId**, **appointmentExternalId**
- **scheduleId** (after processing)
- **status** (e.g. `PROCESSED`)
- **createdAt**

Access pattern: by tenant + appointmentExternalId for check and mark.

The Scheduler service must implement the HTTP endpoints listed in §1.2 and persist/query these entities in its own table(s). This microservice only calls those APIs via `ScheduleServiceClient`.

---

## 4. Deployment Steps

1. **Scheduler service first**  
   Deploy the Scheduler service with the new internal APIs for pending appointments and appointment idempotency (and the single-table or equivalent storage). Ensure backward compatibility if this service is already in use.

2. **Deploy sso-integration**  
   - From repo root (or service dir):  
     `npx serverless deploy --stage <stage>`  
     (or your standard deploy command for the `sso-integration` service.)
   - No DynamoDB tables are created by this service; removal of the two tables is a one-way change. If the same stack previously created those tables, the next deploy will **delete** them (see Rollback).

3. **Environment**  
   - Ensure `SCHEDULE_SERVICE_API_URL` (and optionally `SCHEDULE_SERVICE_API_TIMEOUT_MS`) point to the Scheduler service that implements the new APIs.
   - Ensure `INTERNAL_SERVICE_TOKEN` is valid for Scheduler service auth.

4. **Verification**  
   - Run sync so that pending appointments are created (e.g. patient not found) and confirm they appear in the Scheduler service.
   - Run patient creation and reprocess flow; confirm pending appointments are re-enqueued and then removed after successful schedule creation.
   - Confirm idempotency: same appointment processed twice does not create duplicate schedules and second run is skipped via `checkAppointmentIdempotency`.

---

## 5. Rollback Plan

- **Code rollback**  
  Revert the refactor (restore DynamoDB tables in `serverless.yml`, restore `pending-appointment-store.ts` and previous idempotency store, and revert client/service/handler changes). Redeploy.

- **Infrastructure**  
  If you had already deployed the stack with the two DynamoDB tables, removing them from `serverless.yml` and redeploying will **delete** those tables and all data in them. To roll back without data loss:
  1. Restore the table definitions and IAM in `serverless.yml` and redeploy so the tables exist again, **or**
  2. Restore from backups if you have DynamoDB backups and need to recover data.

- **Scheduler dependency**  
  After this refactor, this service depends on the Scheduler APIs for pending and idempotency. If those APIs are unavailable or buggy, roll back the deployment and/or fix the Scheduler service and redeploy.

---

## 6. Testing Strategy

1. **Unit tests**  
   - Mock `ScheduleServiceClient` in `PendingAppointmentService`, `schedule-idempotency-store`, and handlers. Assert the correct client methods are called with the right arguments (tenantId, patientExternalId, context, etc.).

2. **Integration tests**  
   - With a test Scheduler service (or stub that implements the internal APIs), run:
     - Store pending → get by patient → remove (and optional retry-count update).
     - Check idempotency (not processed) → create schedule → mark processed → check again (already processed).
   - Run the full flow: appointment with missing patient → pending stored in Scheduler → patient creation → PendingAppointmentReprocessQueue → re-enqueue to AppointmentSyncQueue → schedule creation → idempotency marked and pending removed.

3. **E2E**  
   - Use a real (or staging) Scheduler service and HMS data: trigger sync, create patient, trigger reprocess, and verify schedules and that pending/idempotency state in the Scheduler service matches expectations.

4. **Regression**  
   - Ensure existing flows (sync, doctor provision, schedule creation from queue) still work when the Scheduler service is up and the new endpoints are implemented.

---

## 7. Final System Rules (Recap)

- **No DynamoDB tables** are defined or used in this (sso-integration) service for pending or idempotency.
- **Scheduler service** owns all scheduling-related data and exposes APIs for pending appointments and appointment idempotency.
- **Pending appointments** are stored and retrieved via Scheduler APIs called from `ScheduleServiceClient`.
- **Idempotency** is checked and marked via Scheduler APIs; no local idempotency table in this service.
- **Async architecture** (queues, workers, event flow) is unchanged.
- Deployment continues to use the **Serverless Framework** for this service.
