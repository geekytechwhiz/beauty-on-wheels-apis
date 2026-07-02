# Runtime Task Management — Option B DynamoDB Mapping (canonical)

> **Single source of truth** for keys, attributes, and API/event → DynamoDB operations.  
> **Design:** patient-centric PK + **1 LSI** (`CarePlanIndex`) + **1 GSI** (`StaffPatientTasksIndex`) + **task partition** (`TASK#<id>`).  
> **HTTP + JSON examples:** [`api-mappings.md`](api-mappings.md) · **Examples JSON:** [`option-b-dynamodb-mappings.examples.json`](option-b-dynamodb-mappings.examples.json) · **Requirements v2 delta:** [`requirements-v2-changes.md`](requirements-v2-changes.md) · **OpenAPI:** [`open-api.yaml`](../../../docs/services/task-service/api/open-api.yaml) · **Stories:** [`story-real-life-examples-1-15.md`](story-real-life-examples-1-15.md)

> **Only DB mapping doc** — `db-mappings.md`, `DB-DESIGN.md`, `option-b-design-review-checklist.md`, and legacy `api-event-db-mappings.md` removed; content merged here.

**Legend:** **[R]** required · **[O]** optional · **[C]** conditional

**Attribute naming:** all **item attributes** (META, LOOKUP, HIST, EVID) use **camelCase** — same as API JSON (`dueWindowStart`, `orgId`, `currentState`, `lsi1Sk`, `gsi1Pk`, …). **PK/SK** key strings keep partition prefixes (`ORG#`, `PAT#`, `DUE#`, `TASK#`, `HIST#`, `EVID#`).

---

## 0) Temporal fields — timestamps (not strings)

All **instants** use **Unix epoch milliseconds** (`number` / DynamoDB **`N`**). Do **not** persist or return ISO-8601 strings for these fields.

| Layer | Type | Example |
|-------|------|---------|
| **API JSON** (request/response `data`) | `integer` (int64 ms) | `"dueAt": 1780581600000` |
| **DynamoDB attributes** | `N` | `"dueWindowStart": { "N": "1780567200000" }`, `"dueWindowEnd": { "N": "1780610400000" }` |
| **Success `meta.timestamp`** | `integer` ms | `1780554601000` |

### Fields that are timestamps (ms)

| Area | Fields |
|------|--------|
| **META** | `createdAt`, `lastUpdatedAt`, `dueWindowStart`, `dueWindowEnd`, `TaskExpirationAt` |
| **LOOKUP** | `dueWindowStart`, `dueWindowEnd` (schedule snapshot at create) |
| **LOOKUP `reminderHistory[]`** | `scheduledReminderAt`, `createdAt`, optional `sentAt` |
| **HIST** | `transitionAt` |
| **EVID** | `completedAt` |
| **LOOKUP `evidenceSummary`** | `generatedAt`, `completedAt`, `missedAt` |
| **API readiness / history** | all `transitionAt`, `completedAt`, `generatedAt`, etc. |

**Exceptions (not instants):** `OccurrenceDate` may be **calendar date** as `YYYYMMDD` number (`N`) or epoch-ms at UTC start-of-day — pick one convention and use consistently.

### Sort keys — `DUE#` prefix encodes **dueWindowStart** (not DueAt)

META `SK` and GSI1 `gsi1Sk` use prefix `DUE#` with a **13-digit ms token from `dueWindowStart`** so patient lists sort by when the task **first becomes visible** (Requirements v2), not by expected completion time.

```text
DUE#<dueWindowStartOrMaxMs>#TASK#<runtimeTaskInstanceId>
```

| Field | Role |
|-------|------|
| **`dueWindowStart`** | When the task first becomes visible/actionable — **drives SK / gsi1Sk ms token** |
| **`dueWindowEnd`** | End of the actionable window / expected completion bound (ms) — Requirements v2 **DueDate** maps here |

**Not stored:** `DueAt` — use `dueWindowEnd` for Requirements v2 **DueDate**. **v2 `StartDate`** is persisted as **`dueWindowStart`** (same field name as monitoring/API).

- `<dueWindowStartOrMaxMs>` = **13-digit zero-padded** epoch ms from `dueWindowStart`
- **Resolve at create:** `dueWindowStart` → else `dueWindowEnd` → else sentinel `9999999999999` (sorts last)
- **Last-day-only tasks:** `dueWindowStart = dueWindowEnd` (same ms in SK and both fields)
- **Monitoring create (HTTP/event):** persist `dueWindowStart = dueWindowStart`, `dueWindowEnd = dueWindowEnd` from request
- `LOOKUP.taskSk` stores the full META `SK` string at create (**immutable**)
- `LOOKUP` stores **`dueWindowStart`** + **`dueWindowEnd`** only (**write-once**)

Helper (implementation):

```text
dueWindowStartOrMaxMs = dueWindowStart ?? dueWindowEnd ?? 9999999999999
metaSK = "DUE#" + String(dueWindowStartOrMaxMs).padStart(13, "0") + "#TASK#" + runtimeTaskInstanceId
gsi1sk = "DUE#" + String(dueWindowStartOrMaxMs).padStart(13, "0") + "#PAT#" + patientId + "#TASK#" + runtimeTaskInstanceId
```

API handlers **convert** inbound timestamps to `N` before write; **emit** numbers on read (no ISO strings in `data`).

---

## 1) Keys and indexes

### Patient partition (`PK = ORG#<orgId>#PAT#<patientId>`)

| Item | SK | Notes |
|------|-----|-------|
| **RuntimeTaskInstance (META)** | `DUE#<dueWindowStartOrMaxMs>#TASK#<runtimeTaskInstanceId>` | **Immutable** after create; ms token = **`dueWindowStart`** (see §0) |
| *(no other item types on patient PK)* | — | HIST / summary / REM / SUM not on patient partition |

- **`surfaceSection` is not stored** — derived at read time from `currentState`, `dueWindowStart`, `dueWindowEnd`, `displayToPatient`, and checklist context (Requirements v2). Action Center / list APIs query META, then classify in the service layer.
- **Create condition:** `attribute_not_exists(SK)` on META (not `PK`).

### Task partition (`PK = TASK#<runtimeTaskInstanceId>`)

| Item | SK | Notes |
|------|-----|-------|
| **TaskLookup** | `LOOKUP` | `taskSk` (write-once); **`dueWindowStart`**, **`dueWindowEnd`** (write-once); `orgId`, `patientId`; **`reminderHistory[]`**; **`evidenceSummary`** |
| **ReminderInstance** | `REM#CURRENT` | Mutable live reminder (`reminderStatus`, `schedulerJobId`, `scheduledReminderAt`, channel); written on register, updated on cancel/send |
| **CompletionEvidence** | `EVID#<completionEvidenceId>` | Separate append-only proof rows |
| **TaskStateHistory** | `HIST#<transitionAtMs13>#<taskStateHistoryId>` | Append-only; **SK time-ordered** (13-digit ms + id); `transitionAt` must match SK ms |

**Not used:** `SUMMARY#LATEST`, patient `SUM#TASK#...#LATEST`, `IDEMP#`.

### LSI1 — `CarePlanIndex` (META only)

- `lsi1Sk` = `CP#<carePlanInstanceId|NONE>#TASK#<runtimeTaskInstanceId>` — **care plan + task id only** (no stage/state/due in LSI SK)
- Set at create; **immutable** (does not change when `currentState` or `workflowStage` updates)
- **Stage / state / due filters:** `FilterExpression` on META attributes (`workflowStage`, `currentState`, `dueWindowStart`, `dueWindowEnd`, etc.) after LSI query
- Tasks without a care plan: `CP#NONE#TASK#<runtimeTaskInstanceId>`

### GSI1 — `StaffPatientTasksIndex` (META only, sparse)

- `gsi1Pk` = `ORG#<orgId>#STAFF#<assignedToStaffId>` when `assignedToStaffId` is set (staff inbox for staff tasks)
- `gsi1Sk` = `DUE#<dueWindowStartOrMaxMs>#PAT#<patientId>#TASK#<runtimeTaskInstanceId>` (same **dueWindowStart** ms token as META SK)
- **Immutable** `gsi1Sk` if due fixed; update **`gsi1Pk`** when `assignedToStaffId` changes (staff reassignment)
- Tasks without `assignedToStaffId` have no GSI1 row (patient-assigned tasks use patient PK / LSI1 lists)

### Summaries (requirements §11)

| Summary | Stored? | Access |
|---------|---------|--------|
| **TaskevidenceSummary** | Yes — `evidenceSummary` on **LOOKUP** | `GetItem` `TASK#<id>/LOOKUP` |
| **Reminder history** | Yes — `reminderHistory` on **LOOKUP** | `GetItem` `TASK#<id>/LOOKUP` (same read as summary) |
| **TaskStatusSummaryByCarePlan** | No — computed | LSI1 query + aggregate |
| **ChecklistReadinessSummary** | TBD | — |

### CompletionEvidence vs evidenceSummary vs reminders (task partition)

| | **EVID#** | **evidenceSummary** (LOOKUP) | **reminderHistory** (LOOKUP) | **REM#CURRENT** | **HIST#** (reminder-related) |
|--|-----------|------------------------------|------------------------------|-----------------|------------------------------|
| Role | Completion proof | Latest rollup | **Append-only** send/register/cancel trail | **Live** reminder status | **Audit** settings change only |
| Example | Linked form submit | “Completed” summary | `scheduled` → `sent` rows | `scheduled` on register | Portal changed channels |

**META** keeps `reminderEnabled` (eligibility) and optional **`reminderSettings`** (latest config — Requirements v2 REM-007).

**Do not conflate:** `reminderHistory` on LOOKUP is for scheduler/send outcomes; **reminder setting changes** and compliance audit belong on **`HIST#`** (same partition as state history), per Requirements v2.

---

## 2) Item attributes

### 2.1 META — `RuntimeTaskInstance`

**Keys:** `PK = ORG#<orgId>#PAT#<patientId>`, `SK = DUE#<dueWindowStartOrMaxMs>#TASK#<runtimeTaskInstanceId>`

| Attribute | Req | Type | Notes |
|-----------|-----|------|-------|
| `entityType` | R | S | `RuntimeTaskInstance` |
| `orgId`, `patientId`, `patientDisplayName`, `runtimeTaskInstanceId` | R | S | `orgId` from JWT; `patientId` + `patientDisplayName` from request input; denormalized at create |
| `runtimeTaskSource` | R | S | `CarePlanTaskLinkage` \| `MonitoringRuntime` \| `ServiceFlowRuntime` \| `ManualSystem` |
| `taskBehaviorCode`, `taskDisplayGroup`, `displayTitle` | R | S | |
| `assignedToType`, `displayToPatient`, `currentState` | R | S / BOOL | |
| `createdAt`, `createdBy`, `lastUpdatedAt`, `lastUpdatedBy` | R | **N** / S | instants = **N** (ms) |
| `assignedToStaffId`, `assignedToStaffDisplayName` | C | S | Staff inbox id + denormalized display name when `assignedToType` is `staff` |
| `dueWindowStart`, `dueWindowEnd` | C/O | **N** | Schedule window start/end (ms); **SK token = `dueWindowStart`**; missed/due rules use `dueWindowEnd` |
| `reminderEnabled` | O | Eligibility flag on task card |
| `reminderSettings` | O | Map — **latest** reminder config (channels, schedule rules); updated when portal changes settings (v2 REM-007) |
| `carePlanInstanceId`, `workflowStage`, linkage/template fields | C | Care-plan paths |
| `monitoringInstanceId`, `generationHash`, `idempotencyKey` | C | Per source |
| `completionSourceType`, `completionSourceReferenceId` | C | Linked completion filter |
| `lsi1Sk`, `gsi1Pk`, `gsi1Sk` | C | Index participation |
| `Version` | O | Optimistic lock on `UpdateTaskState` |

### 2.2 LOOKUP — `TaskLookup`

**Keys:** `PK = TASK#<runtimeTaskInstanceId>`, `SK = LOOKUP`

| Attribute | Req | Notes |
|-----------|-----|-------|
| `orgId`, `patientId`, `taskSk` | R | `taskSk` = full META SK at create; **never updated** |
| `patientDisplayName` | O | Denormalized copy at create |
| `dueWindowStart`, `dueWindowEnd` | C/O | **N** (ms) — **write-once** schedule snapshot (same as META at create) |
| `carePlanInstanceId`, `assignedToStaffId`, `assignedToStaffDisplayName` | O | Convenience copy for reads; staff fields updated on assign/reassign |
| `reminderHistory` | O | List of maps — **canonical** per-task reminder audit; append on register/send/cancel; cap length |
| `evidenceSummary` | O | Map (§11.4 fields); set on complete/miss rollup |

**reminderHistory entry:** `reminderRecordId` (S), `scheduledReminderAt` (**N** ms), `reminderChannel` (S), `reminderStatus` (S), `createdAt` (**N** ms), optional `sentAt` (**N** ms), optional `schedulerJobId` (S). Append-only — each status is a new row; no `updatedAt`.

**evidenceSummary map fields:** `taskevidenceSummaryId` (S), `generatedAt` (**N**), `runtimeTaskSource`, `taskBehaviorCode`, `taskDisplayGroup`, `currentState`, optional `carePlanInstanceId`, `workflowStage`, `requiredForStageCompletion`, `completedAt` (**N**), `missedAt` (**N**), `completionSourceType`, `completionSourceReferenceId`, `latestCompletionSummary` (S).

### 2.3 EVID — `CompletionEvidence`

**Keys:** `PK = TASK#<id>`, `SK = EVID#<completionEvidenceId>` · **Condition:** `attribute_not_exists(SK)`

| Attribute | Req | Notes |
|-----------|-----|-------|
| `completionEvidenceId`, `runtimeTaskInstanceId`, `orgId`, `patientId` | R | |
| `completionSource`, `completedAt` | R | `completedAt` = **N** (ms) |
| `completionSourceType`, `completionSourceReferenceId`, `completionEventId` | C | Linked completion |
| `evidencePayload`, `evidenceType`, `evidenceVersion` | O | |

### 2.4 HIST — task history / audit (state, reminders)

**Keys:** `PK = TASK#<id>`, `SK = HIST#<transitionAtMs13>#<taskStateHistoryId>` · **Condition:** `attribute_not_exists(SK)`

```text
histSK = "HIST#" + String(transitionAt).padStart(13, "0") + "#" + taskStateHistoryId
```

One append-only stream per task. Requirements v2: include **state transitions**, **reminder setting changes**, and **reminder register/cancel requests** — not only `currentState` changes.

| Attribute | Req | Notes |
|-----------|-----|-------|
| `taskStateHistoryId`, `runtimeTaskInstanceId`, `transitionAt`, `transitionBy`, `transitionSource` | R | `transitionAt` = **N** (ms) |
| `historyEventType` | R | `stateChange` \| `assignedToStaffChange` \| `reminderSettingsChange` \| `reminderRegisterRequest` \| `reminderCancelRequest` |
| `toState`, `fromState` | C | Required when `historyEventType = stateChange` |
| `transitionReason`, `sourceEventId` | O | |
| `previousReminderEnabled`, `newReminderEnabled` | C | When `historyEventType = reminderSettingsChange` |
| `previousReminderSettings`, `newReminderSettings` | C | Map — v2 REM-008 audit |
| `reminderRecordId`, `reminderChannel`, `schedulerJobId` | C | When register/cancel request events |
| `previousReminderStatus`, `newReminderStatus` | O | Optional on HIST if product wants status-change audit in timeline (else use LOOKUP `reminderHistory` only) |
| `previousAssignedToStaffId`, `newAssignedToStaffId` | C | When `historyEventType = assignedToStaffChange` |
| `previousAssignedToStaffDisplayName`, `newAssignedToStaffDisplayName` | C | When `historyEventType = assignedToStaffChange` |

**Reminder setting change (portal, FR-TASK-REM-006–008):**

1. `UpdateItem` META and/or LOOKUP — set latest `reminderSettings`, `reminderEnabled`
2. `PutItem` HIST — `historyEventType = reminderSettingsChange`, previous/new settings, actor, reason
3. Outbound `RegisterReminderJobs` / `CancelReminderJobs` per REM-010
4. On register/cancel command: optional `PutItem` HIST — `reminderRegisterRequest` / `reminderCancelRequest`; append operational row on LOOKUP `reminderHistory` when job is scheduled/sent

Patient mobile / standard portal task UI: show **current** `reminderEnabled` / settings only — not full HIST reminder audit (v2 REM-009).

### Staff task assignment

| Rule | Detail |
|------|--------|
| Assignment | `assignedToType` (`patient`, `staff`) — who completes the task |
| Staff inbox | `assignedToStaffId` + `assignedToStaffDisplayName` when `assignedToType` is `staff`; drives sparse GSI1 |
| Assign / reassign | `PUT /tasks/{id}/assigned-staff` — set or update META/LOOKUP staff id + display name + GSI1; HIST `assignedToStaffChange` |
| Patient tasks | `assignedToType = patient` — no staff id/name, no GSI1 |
| API validation | `patientDisplayName` required with every `patientId`; staff id + display name required when `assignedToType` is `staff` |

---

## 3) API → DynamoDB

### Request sourcing (create / assign APIs)

| Field | Source |
|-------|--------|
| `orgId` | JWT (`custom:organizationID`) — never request body |
| `patientId`, `patientDisplayName` | Request body on POST creates |
| `assignedToStaffId`, `assignedToStaffDisplayName` | Request body when `assignedToType` is `staff` (or PUT assign) |
| **GSI1** (`gsi1Pk`, `gsi1Sk`) | META only when `assignedToStaffId` is set at create, or first `PUT .../assigned-staff` |

Patient tasks (`assignedToType = patient`, no `assignedToStaffId`) — **no GSI1**. Care-plan creates always set **LSI1** `lsi1Sk` when `carePlanInstanceId` is present.

### GET /health
No DynamoDB.

### POST /tasks/generate-care-plan
**TransactWrite per linkage:** conditional `PutItem` META (`attribute_not_exists(SK)`), `PutItem` HIST on `TASK#<id>`, `PutItem` LOOKUP. Set `lsi1Sk` at create; GSI1 if staff-assigned.

**Required request fields:** `patientId`, `patientDisplayName`, `carePlanInstanceId`, `taskGenerationTrigger`, `sourceLinkageContext.linkages` (min 1). **`orgId` from JWT only** — not in body.

**Required per linkage:** `carePlanTaskLinkageId`, `taskBehaviorCode`, `taskDisplayGroup`, `displayTitle`, `assignedToType`, `displayToPatient`, `dueWindowStart`, `dueWindowEnd`; when `assignedToType` is `staff`, also `assignedToStaffId` + `assignedToStaffDisplayName`.

**META at create (care-plan linkage)**

| Attribute | Source |
|-----------|--------|
| `pk` | `ORG#<orgId>#PAT#<patientId>` — org from JWT, patient from input |
| `sk` | `DUE#<dueMs13>#TASK#<runtimeTaskInstanceId>` |
| `entityType` | `RuntimeTaskInstance` |
| `orgId` | JWT |
| `patientId`, `patientDisplayName` | request input |
| `runtimeTaskInstanceId` | deterministic hash per linkage |
| `runtimeTaskSource` | `carePlanTaskLinkage` |
| `carePlanInstanceId`, `taskGenerationTrigger` | request input |
| `carePlanTaskLinkageId` | linkage |
| `taskBehaviorCode`, `taskDisplayGroup`, `displayTitle`, `assignedToType`, `displayToPatient` | linkage |
| `currentState` | `scheduled` (in-progress); terminal: `completed`, `dismissed`, `cancelled`; legacy `open`/`active` normalize to `scheduled` on read |
| `dueWindowStart` | resolved from linkage (`dueWindowStart` else `dueWindowEnd`) |
| `dueWindowEnd` | linkage |
| `idempotencyKey`, `generationHash` | hash(`orgId\|patientId\|carePlanInstanceId\|carePlanTaskLinkageId\|resolvedStart\|dueWindowEnd`) |
| `lsi1Sk` | `CP#<carePlanInstanceId>#TASK#<id>` |
| `gsi1Pk`, `gsi1Sk` | when `assignedToStaffId` set |
| `createdBy` | `system:care-plan-runtime` or `system:care-plan-runtime:<actorId>` |

### POST /tasks/monitoring-action
Same pattern; idempotency hash: `orgId|patientId|monitoringInstanceId|taskBehaviorCode|dueWindowStart|dueWindowEnd|assignedToType|assignedToStaffIdOrEmpty`.

**Required request fields:** `patientId`, `patientDisplayName`, `carePlanInstanceId`, `monitoringInstanceId`, `taskBehaviorCode`, `assignedToType` (`patient` or `staff`), `dueWindowStart`, `dueWindowEnd`; when `assignedToType` is `staff`, also `assignedToStaffId` + `assignedToStaffDisplayName`. **`orgId` from JWT**; patient fields from request body. **GSI1 only when `assignedToStaffId` set.**

### POST /tasks
META + HIST + LOOKUP; persists `patientDisplayName`; **GSI1 only when `assignedToStaffId` set** (`assignedToStaffId` + `assignedToStaffDisplayName` required when `assignedToType` is `staff`).

**Required request fields:** `patientId`, `patientDisplayName`, `runtimeTaskSource`, `taskBehaviorCode`, `taskDisplayGroup`, `displayTitle`, `assignedToType`, `displayToPatient`. **`orgId` from JWT**; patient fields from request body.

### PUT /tasks/{runtimeTaskInstanceId}/assigned-staff
**Required body:** `actorId`, `assignedToStaffId`, `assignedToStaffDisplayName`. **`orgId` from JWT** (scope check only).

**TransactWrite:** `UpdateItem` META (`assignedToStaffId`, `assignedToStaffDisplayName`, `gsi1Pk`, `lastUpdatedAt`, `lastUpdatedBy`; plus `gsi1Sk` on first assignment when not yet set); `UpdateItem` LOOKUP (`assignedToStaffId`, `assignedToStaffDisplayName`); `PutItem` HIST (`historyEventType=assignedToStaffChange`, previous/new staff id + display name, actor, reason). Allowed only when `assignedToType` is `staff`. META SK and `lsi1Sk` unchanged.

### PUT /tasks/{runtimeTaskInstanceId}/reminder-settings
**TransactWrite:** `UpdateItem` META (`reminderEnabled`, `reminderSettings`); `PutItem` HIST (`historyEventType=reminderSettingsChange`, previous/new settings, actor, reason). Outbound reminder jobs per REM-010.

### GET /tasks
**LSI1** `Query` patient PK, `begins_with(lsi1Sk, "CP#<carePlan>#")`; `FilterExpression` on `workflowStage`, `currentState` as needed; derive `surfaceSection` in service when API filter present.

### GET /action-center/items
**Base** `Query` patient PK, `begins_with(SK,"DUE#")`; optional `FilterExpression` on `displayToPatient`, `carePlanInstanceId`. Classify each item into `surfaceSection` in service from `currentState` + due window + context; return only items matching request `surfaceSection` (or group all sections when `All`).

### GET /tasks/{runtimeTaskInstanceId}
1. `GetItem` `TASK#<id>/LOOKUP` → `taskSk`, `dueWindowStart`, `dueWindowEnd`, `reminderHistory`, `evidenceSummary`
2. `GetItem` patient META via `taskSk` (resolve `patientId` from LOOKUP when needed for PK); merge schedule from LOOKUP or META (LOOKUP is snapshot at create)
3. If `includeRelated`: `Query` `TASK#<id>` `begins_with(SK,"HIST#")`; `Query` `begins_with(SK,"EVID#")`

### POST /tasks/{runtimeTaskInstanceId}/state

One **`TransactWriteItems`** per request (multiple items). **Always:**

| # | Item | Notes |
|---|------|-------|
| 1 | `UpdateItem` META | `currentState`, audit fields; condition matches **persisted** state (`scheduled` for in-progress); client sends **wire** `expectedCurrentState` |
| 2 | `PutItem` `HIST#<transitionAtMs13>#<taskStateHistoryId>` | `historyEventType = StateChange` |

**Conditional by target state** (service maps `action` → `toState`):

| toState | LOOKUP | EVID# | Outbound |
|---------|--------|-------|----------|
| **Completed** | `evidenceSummary` rollup + **cancel** `reminderHistory` | **Optional** — manual completion proof only (`completionSource=Manual`); linked complete uses event path with EVID | `CancelReminderJobs` |
| **Dismissed** | **Cancel** `reminderHistory` only | Not required | `CancelReminderJobs` |
| **Cancelled** | **Cancel** `reminderHistory` only | Not required | `CancelReminderJobs` |
| **Missed** | Optional `evidenceSummary` (`missedAt`); cancel reminders if any | Not required | — |
| **Active** / other | No LOOKUP evidence/reminder change | Not required | — |

`EVID#` is **not** written for every state update — only when the transition is a **completion with evidence** (manual complete with payload, or linked completion via `LinkedSourceObjectCompleted`, not generic dismiss/cancel).

**No** META SK / `lsi1Sk` / LOOKUP.`taskSk` change.

### GET /tasks/{runtimeTaskInstanceId}/history
`Query` `PK=TASK#<id>`, `begins_with(SK,"HIST#")`, `ScanIndexForward=false` (SK desc = newest first); validate `transitionAt` matches SK ms token.

### GET /care-plans/{carePlanInstanceId}/task-status-summary
**LSI1** `begins_with(lsi1Sk, "CP#<carePlan>#")` on patient PK → filter `workflowStage` in service → aggregate `requiredForStageCompletion`, counts, `ReadinessStatus`. Not persisted.

### GET /staff/tasks
**GSI1** `Query` `gsi1Pk=ORG#<org>#STAFF#<staffUserId>` (matches `assignedToStaffId`); optional `FilterExpression` on `patientId`, `carePlanInstanceId`, `currentState`; derive `surfaceSection` in service when API filter present.

---

## 4) Inbound events

| Event | Mapping |
|-------|---------|
| `CarePlanTaskGenerationTriggered` | Same as `POST /tasks/generate-care-plan` |
| `MonitoringActionRequested` | Same as `POST /tasks/monitoring-action` |
| `ServiceFlowActivated` | Same as `POST /tasks` |
| `LinkedSourceObjectCompleted` | **Requires `patientId`**. `Query` patient PK `DUE#` + filter completion ref → per task: `UpdateItem` META (no lsi1Sk change), `PutItem` HIST, conditional `PutItem` EVID, `UpdateItem` LOOKUP (`evidenceSummary` + cancel `reminderHistory`) |
| `SchedulerWindowExecution` | `GetItem` LOOKUP; `GetItem` META via `taskSk` for `currentState` / `reminderEnabled`; append `reminderHistory` on **LOOKUP**; outbound Scheduler/Notification only |

**Outbound (no DB rows):** `RegisterReminderJobs`, `CancelReminderJobs`, `SendReminderRequest`.

### reminderHistory on LOOKUP (no `REM#` items)

Reminders are **per task** — operational trail on **`TASK#<id>/LOOKUP`**. **`HIST#`** handles settings-change audit and optional register/cancel request audit (see §2.4).

| Command / event | LOOKUP `reminderHistory` | META | HIST# |
|-----------------|--------------------------|------|-------|
| `RegisterReminderJobs` | Append `Scheduled` entry | — | Optional `ReminderRegisterRequest` |
| `SendReminderRequest` | Append `Sent` row with `sentAt` | — | — (operational only on LOOKUP) |
| `CancelReminderJobs` / terminal state | Append `Cancelled` row per open `Scheduled` | `UpdateItem` state | Optional `ReminderCancelRequest`; state `HIST` if transition |
| Portal **settings** change | — | `reminderSettings`, `reminderEnabled` | **`reminderSettingsChange`** (required per v2) |
| `SchedulerWindowExecution` | Append after eligibility | Read `currentState`, `reminderEnabled` | — |

Cap LOOKUP list length (e.g. 50). Append-only audit — each row has `createdAt` only (no `updatedAt`).

### LinkedSourceObjectCompleted (required contract)

**Required on event:** `patientId`, `completionSourceType`, `completionSourceReferenceId`, `completionEventId`, `completedAt` (ms).

1. `Query` `PK=ORG#<org>#PAT#<patientId>`, `begins_with(SK,"DUE#")`
2. `FilterExpression`: `completionSourceType` + `completionSourceReferenceId`
3. Per match `TransactWriteItems`: `UpdateItem` META (`currentState`); `PutItem` `HIST#<transitionAtMs13>#<taskStateHistoryId>`; conditional `PutItem` `EVID#`; `UpdateItem` LOOKUP (`evidenceSummary`, cancel `reminderHistory`). **Do not** change `lsi1Sk` or META `SK`.

---

## 5) Idempotency

- META / HIST / EVID create: `attribute_not_exists(SK)`
- Care-plan / monitoring: deterministic `runtimeTaskInstanceId` from natural key + `generationHash`
- Linked completion: `EVID#<completionEventId>` conditional put

---

## 6) Enum quick reference (Metadata Registry + operational wire codes)

Registry-backed fields use **Metadata Registry value codes** (SCREAMING_SNAKE) in request examples — see `docs/services/task-service/api/open-api.yaml`. Operational enums (`currentState`, `surfaceSection`, `runtimeTaskSource`) use camelCase.

Metadata type codes map to these **value codes** (authoritative list is Metadata Registry; service persists codes verbatim).

| Type code | Value codes (Metadata Registry — use in API request examples) |
|-----------|-------------|
| **CurrentState** (wire) | `scheduled`, `active`, `completed`, `missed`, `dismissed`, `cancelled` |
| **CurrentState** (persisted META) | `scheduled` while in-progress; terminals `completed`, `missed` (legacy only), `dismissed`, `cancelled` — `active`/`missed` derived on read from schedule |
| **TaskBehaviorCode** | `INSTRUCTION`, `DOCUMENT_FORM`, `UPLOAD_DOCUMENT`, `DEVICE_SETUP`, `EDUCATION_VIDEO`, `EDUCATION_ARTICLE`, `CARE_TEAM_TASK`, `METRIC_CHECK_IN`, `SYMPTOM_CHECK_IN` |
| **TaskDisplayGroup** | `ACTION`, `LEARNING`, `CHECK_IN`, `STAFF_TASK` |
| **SurfaceSection** (derived, not stored) | `today`, `upcoming`, `needsAttention`, `history`, `carePlanChecklist` |
| **TaskWorkflowStage** | `ONBOARDING`, `ONGOING_CARE`, `FORMAL_REVIEW`, `CLOSURE` |
| **TaskGenerationTrigger** | `AT_CARE_PLAN_ACTIVATED`, `AT_CARE_PLAN_FULLY_ACTIVE`, `AT_REVIEW_DUE`, `AT_CARE_PLAN_CLOSURE`, `MANUAL` |
| **AssignedToType** | `PATIENT`, `CARE_TEAM_ROLE`, `USER`, `ORG_STAFF`, `SYSTEM` |
| **ReminderChannel** | `PUSH`, `SMS`, `EMAIL`, `IN_APP` |
| **CompletionSourceType** | `manual`, `document`, `education`, `deviceSetup`, `monitoring`, `symptom`, `otherApprovedSource` |
| **TransitionSource** | `manual`, `scheduler`, `sourceEvent`, `system` |
| **ReminderStatus** | `scheduled`, `sent`, `cancelled`, `failed`, `suppressed` |
| **ReadinessStatus** | `ready`, `notReady`, `notApplicable` |
| **runtimeTaskSource** | `carePlanTaskLinkage`, `monitoringRuntime`, `serviceFlowRuntime`, `manualSystem` |

---

## 7) Rules of thumb

- Patient partition = **META only**; due-sorted via `DUE#` in SK (immutable).
- Task partition = **LOOKUP** (reminder history + evidence summary) + **EVID** + **HIST**.
- Never hard-delete; terminal states stay queryable.
- Reminders: operational `reminderHistory` on **LOOKUP**; latest `reminderSettings` + `reminderEnabled` on META; **settings/register/cancel audit** on **HIST#**; no `REM#` items.
- **All instants:** API + DynamoDB use **epoch ms** (`integer` / `N`), not ISO strings — see §0.

---

## 8) Quick reference — keys and indexes

| Partition | PK | SK examples |
|-----------|----|-------------|
| Patient META | `ORG#<org>#PAT#<patient>` | `DUE#<dueMs13>#TASK#<id>` |
| Task | `TASK#<id>` | `LOOKUP`, `HIST#<ms13>#<histId>`, `EVID#<evidId>` |

| Index | Keys |
|-------|------|
| LSI1 `CarePlanIndex` | `lsi1Sk = CP#<carePlan\|NONE>#TASK#<id>` |
| GSI1 `StaffPatientTasksIndex` | `gsi1Pk = ORG#<org>#STAFF#<assignedToStaffId>`, `gsi1Sk = DUE#<dueMs13>#PAT#<patient>#TASK#<id>` (when `assignedToStaffId` set) |

**SK helpers:** `metaSK = DUE#<dueWindowStartOrMaxMs13>#TASK#<id>` (token = **dueWindowStart**) · `histSK = HIST#<transitionAtMs13>#<taskStateHistoryId>`

**Create:** `attribute_not_exists(SK)` on META, HIST, EVID. **Reminders:** `reminderHistory` on `TASK#…/LOOKUP`; `reminderEnabled` + `reminderSettings` on META.

---

## 9) Design review checklist (PK/SK/indexes + APIs/events)

Use this list to validate mappings against Requirements v2.

**Design:** single table · patient-centric META · task partition `TASK#<id>` · **1 LSI** · **1 GSI** · epoch **ms** · idempotency `attribute_not_exists(SK)`

### A) Keys and indexes

**Patient partition**
- **PK:** `ORG#<orgId>#PAT#<patientId>`
- **SK:** `DUE#<dueWindowStartOrMaxMs13>#TASK#<runtimeTaskInstanceId>` — **immutable**; ms token = **dueWindowStart**
- **Core META:** `dueWindowStart`, `dueWindowEnd`, `currentState`, `carePlanInstanceId`, `workflowStage`, `reminderEnabled`, `reminderSettings`, `lsi1Sk`, sparse `gsi1Pk`/`gsi1Sk`, `assignedToType` / `assignedToStaffId`, timestamps (ms) — **`surfaceSection` not stored**
- **Create:** `attribute_not_exists(SK)` — not `PK`
- **Not on patient PK:** `HIST#`, `EVID#`, `LOOKUP`, `REM#`, `SUMMARY#LATEST`

**Task partition (`TASK#<runtimeTaskInstanceId>`)**

| SK | Purpose |
|----|---------|
| `LOOKUP` | `taskSk`, `dueWindowStart`, `dueWindowEnd` (write-once), `reminderHistory[]`, `evidenceSummary` |
| `HIST#<transitionAtMs13>#<taskStateHistoryId>` | Append-only audit (time-ordered SK) |
| `EVID#<completionEvidenceId>` | Completion proof |

- **LOOKUP** does not store full state timeline — only rollup + reminder ops
- **Latest state:** META · **Timeline:** `HIST#` only

**LSI1:** `CP#<carePlanInstanceId|NONE>#TASK#<id>` — immutable; filter stage/state on META; derive surface in service  
**GSI1:** `ORG#<org>#STAFF#<assignedToStaffId>` + `DUE#<due>#PAT#<patient>#TASK#<id>` when `assignedToStaffId` set

### B) State / reminder / evidence

- **State transitions:** always `HIST#` `StateChange` on `POST .../state`
- **Staff reassignment:** `PUT /tasks/{id}/assigned-staff` — META `assignedToStaffId` + `gsi1Pk` + HIST
- **Reminder settings (latest):** META; **settings audit:** `HIST#`; **scheduled/sent/cancelled:** LOOKUP `reminderHistory`
- **`POST .../state`:** always META + HIST; **Completed** + LOOKUP + optional EVID; **Dismissed/Cancelled** + LOOKUP cancel only; **Missed** optional LOOKUP

### C) HTTP APIs (summary)

| API | Access |
|-----|--------|
| `POST /tasks/generate-care-plan` | Put META + HIST + LOOKUP |
| `POST /tasks`, monitoring-action | Same + GSI1 if staff |
| `GET /tasks`, action-center | Patient PK / LSI1 + filters |
| `GET /tasks/{id}` | LOOKUP → META via `taskSk`; optional HIST/EVID |
| `POST /tasks/{id}/state` | META + HIST; conditional LOOKUP/EVID |
| `GET /tasks/{id}/history` | Query `TASK#` `begins_with(HIST#)`, `ScanIndexForward=false` |
| `GET /care-plans/{id}/task-status-summary` | LSI1 + in-app aggregate |
| `GET /staff/tasks` | GSI1 |
| `PUT /tasks/{id}/assigned-staff` | META + LOOKUP + HIST `assignedToStaffChange` |
| `PUT /tasks/{id}/reminder-settings` | META + HIST `reminderSettingsChange` |

### D) Inbound events

| Event | DB summary |
|-------|------------|
| `CarePlanTaskGenerationTriggered` | Put META, HIST, LOOKUP |
| `MonitoringActionRequested` | Same pattern |
| `ServiceFlowActivated` | Same |
| `LinkedSourceObjectCompleted` | Query patient `DUE#` + filter; **`patientId` required** |
| `SchedulerWindowExecution` | LOOKUP + META; update `reminderHistory` |

### E) Outbound commands (no DynamoDB rows)

`RegisterReminderJobs` · `CancelReminderJobs` · `SendReminderRequest` — update LOOKUP / optional HIST audit after DB commit.

### F) Reject if design adds

`REM#` · `SUMMARY#LATEST` · `IDEMP#` · META SK rewrite · `LOOKUP.taskSk` update · `lsi1Sk` change on state · completion GSI · five-GSI task-centric layout

### G) Review questions

- All v2 access patterns with **patient PK + LSI1 + GSI1 + TASK#** only?
- **Immutable META SK** acceptable?
- **surfaceSection** derived in service (not stored / not DynamoDB filter) acceptable at volume?
- **Linked completion** without GSI with mandatory `patientId`?
- Transact **25-item** limit for batch care-plan create?
