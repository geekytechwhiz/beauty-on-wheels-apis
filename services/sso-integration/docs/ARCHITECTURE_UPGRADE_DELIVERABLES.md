# HMS Async Architecture Upgrade – Deliverables

This document summarizes the refactor to align **sso-integration** with the event-driven architecture (EventBridge Scheduler → syncHmsAppointments → AQ → appointmentProcessor → DQ/PQ/SQ → workers).

---

## 1. Convert syncHmsAppointments to EventBridge Scheduler (Enqueue-Only)

**Change:**  
- **Removed** HTTP (API Gateway) trigger for `syncHmsAppointments`.  
- Handler now accepts only `ScheduledEvent`; no `APIGatewayProxyEvent`.  
- **Enqueue-only:** fetches and validates appointments from HMS, then sends messages to `AppointmentSyncQueue` in batches of 10. No inline processing.

**Files:**  
- `src/handlers/events/sync-hms-appointments.ts` – scheduler-only handler, enqueue-only.  
- `serverless.yml` – removed `http` event from `syncHmsAppointments`.

**Deployment:**  
- Deploy with `serverless deploy`. The existing `SyncHmsAppointmentsScheduleMorning` (EventBridge Scheduler) continues to invoke the Lambda.  
- To run more frequently, add another `AWS::Scheduler::Schedule` (e.g. `rate(5 minutes)`) or use `HMS_SYNC_SCHEDULE_EXPRESSION` in a custom resource.

**Rollback:**  
- Re-attach an `http` event to `syncHmsAppointments` and redeploy if you need a temporary HTTP trigger.

**Testing:**  
- Invoke the Lambda with a scheduled-event payload (e.g. `{"source":"scheduler","detail-type":"scheduled"}`).  
- Confirm logs show “enqueued” count and no inline processing.  
- Confirm messages appear on `AppointmentSyncQueue`.

---

## 2. Enforce Queue-Only Architecture

**Change:**  
- Removed env flags `USE_APPOINTMENT_SYNC_QUEUE` and `USE_SCHEDULE_CREATION_QUEUE`.  
- Sync handler always enqueues to AQ.  
- Schedule creation always goes through `ScheduleCreationQueue`; no inline `createServiceScheduleWithRetry` in `AppointmentSyncService`.

**Files:**  
- `serverless.yml` – removed `USE_APPOINTMENT_SYNC_QUEUE`, `USE_SCHEDULE_CREATION_QUEUE`.  
- `src/services/appointment-sync.service.ts` – removed branch that called `scheduleCreationService.createServiceScheduleWithRetry` inline; only `publishScheduleCreation` is used.

**Deployment:**  
- Deploy as usual. No new resources.

**Rollback:**  
- Reintroduce env vars and conditional logic in code and re-deploy.

**Testing:**  
- Run sync; confirm no sync path calls Schedule Service directly.  
- Confirm schedule creation only happens in `scheduleCreationWorker` after messages are processed from `ScheduleCreationQueue`.

---

## 3. Doctor Provisioning Queue

**Change:**  
- **DoctorProvisionQueue** and **DoctorProvisionDLQ** (SQS).  
- **doctorProvisionWorker** Lambda: consumes doctor-provision messages, calls `UserProvisioningService.getOrCreateDoctor`, then re-enqueues the same appointment to **AppointmentSyncQueue**.  
- **appointmentProcessor**: if `getDoctorIfExists` returns `null`, publishes to **DoctorProvisionQueue** instead of creating the doctor inline.

**Files:**  
- `serverless.yml` – `DoctorProvisionQueue`, `DoctorProvisionDLQ`, `doctorProvisionWorker` (reservedConcurrency: 20), env `DOCTOR_PROVISION_QUEUE_URL`, IAM for new queues.  
- `src/types/events/doctor-provision-message.types.ts` – `DoctorProvisionMessage`.  
- `src/services/appointment-sync/doctor-provision-queue.service.ts` – `publishDoctorProvision`.  
- `src/handlers/events/doctor-provision-worker.handler.ts` – worker implementation.  
- `src/services/appointment-sync/user-provisioning.service.ts` – `getDoctorIfExists`.  
- `src/services/appointment-sync.service.ts` – `getDoctorIfExists`, `processSingleAppointmentWithDoctor`.  
- `src/handlers/events/appointment-processor.handler.ts` – use `getDoctorIfExists`; if null, `publishDoctorProvision` and continue; else `processSingleAppointmentWithDoctor`.

**Deployment:**  
- `serverless deploy` creates queues and worker.  
- Ensure `APPOINTMENT_SYNC_QUEUE_URL` is set for the worker (already provided by Ref).

**Rollback:**  
- In appointmentProcessor, revert to always calling `processSingleAppointment` (which uses `getOrCreateDoctor` inline).  
- Optionally remove or disable the doctorProvisionWorker event source and leave the queue for replay.

**Testing:**  
- Send an appointment for a doctor that does not exist: processor should enqueue to DoctorProvisionQueue.  
- doctorProvisionWorker should create the doctor and enqueue the appointment to AQ; next processor run should see the doctor and process the appointment.

---

## 4. Patient Creation → Pending Reprocess Queue

**Change:**  
- **patientCreationEventConsumer** no longer calls `reprocessPendingAppointmentsForPatient` inline.  
- After creating the patient, it publishes to **PendingAppointmentReprocessQueue** with `{ tenantId, patientExternalId, correlationId }`.

**Files:**  
- `src/handlers/events/patient-creation-event-consumer.ts` – after success, call `publishPendingReprocess({ tenantId, patientExternalId: externalId, correlationId })` instead of `reprocessPendingAppointmentsForPatient`.

**Deployment:**  
- Deploy; ensure `PENDING_REPROCESS_QUEUE_URL` is set (Ref to new queue).

**Rollback:**  
- Restore call to `appointmentSyncService.reprocessPendingAppointmentsForPatient` and remove `publishPendingReprocess`.

**Testing:**  
- Create a patient via the consumer; confirm a message is sent to PendingAppointmentReprocessQueue.  
- Confirm no heavy reprocess logic runs inside the consumer.

---

## 5. PendingAppointmentReprocessQueue and Worker

**Change:**  
- **PendingAppointmentReprocessQueue** and **PendingAppointmentReprocessDLQ**.  
- **pendingAppointmentReprocessWorker**: reads `PendingReprocessMessage`, loads pending appointments for the patient from the store, and re-enqueues each appointment to **AppointmentSyncQueue**.

**Files:**  
- `serverless.yml` – queues, `pendingAppointmentReprocessWorker` (reservedConcurrency: 20), `PENDING_REPROCESS_QUEUE_URL`, IAM.  
- `src/types/events/pending-reprocess-message.types.ts` – `PendingReprocessMessage`.  
- `src/services/appointment-sync/pending-reprocess-queue.service.ts` – `publishPendingReprocess`.  
- `src/handlers/events/pending-appointment-reprocess-worker.handler.ts` – worker using `getPendingAppointmentStore().getByPatient`, then SendMessage to AQ per pending.

**Deployment:**  
- `serverless deploy`.

**Rollback:**  
- Remove or disable the worker’s SQS trigger; consumer can be reverted to inline reprocess (see §4).

**Testing:**  
- Publish a reprocess message; confirm worker loads pendings and sends one AQ message per pending appointment.

---

## 6. Fully Asynchronous Schedule Creation

**Change:**  
- Schedule creation is only performed in **scheduleCreationWorker**.  
- **AppointmentSyncService** only calls `publishScheduleCreation`; no direct call to `ScheduleCreationService.createServiceScheduleWithRetry`.

**Files:**  
- `src/services/appointment-sync.service.ts` – already updated in §2; only `publishScheduleCreation` path remains.

**Deployment / Rollback / Testing:**  
- Same as §2.

---

## 7. DynamoDB Idempotency Store for Schedule Creation

**Change:**  
- **AppointmentIdempotencyTable** (DynamoDB): partition key `pk` = `SCHEDULE#tenantId#externalAppointmentId`.  
- **schedule-idempotency-store**: `getScheduleIdempotency(tenantId, externalAppointmentId)` and `setScheduleIdempotency(tenantId, externalAppointmentId, scheduleId)`.  
- **scheduleCreationWorker**: before creating, checks `getScheduleIdempotency`; if record exists, skips. After successful create, calls `setScheduleIdempotency`.  
- Existing `checkDuplicateSchedule` (Schedule API) remains as an extra guard.

**Files:**  
- `serverless.yml` – `AppointmentIdempotencyTable`, env `APPOINTMENT_IDEMPOTENCY_TABLE_NAME`, IAM.  
- `src/services/appointment-sync/schedule-idempotency-store.ts` – get/set.  
- `src/handlers/events/schedule-creation-worker.handler.ts` – check idempotency store first; on success write idempotency record.

**Deployment:**  
- `serverless deploy` creates the table.  
- Override `APPOINTMENT_IDEMPOTENCY_TABLE_NAME` to use an existing table if key schema matches (`pk` only).

**Rollback:**  
- Remove idempotency table check/write from the worker; rely only on `checkDuplicateSchedule`.  
- Optionally drop the table after draining.

**Testing:**  
- Send the same schedule-creation message twice; second run should skip after idempotency read.  
- Confirm idempotency item is written after first successful create.

---

## 8. Multi-Tenant TruTech (HMS) Configuration

**Change:**  
- **getTruTechClientForTenant(tenantId)** returns a client configured for that tenant.  
- **getTenantHmsConfig(tenantId)** reads optional env `TENANT_HMS_CONFIG` (JSON map `tenantId → { baseUrl, apiKey, timeoutMs? }`); falls back to global `TRU_TECH_BASE_URL` / `TRU_TECH_API_KEY`.  
- **TruTechClient** constructor accepts optional `TruTechClientConfig`; tenant clients are cached per `tenantId`.  
- **HmsAppointmentService.getAppointmentsForDoctorsInRange** accepts optional `tenantId`; when set, uses `getTruTechClientForTenant(tenantId)` for the request.  
- **AppointmentSyncService** passes `context.tenantId` into the HMS fetch.

**Files:**  
- `serverless.yml` – `TENANT_HMS_CONFIG` (default `'{}'`).  
- `src/config/tenant-hms-config.ts` – `getTenantHmsConfig`.  
- `src/clients/tru-tech.clients.ts` – constructor(config?), `getTruTechClientForTenant` with cache.  
- `src/services/appointment-sync/hms-appointment.service.ts` – optional `tenantId` in `getAppointmentsForDoctorsInRange`, use tenant client when provided.  
- `src/services/appointment-sync.service.ts` – pass `context.tenantId` into `getAppointmentsForDoctorsInRange`.

**Deployment:**  
- Set `TENANT_HMS_CONFIG` to a JSON string when using per-tenant HMS endpoints/keys.

**Rollback:**  
- Omit `tenantId` in HMS calls so the default client is used; or revert to a single `getTruTechClient()`.

**Testing:**  
- With `TENANT_HMS_CONFIG` set for a tenant, run sync for that tenant and confirm the correct base URL is used (e.g. via logs or client debug).

---

## 9. Concurrency and Batch Sizes

**Change:**  
- **appointmentProcessor**: reservedConcurrency 50, batchSize 1.  
- **doctorProvisionWorker**: reservedConcurrency 20, batchSize 1.  
- **scheduleCreationWorker**: reservedConcurrency 30, batchSize 1.  
- **pendingAppointmentReprocessWorker**: reservedConcurrency 20, batchSize 1.  
- **patientCreationEventConsumer**: reservedConcurrency 20, batchSize 5.

**Files:**  
- `serverless.yml` – `reservedConcurrency` and `batchSize` per function.

**Deployment:**  
- Deploy; adjust values if needed for load.

**Rollback:**  
- Remove or increase reserved concurrency.

**Testing:**  
- Load test; confirm queue depth and Lambda concurrency stay within limits.

---

## 10. Observability

**Change:**  
- **Custom metrics** (CloudWatch): `emitMetric` in `src/utils/metrics.util.ts`; used in sync handler (HMS fetch success/failure) and schedule-creation worker (schedule creation success/failure). Namespace: `SSOIntegration/HMS`.  
- **CloudWatch Alarms**: one alarm per DLQ (`ApproximateNumberOfMessagesVisible >= 1`): AppointmentSyncDLQ, ScheduleCreationDLQ, DoctorProvisionDLQ, PendingAppointmentReprocessDLQ, PatientCreationDLQ.  
- **Structured logging**: tenantId, correlationId, and where relevant appointmentExternalId are included in handler and worker logs.

**Files:**  
- `serverless.yml` – IAM `cloudwatch:PutMetricData`; alarm resources for each DLQ.  
- `src/utils/metrics.util.ts` – `emitMetric`, `MetricNames`.  
- `src/handlers/events/sync-hms-appointments.ts` – emit metrics, log tenantId/correlationId.  
- `src/handlers/events/schedule-creation-worker.handler.ts` – emit metrics, log tenantId/appointmentExternalId/correlationId; error log includes body fields.

**Deployment:**  
- Deploy; alarms will transition to ALARM when any message is in a DLQ (e.g. attach SNS for notifications).

**Rollback:**  
- Remove custom metric calls and/or alarm resources.

**Testing:**  
- Trigger success and failure paths; confirm metrics in CloudWatch.  
- Put a message in a DLQ; confirm alarm state.

---

## Deployment Steps (Summary)

1. Ensure Node and Serverless Framework are set; env (Cognito, TruTech, Schedule/User service URLs, etc.) is configured.  
2. Run `serverless deploy --stage <stage>`.  
3. Confirm new queues and Lambdas (doctorProvisionWorker, pendingAppointmentReprocessWorker) and table (AppointmentIdempotencyTable) exist.  
4. Confirm syncHmsAppointments is triggered only by EventBridge Scheduler (no HTTP).  
5. Optionally set `TENANT_HMS_CONFIG` and run a sync for a tenant.  
6. Monitor DLQ alarms and custom metrics after a few runs.

---

## Rollback Strategy (Summary)

- **Sync / queues:** Re-enable HTTP on syncHmsAppointments and/or re-add feature flags and sync paths if needed.  
- **Doctor flow:** Point appointmentProcessor back to inline `processSingleAppointment` and disable doctorProvisionWorker trigger.  
- **Patient flow:** In consumer, call `reprocessPendingAppointmentsForPatient` again and stop publishing to PendingReprocessQueue; optionally disable pendingAppointmentReprocessWorker.  
- **Idempotency:** Stop reading/writing DynamoDB idempotency in scheduleCreationWorker; rely on existing duplicate check.  
- **Multi-tenant:** Stop passing tenantId to HMS and use default client.  
- **Observability:** Remove metric calls and alarm resources if desired.

---

## Testing Plan (Summary)

1. **Sync (enqueue-only):** Invoke sync with scheduler payload; assert only fetch + validate + enqueue; no inline process.  
2. **Appointment processor:** Message with existing doctor → processSingleAppointmentWithDoctor; message with missing doctor → publishDoctorProvision and no inline create.  
3. **Doctor worker:** Consume DQ message → create doctor → enqueue to AQ; processor then processes the same appointment.  
4. **Patient consumer:** Create patient → publish to PendingReprocessQueue only (no inline reprocess).  
5. **Pending reprocess worker:** Reprocess message → load pendings → enqueue each to AQ.  
6. **Schedule worker:** Create schedule; repeat same message → idempotency skip; confirm idempotency record in DynamoDB.  
7. **Multi-tenant:** With TENANT_HMS_CONFIG, verify correct HMS base URL for tenant.  
8. **Observability:** Trigger success/failure; check metrics; put message in DLQ and check alarm.
