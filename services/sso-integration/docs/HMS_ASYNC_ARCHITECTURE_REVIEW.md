# HMS Integration — Async Architecture Review

**Document version:** 1.0  
**Scope:** TruTech HMS ↔ internal platform (appointment sync, doctor/patient provisioning, schedule creation)  
**Goal:** Production-grade, fully asynchronous, scalable to 500+ tenants and high appointment volume.

---

## 1. End-to-End Flow Analysis

### 1.1 Entry Points

| Entry Point | Trigger | Handler | Timeout |
|-------------|---------|---------|---------|
| **syncHmsAppointments** | EventBridge Scheduler (cron 09:00 Africa/Lusaka) or HTTP `POST /appointments/sync/hms` | `sync-hms-appointments.handler` | **900s** |
| **appointmentSync** | HTTP `POST /appointments/sync` (with Authorization) | `appointment-sync.handler` → `AppointmentSyncController` | **120s** |
| **patientCreationEventConsumer** | SQS (PatientCreationQueue) | `patient-creation-event-consumer.handler` | 60s |

Both sync entry points call the same core: `AppointmentSyncService.syncAppointments(context, dateRange)`.

### 1.2 Current Flow (Step-by-Step)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 1. ENTRY (syncHmsAppointments or appointmentSync)                                 │
│    - Build context (tenantId = SUBDOMAIN.TRU_TECH, single tenant)                  │
│    - Date range: today → today+SYNC_LOOKAHEAD_DAYS (default 1)                     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 2. FETCH APPOINTMENTS FROM HMS (synchronous)                                      │
│    - HmsAppointmentService.getAppointmentsForDoctorsInRange(fromDate, toDate)     │
│    - TruTech client: POST /api/teleconsultation/appointments-for-doctors           │
│    - Body: { doctor_ids: [], start_date, end_date }  ← doctor_ids always []       │
│    - Network: 1 HTTP call to HMS (single tenant; no per-tenant or doctor filter)  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 3. VALIDATE APPOINTMENTS (in-process)                                             │
│    - AppointmentValidationService.validateAppointments(appointments, context)     │
│    - Returns validAppointments; invalid logged and dropped                         │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 4. DOCTOR PROVISIONING (synchronous, blocking)                                     │
│    - UserProvisioningService.getOrCreateDoctor(validAppointments[0], context)      │
│    - findUserByExternalId(doctorExternalId) → User Service API                     │
│    - If not found: createDoctorWithRetry() → User Service API (with 409 handling)   │
│    - Single doctor per run: uses first valid appointment’s doctor only             │
│    - Network: 1–2+ HTTP calls to User Service per sync                           │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 5. PROCESS APPOINTMENTS (concurrent workers, but each item is synchronous)        │
│    - processAppointments(validAppointments, doctor, context)                      │
│    - Concurrency: APPOINTMENT_SYNC_CONCURRENCY_LIMIT (default 5) workers         │
│    - Shared in-memory queue; each worker processes one appointment at a time      │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
          For each appointment (per worker):                                         │
                                        │
    ┌───────────────────────────────────┴───────────────────────────────────┐
    │ 5a. Patient lookup (synchronous)                                       │
    │     - ssoUserServiceClient.findUserByExternalId(patientExternalId)      │
    │     - cognitoService.findCognitoUserByEmail(patient.email)              │
    │     - If no email: cognitoService.findCognitoUserByPhone(patient.phone)  │
    │     - Network: 1–2 HTTP (User Service + Cognito) per appointment         │
    ├───────────────────────────────────────────────────────────────────────┤
    │ 5b. If patient NOT found (no Cognito user):                             │
    │     - Publish PatientCreationEvent to SQS (fire-and-forget; errors logged) │
    │     - pendingAppointmentService.addPendingAppointment(...)             │
    │       → stored in IN-MEMORY array (AppointmentSyncService instance)     │
    │     - Skip schedule creation; continue to next appointment              │
    ├───────────────────────────────────────────────────────────────────────┤
    │ 5c. If patient found:                                                  │
    │     - scheduleClient.fetchSchedules(payload) → Schedule Service API     │
    │     - scheduleConflictService.detectScheduleConflict(...) (in-process)  │
    │     - If conflict: skip; else:                                          │
    │     - scheduleCreationService.createServiceScheduleWithRetry(...)       │
    │       → getAvailableServices → recommendServices → createServiceSchedule│
    │         → updateServiceStatus (4 HTTP calls to Schedule/Package APIs)    │
    │     - Retry: retryWithBackoff (maxRetries, exponential backoff)         │
    └───────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 6. RESPONSE                                                                       │
│    - Return { total, synced, skipped, failed, pending, details }                  │
│    - syncHmsAppointments: if HTTP, return 200; if scheduler, no return            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Patient Creation Consumer Flow (SQS)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ PatientCreationEventConsumer (batchSize: 10)                                      │
│ For each SQS record:                                                              │
│   1. Parse body → PatientCreationEvent                                            │
│   2. buildSSORequestContextFromSQS(event)                                          │
│   3. userServiceClient.findUserByExternalId(externalId) → skip if exists         │
│   4. mapPatientEventToCreateUserPayload(event)                                     │
│   5. Validate email or phone present                                              │
│   6. userServiceClient.createPatient(payload) → User Service API                  │
│   7. If doctorId: userServiceClient.assignDoctor(assignDoctorPayload)              │
│   8. appointmentSyncService.reprocessPendingAppointmentsForPatient(externalId)     │
│      → NEW AppointmentSyncService() → pending list is EMPTY → no-op                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.4 Network Call Summary

| Step | Service | Calls per appointment (or per run) | Blocking |
|------|---------|-------------------------------------|----------|
| Fetch appointments | HMS (TruTech) | 1 per run | Yes |
| Doctor get/create | User Service | 1–2+ per run | Yes |
| Patient lookup | User Service + Cognito | 1–2 per appointment | Yes |
| Publish patient event | SQS | 1 per missing patient | Fire-and-forget (no throw) |
| Fetch schedules | Schedule Service | 1 per appointment (when patient exists) | Yes |
| Create schedule | Schedule + Package | 4 per appointment (getAvailableServices, recommendServices, createServiceSchedule, updateServiceStatus) | Yes |

### 1.5 Retry Logic

- **Schedule creation:** `retryWithBackoff` in `ScheduleCreationService.createServiceScheduleWithRetry` (env: maxRetries, initialDelayMs, maxDelayMs).
- **Doctor creation:** `createDoctorWithRetry` in user-service client: single timeout retry + 409 conflict → fetch existing.
- **Patient event publish:** No retry; errors logged, flow continues.
- **SQS consumer:** Failed records returned as `batchItemFailures`; SQS retries up to maxReceiveCount (3), then DLQ.

### 1.6 Failure Scenarios

- **HMS down/slow:** Sync fails or times out (900s for syncHmsAppointments, 120s for HTTP sync).
- **User Service down:** Doctor/patient lookup and create fail; sync fails or partial (failed count).
- **Schedule Service down:** Schedule creation fails; retries then fail; appointment counted as failed.
- **SQS publish failure:** Patient event lost; pending stored only in memory (see below).
- **Lambda timeout:** Partial processing; no checkpointing; reprocess would re-run from scratch.
- **Duplicate schedule:** Handled by 409/“Service schedule already exists” and treated as duplicate (no retry storm).

---

## 2. Bottleneck Analysis

### 2.1 Critical Bottlenecks

| # | Bottleneck | Location | Impact |
|---|------------|----------|--------|
| 1 | **Single doctor per sync run** | `syncDoctorAppointments`: uses `validAppointments[0]` for doctor only | Multi-doctor hospitals require multiple runs or all appointments to share one doctor |
| 2 | **In-memory pending appointments** | `AppointmentSyncService.pendingAppointments: PendingAppointment[]` | Pending list lives only in the Lambda instance that ran the sync. When PatientCreationEventConsumer runs, it instantiates a **new** AppointmentSyncService with an **empty** list, so `reprocessPendingAppointmentsForPatient` always finds zero pending → **reprocess never runs**. |
| 3 | **Synchronous doctor provisioning** | Entire sync blocks on getOrCreateDoctor before any appointment is processed | Adds latency and single point of failure; not shardable per doctor |
| 4 | **Long chain of synchronous schedule calls** | getAvailableServices → recommendServices → createServiceSchedule → updateServiceStatus | 4 sequential HTTP calls per appointment; any failure fails the whole appointment |
| 5 | **No tenant/hospital dimension** | Context is fixed SUBDOMAIN.TRU_TECH; TruTech client sends `doctor_ids: []` | Single logical tenant; REGISTERED_HMS_DOCTOR_IDS exists but is not used in sync flow; 500 hospitals cannot be represented |
| 6 | **HTTP sync timeout (120s)** | appointmentSync Lambda | With many appointments, 120s can be exceeded before completion |
| 7 | **Sync timeout (900s)** | syncHmsAppointments | 15 min may still be insufficient for very large batches with no checkpointing |
| 8 | **No idempotency key for patient events** | PatientCreationEvent.eventId = `${provider}-${patient.id}-${Date.now()}` | Same patient can produce many events; duplicate processing mitigated only by findUserByExternalId in consumer |
| 9 | **Sequential processing within each worker** | Each worker does full pipeline (lookup → fetch schedules → create) per item | No fan-out to dedicated “schedule creation” or “patient lookup” workers |
| 10 | **Rate limit only at HTTP edge** | checkRateLimit in AppointmentSyncController | Scheduled sync (syncHmsAppointments) has no rate limiting; internal services (User, Schedule) can be overwhelmed |

### 2.2 Additional Concerns

- **DynamoDB:** Not used in this service; no DynamoDB contention in sso-integration. Downstream User/Schedule services may use DDB; not visible here.
- **API Gateway:** Only for HTTP endpoints; 29s max integration timeout; 120s Lambda can exceed that if proxy is used without async invocation.
- **Retry storms:** Schedule creation retries with backoff; duplicate 409 is rethrown to avoid infinite retry. Patient consumer retries (SQS) can cause repeated createPatient + assignDoctor until success or DLQ.

---

## 3. Production Risks (500+ Tenants, High Volume)

### 3.1 Scalability

- **Single-tenant design:** One context (SUBDOMAIN.TRU_TECH), one HMS API, no partitioning by hospital/tenant. To support 500+ hospitals, either the sync must run 500+ times (e.g. one invocation per tenant) or the system must be refactored to tenant-aware queues and workers.
- **Volume:** 10k appointments/day ≈ 7/min steady; burst sync can create 100s of appointments in one run. Current design processes them in one Lambda with 5 concurrent workers and many sequential HTTP calls → high latency and timeout risk.
- **Burst syncs:** If multiple tenants or cron + manual triggers run together, shared downstream services (User, Schedule, Cognito) and single SQS queue can become hotspots.

### 3.2 Correctness and Data

- **Pending appointments never reprocessed:** Because pending list is in-memory and consumer creates a new AppointmentSyncService, “reprocess pending after patient creation” is effectively dead code. Newly created patients never get their appointments retroactively created in the schedule service.
- **Duplicate events:** Same patient missing in same sync can lead to multiple SQS messages; consumer is idempotent for create (findUserByExternalId) but assignDoctor and reprocess (no-op) run every time.
- **No distributed transaction:** Doctor created, then patient event published, then schedule created in another process. If any step fails, state is inconsistent (e.g. doctor exists, patient never created, or patient created but schedule never created).

### 3.3 Reliability

- **Partial failures:** No checkpointing; Lambda timeout or crash leaves no resume point; next run re-fetches all and reprocesses from start (possible duplicates if idempotency is only at schedule layer).
- **SQS:** Standard queue (no FIFO); no ordering, no content-based deduplication. Patient creation events can be processed out of order or twice.
- **DLQ:** Failed patient events go to DLQ after 3 receives; no automated replay or alerting described in code.

### 3.4 Observability and Operations

- **Single correlation ID per run:** Good for tracing one sync; when fan-out to queues, correlation ID propagation in messages is important (partially present via event.correlationId).
- **No per-tenant metrics:** Hard to see which tenant or doctor is slow or failing.
- **Hardcoded queue URL:** PATIENT_CREATION_QUEUE_URL in serverless.yml; multi-region or multi-stage requires configuration management.

---

## 4. Async Architecture Proposal (Target State)

### 4.1 Principles

- **Decouple steps with events/queues:** HMS fetch → appointment messages; doctor provisioning → doctor-ready events; patient creation → existing SQS; schedule creation → dedicated queue.
- **Idempotency:** Every consumer uses a stable key (e.g. tenantId + externalAppointmentId or externalUserId) and idempotent writes (create-if-not-exists, conditional writes, or idempotency store).
- **One tenant per unit of work where possible:** Partition by tenantId/hospitalId so one bad tenant does not block others and scaling is per-tenant.

### 4.2 Proposed Topology

```
                    ┌──────────────────────────────────────────────────────────────┐
                    │                    TRIGGERS                                     │
                    │  Scheduler (per-tenant or batched) / HTTP / Manual              │
                    └──────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│  LAMBDA: syncHmsAppointments (orchestrator only)                                  │
│  - For each tenant (or from trigger payload):                                      │
│    - Fetch appointments from HMS (tenant-specific config)                         │
│    - Publish one message per appointment (or batch) to AppointmentSyncQueue       │
│  - No doctor/patient/schedule work; return quickly                                │
└───────────────────────────────────────────────────────────────────────────────────┘
                                                │
                        ┌───────────────────────┴───────────────────────┐
                        │  SQS: AppointmentSyncQueue (per-tenant or one)   │
                        │  Message: { tenantId, appointment, ... }       │
                        └───────────────────────┴───────────────────────┘
                                                │
                                                ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│  LAMBDA: appointmentProcessor (worker)                                             │
│  - Ensure doctor exists (get or publish to DoctorProvisioningQueue if missing)     │
│  - Ensure patient exists (get or publish to PatientCreationQueue)                  │
│  - If patient missing: store pending in Idempotency/PendingStore (DynamoDB), then  │
│    publish patient event; exit (reprocess triggered by patient consumer)          │
│  - If both exist: publish to ScheduleCreationQueue                                │
└───────────────────────────────────────────────────────────────────────────────────┘
                │                                    │
                │                                    │
                ▼                                    ▼
┌─────────────────────────────┐    ┌─────────────────────────────────────────────────┐
│  SQS: DoctorProvisioningQueue│    │  SQS: PatientCreationQueue (existing)            │
│  → Lambda: doctorProvisioner  │    │  → Lambda: patientCreationEventConsumer         │
│  - Create doctor; publish    │    │  - Create patient; assign doctor;                 │
│    DoctorReady (optional)   │    │  - Publish ReprocessPendingAppointments events   │
└─────────────────────────────┘    └─────────────────────────────────────────────────┘
                                                                        │
                                                                        ▼
                                                        ┌─────────────────────────────┐
                                                        │  SQS: PendingReprocessQueue │
                                                        │  → Lambda: pendingReprocess │
                                                        │  - Read pending from store  │
                                                        │  - Publish schedule create  │
                                                        └─────────────────────────────┘
                │                                    │
                └────────────────┬───────────────────┘
                                 ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│  SQS: ScheduleCreationQueue                                                        │
│  Message: { tenantId, appointment, doctorUserId, patientUserId, idempotencyKey }   │
└───────────────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│  LAMBDA: scheduleCreationWorker                                                    │
│  - Check idempotency (e.g. DynamoDB key = tenantId + externalAppointmentId)         │
│  - If already created: ack and skip                                                │
│  - Else: getAvailableServices → recommendServices → createServiceSchedule →       │
│    updateServiceStatus; write idempotency key; ack                                 │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Idempotency and Pending Store

- **Idempotency store (e.g. DynamoDB):**  
  - Key: `tenantId#externalAppointmentId` (or similar).  
  - Value: status (e.g. `created`), scheduleId, timestamp.  
  - Used by scheduleCreationWorker to skip duplicates and by pending reprocess to know what was already created.

- **Pending appointments store (e.g. DynamoDB):**  
  - Key: `tenantId#patientExternalId` (or composite).  
  - Attributes: list of pending appointment payloads (or separate rows per appointment).  
  - appointmentProcessor writes here when patient is missing; pendingReprocess reads and publishes to ScheduleCreationQueue after patient is created.

### 4.4 EventBridge (Optional)

- Use EventBridge for **DoctorReady** / **PatientCreated** / **ScheduleCreated** if you need multiple subscribers or analytics; otherwise SQS is enough for 1:1 worker semantics.
- EventBridge can also drive “sync requested” per tenant from a single scheduler rule (target: Lambda with tenant list or SQS per tenant).

### 4.5 Dead Letter Queues and Retries

- Every queue has a DLQ; maxReceiveCount = 3 (or 5).
- Alert on DLQ depth; optional Lambda or step function to replay after fix.
- Idempotency keys prevent duplicate work on replay.

---

## 5. Incremental Migration Plan

**Principle:** Change one step at a time; keep existing behavior working; add feature flags or dual-write where useful.

---

### Step 1: Move Appointment Processing to a Queue (Decouple “fetch” from “process”)

**Goal:** syncHmsAppointments only fetches from HMS and enqueues work; a new Lambda processes each message.

**Changes:**

1. **New resources (serverless.yml):**
   - SQS: `AppointmentSyncQueue` + `AppointmentSyncDLQ`.
   - Lambda: `appointmentProcessor` (triggered by AppointmentSyncQueue, batchSize 1 or 5, timeout 60–120s).

2. **Code:**
   - **sync-hms-appointments.handler:** After fetching appointments and validation, for each appointment (or batch of N), send message to AppointmentSyncQueue: `{ tenantId, appointment, correlationId, dateRange }`. Do **not** call `syncDoctorAppointments` or `processAppointments` in this Lambda. Optionally keep a feature flag to run “legacy” path (current behavior) for rollback.
   - **New handler:** `appointment-processor.handler` (or extend a shared service): For each SQS record, build context from message, call existing `syncDoctorAppointments` for a **single** appointment (or a small batch), or a new method that processes one appointment (doctor get/create, patient lookup, pending/schedule as today). Reuse `UserProvisioningService`, `AppointmentSyncService` logic (single-appointment path) so that one message = one appointment.

3. **Testing:**
   - Unit: Publish mock message to queue; assert appointmentProcessor creates schedule or publishes patient event.
   - Integration: Run syncHmsAppointments once; assert messages in AppointmentSyncQueue and then processed (check schedule service or DLQ).
   - Rollback: Feature flag to “publish to queue + run legacy path” or “only run legacy path” (no enqueue).

4. **Rollback:** Disable appointmentProcessor trigger; point syncHmsAppointments back to full in-line processing (existing code path).

**Outcome:** Fetch and process are decoupled; sync Lambda returns quickly; processing can scale via queue concurrency.

---

### Step 2: Move Doctor Provisioning Async (Optional per Message)

**Goal:** Appointment processor does not block on doctor create; if doctor is missing, publish to DoctorProvisioningQueue; when doctor is ready, continue (or re-enqueue appointment).

**Changes:**

1. **New resources:**
   - SQS: `DoctorProvisioningQueue` + DLQ.
   - Lambda: `doctorProvisioner` (invoked by DoctorProvisioningQueue).

2. **Code:**
   - **appointmentProcessor:** On “doctor not found”, instead of calling `userProvisioningService.getOrCreateDoctor` (blocking), send message to DoctorProvisioningQueue with `{ tenantId, doctorPayload, appointmentId, correlationId }`. Optionally store “pending doctor” in DynamoDB keyed by doctorExternalId. Either: (a) re-enqueue appointment message with “doctor creation in progress” and consumer later re-checks, or (b) doctorProvisioner on success publishes “AppointmentReadyForSchedule” (or re-sends to AppointmentSyncQueue with doctorUserId). Prefer (b) to avoid circular dependency.
   - **doctorProvisioner:** Call existing `userProvisioningService.getOrCreateDoctor` (or user-service client createDoctorWithRetry); on success, publish to ScheduleCreationQueue or back to AppointmentSyncQueue with doctor info so appointmentProcessor can continue (or merge Step 2 with Step 4 so doctor creation result is consumed by schedule worker).

3. **Testing:** Same as Step 1; add case “doctor missing” → message to DoctorProvisioningQueue → doctor created → next step receives doctor and continues.

4. **Rollback:** Config flag “syncDoctorInline: true” so appointmentProcessor again calls getOrCreateDoctor inline.

**Outcome:** Doctor creation no longer blocks the main appointment processor; can scale independently.

---

### Step 3: Persist Pending Appointments and Fix Reprocess

**Goal:** Pending appointments stored in DynamoDB (or similar); patient consumer triggers reprocess that actually finds and processes them.

**Changes:**

1. **New resources:**
   - DynamoDB: `PendingAppointments` table. Key: `tenantId#patientExternalId`, sort key: `externalAppointmentId` (or single document per patient with list of pending). TTL optional for cleanup.

2. **Code:**
   - **PendingAppointmentService:** Replace in-memory array with DynamoDB (or shared store) writes in `addPendingAppointment`. `getPendingAppointmentsByPatient(patientExternalId)` reads from store (and optionally deletes after successful process). `removePendingAppointment` deletes from store.
   - **AppointmentSyncService:** Inject a store adapter (DynamoDB) into PendingAppointmentService; same interface.
   - **patientCreationEventConsumer:** After creating patient and assignDoctor, call `reprocessPendingAppointmentsForPatient`. This now uses the **same** persistent store, so the new Lambda instance will see pendings created by the sync Lambda. Optionally publish to a **PendingReprocessQueue** with `{ tenantId, patientExternalId, correlationId }` and a new Lambda `pendingReprocess` reads from store and publishes to ScheduleCreationQueue (or calls schedule creation); this keeps patient consumer fast and delegates heavy work.

3. **Testing:** Run sync with a missing patient → assert row in PendingAppointments; run patient consumer for that patient → assert pending is processed and removed.

4. **Rollback:** Feature flag to use in-memory pending again (old behavior); leave DynamoDB table in place.

**Outcome:** “Reprocess pending after patient creation” works across Lambda invocations; no dependency on same process.

---

### Step 4: Async Schedule Creation via Queue

**Goal:** Schedule creation runs in a dedicated Lambda fed by a queue; appointment processor only enqueues “create schedule” with doctor + patient IDs.

**Changes:**

1. **New resources:**
   - SQS: `ScheduleCreationQueue` + DLQ.
   - Lambda: `scheduleCreationWorker` (triggered by ScheduleCreationQueue).

2. **Code:**
   - **appointmentProcessor (or appointment sync path):** When doctor and patient exist and no conflict, instead of calling `scheduleCreationService.createServiceScheduleWithRetry`, send message to ScheduleCreationQueue: `{ tenantId, appointment, doctorUserId, patientUserId, organizationId, correlationId, idempotencyKey }`.
   - **scheduleCreationWorker:** Load message; call existing `ScheduleCreationService.createServiceScheduleWithRetry` (or equivalent). Implement idempotency: before create, check idempotency store (e.g. DynamoDB `ScheduleIdempotency` keyed by idempotencyKey); if already success, skip and ack. On success, write idempotency key.

3. **Testing:** Publish schedule-create message; assert schedule in Schedule Service and idempotency record; publish same key again → no duplicate create.

4. **Rollback:** Config “scheduleCreateInline: true” so processor calls createServiceScheduleWithRetry directly.

**Outcome:** Schedule creation is decoupled and can scale via queue concurrency; idempotency prevents duplicates on retry/replay.

---

### Step 5: Introduce Idempotent Event Store and Deduplication

**Goal:** Central idempotency for “appointment processed” and “schedule created”; optional event store for audit and replay.

**Changes:**

1. **Resources:**
   - DynamoDB: `AppointmentSyncIdempotency` (e.g. key: `tenantId#externalAppointmentId`, attributes: status, scheduleId, createdAt).
   - Use in appointmentProcessor (skip if status = created) and scheduleCreationWorker (write after success).

2. **Code:**
   - **appointmentProcessor:** Before doing work, get idempotency record; if status = created, ack and skip (optionally return scheduleId in message for traceability).
   - **scheduleCreationWorker:** After successful create, put idempotency record with status = created, scheduleId.
   - **Patient events:** Optionally add deduplication key (e.g. tenantId#patientExternalId#intent) and conditional put so duplicate SQS messages do not create duplicate patients (consumer already uses findUserByExternalId; this adds an extra guard).

3. **Testing:** Replay same appointment message twice; second time no create and no duplicate schedule.

4. **Rollback:** Bypass idempotency check via flag; still write idempotency on success for future use.

**Outcome:** Safe replay and retry; no duplicate schedules; clear audit of what was processed.

---

### Step 6 (Later): Multi-Tenant and Partitioning

**Goal:** Support 500+ hospitals; partition by tenant.

**Changes:**

- **Scheduler:** Invoke sync with payload `{ tenantIds: [...] }` or one invocation per tenant (from a tenant registry or config).
- **Context:** Build context with tenantId from message or payload (subdomain / hospitalId).
- **Queues:** Either single queue with tenantId in message (and optional message group by tenantId if using FIFO for ordering) or separate queue per tenant for isolation.
- **HMS client:** Per-tenant config (base URL, API key, doctor IDs) from config or secrets; TruTech client accepts tenant and uses REGISTERED_HMS_DOCTOR_IDS or tenant-specific doctor list.

---

## 6. Code-Level Recommendations

### 6.1 sync-hms-appointments.handler

- **File:** `src/handlers/events/sync-hms-appointments.ts`
- **Changes (Step 1):** After getting appointments and validation, stop calling `appointmentSyncService.syncAppointments` for the full pipeline. Instead, build context per tenant (when multi-tenant), then for each appointment send a message to AppointmentSyncQueue. Optionally keep a flag to call current `syncAppointments` for rollback.
- **Later:** Accept tenant list from EventBridge input or from a tenant registry; loop over tenants and enqueue per-tenant appointment batches.

### 6.2 AppointmentSyncService

- **File:** `src/services/appointment-sync.service.ts`
- **Changes:**
  - **Step 1:** Add method e.g. `processSingleAppointment(message, context)` used by appointmentProcessor: fetch doctor (getOrCreateDoctor for that appointment’s doctor), then run patient lookup + pending/schedule logic for one appointment. Factor current `processAppointments` loop body into a reusable “process one” function.
  - **Step 3:** Replace `private readonly pendingAppointments: PendingAppointment[]` with a store interface (e.g. `PendingAppointmentStore`); implementation that uses DynamoDB in PendingAppointmentService.
  - **Step 4:** When doctor and patient exist, instead of calling `scheduleCreationService.createServiceScheduleWithRetry`, enqueue to ScheduleCreationQueue (or call a shared “enqueueScheduleCreate” helper).

### 6.3 UserProvisioningService

- **File:** `src/services/appointment-sync/user-provisioning.service.ts`
- **Changes (Step 2):** When doctor not found, optionally publish to DoctorProvisioningQueue and return a “pending” token, or keep current blocking behavior behind a flag. New Lambda doctorProvisioner will call the same `getOrCreateDoctor` or user-service client.

### 6.4 ScheduleCreationService

- **File:** `src/services/appointment-sync/schedule-creation.service.ts`
- **Changes (Step 4):** No change to core logic. scheduleCreationWorker will call this service. Optionally add a method that accepts already-resolved doctor/patient IDs and organizationId from message (no need to resolve again).

### 6.5 PatientEventPublisher

- **File:** `src/services/patient-event-publisher.service.ts`
- **Changes:** Optional: add idempotency key (e.g. tenantId#patientExternalId) in message attributes for deduplication in consumer (Step 5). Keep existing publish logic.

### 6.6 PendingAppointmentService

- **File:** `src/services/appointment-sync/pending-appointment.service.ts`
- **Changes (Step 3):** Replace `pendingAppointments: PendingAppointment[]` with a store (e.g. DynamoDB). `addPendingAppointment` → store.put; `getPendingAppointmentsByPatient` → store.query; `removePendingAppointment` → store.delete. Ensure reprocessPendingAppointmentsForPatient uses the same store so consumer Lambda sees pendings created by sync Lambda.

### 6.7 patient-creation-event-consumer

- **File:** `src/handlers/events/patient-creation-event-consumer.ts`
- **Changes (Step 3):** No change to flow; once PendingAppointmentService is backed by DynamoDB, `reprocessPendingAppointmentsForPatient` will find pendings. Optional: publish to PendingReprocessQueue instead of calling reprocess inline to avoid long-running consumer.

### 6.8 Context and Tenant

- **Files:** `src/utils/context-builder.util.ts`, TruTech client, env.
- **Changes (Step 6):** buildSSORequestContext should accept tenantId/subdomain from trigger or message; TruTech client should accept tenant-specific URL/keys and doctor IDs (from REGISTERED_HMS_DOCTOR_IDS or tenant config).

---

## 7. Scaling Design (500 Tenants, 10k Appointments/Day, Burst)

### 7.1 Queue Partitioning

- **Option A (single queue):** One AppointmentSyncQueue; message attribute `tenantId`; concurrency per tenant can be limited by using a separate “rate” Lambda that only forwards to a per-tenant queue if needed. Simpler.
- **Option B (per-tenant queues):** One SQS queue per tenant (e.g. 500 queues); scheduler or router Lambda sends to the right queue. Better isolation and per-tenant scaling; more infrastructure.
- **Recommendation:** Start with single queue + tenantId in message; add per-tenant queues only if one tenant’s load or failures affect others.

### 7.2 Concurrency Control

- **Reserved concurrency** on appointmentProcessor (e.g. 50–100) to avoid thundering herd on User/Schedule services.
- **ScheduleCreationQueue** worker concurrency can be higher (e.g. 200) if Schedule Service can handle it; tune with limits from downstream.
- Use **SQS visibility timeout** ≥ Lambda timeout (e.g. 2×) so failed items reappear for retry.

### 7.3 Idempotency Design

- **Key:** `tenantId#externalAppointmentId` (and optionally `doctorId#patientId#startTime`).
- **Store:** DynamoDB; conditional put so only first success writes “created”; later retries see existing and skip.
- **TTL:** Optional 7–30 days for cleanup of idempotency rows.

### 7.4 Retry Strategy

- **AppointmentSyncQueue / ScheduleCreationQueue:** maxReceiveCount 3–5; exponential backoff via SQS (visibility timeout); DLQ for failures.
- **Lambda:** Let SQS handle retries; avoid aggressive application-level retry (only for transient HTTP 5xx in schedule create, with backoff).
- **Patient creation:** Keep current SQS retry; consumer remains idempotent by findUserByExternalId.

### 7.5 Burst Syncs

- **Scheduler:** Stagger cron per tenant (e.g. spread over 30 min) to avoid all 500 tenants at once.
- **Backpressure:** If downstream returns 429, either re-queue with delay or use SQS visibility timeout to naturally back off.
- **Circuit breaker (optional):** If Schedule or User service error rate is high, stop processing and send to DLQ for later replay.

---

## 8. Summary

- **Current flow** is largely synchronous: one Lambda does HMS fetch, doctor provisioning, patient lookup, optional SQS publish, and schedule creation in a single run. Pending appointments are in-memory, so **reprocess after patient creation never runs**.
- **Bottlenecks:** Single doctor per run, in-memory pending list, long HTTP chains, no tenant partitioning, and timeouts (120s/900s).
- **Target:** Event-driven pipeline with queues for appointment processing, doctor provisioning (optional), patient creation (existing), pending reprocess (persistent store), and schedule creation, plus idempotency and persistent pending store.
- **Migration:** Six incremental steps (queue appointment processing → async doctor → persistent pending + fix reprocess → async schedule creation → idempotency store → multi-tenant) with clear code touchpoints, tests, and rollback for each step.

Once this plan is approved, implementation can start with **Step 1** (move appointment processing to a queue) and **Step 3** (persist pending appointments and fix reprocess), as they deliver immediate correctness and scalability benefits with minimal change to existing HTTP and scheduler entry points.
