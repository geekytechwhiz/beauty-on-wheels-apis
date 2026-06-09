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
| **LOOKUP `reminderHistory[]`** | `scheduledReminderAt`, `updatedAt`, optional `sentAt` |
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
| **CompletionEvidence** | `EVID#<completionEvidenceId>` | Separate append-only proof rows |
| **TaskStateHistory** | `HIST#<transitionAtMs13>#<taskStateHistoryId>` | Append-only; **SK time-ordered** (13-digit ms + id); `transitionAt` must match SK ms |

**Not used:** `SUMMARY#LATEST`, patient `SUM#TASK#...#LATEST`, `REM#`, `IDEMP#`.

### LSI1 — `CarePlanIndex` (META only)

- `lsi1Sk` = `CP#<carePlanInstanceId|NONE>#TASK#<runtimeTaskInstanceId>` — **care plan + task id only** (no stage/state/due in LSI SK)
- Set at create; **immutable** (does not change when `currentState` or `workflowStage` updates)
- **Stage / state / due filters:** `FilterExpression` on META attributes (`workflowStage`, `currentState`, `dueWindowStart`, `dueWindowEnd`, etc.) after LSI query
- Tasks without a care plan: `CP#NONE#TASK#<runtimeTaskInstanceId>`

### GSI1 — `StaffPatientTasksIndex` (META only, sparse)

- `gsi1Pk` = `ORG#<orgId>#STAFF#<ownerUserId>` when `ownerType = User` (staff inbox by user)
- `gsi1Sk` = `DUE#<dueWindowStartOrMaxMs>#PAT#<patientId>#TASK#<runtimeTaskInstanceId>` (same **dueWindowStart** ms token as META SK)
- **Immutable** `gsi1Sk` if due fixed; update **`gsi1Pk`** (and `ownerUserId` / `assignedToStaffId`) on user reassignment
- `ownerType = Role` or `Team`: no GSI1 row unless product maps a queue user; list via patient PK + `FilterExpression` on `ownerRoleCode` / `ownerTeamId`
- **`assignedToStaffId`:** keep when `ownerType = User`; should match `ownerUserId` for GSI1 and API compatibility

### Summaries (requirements §11)

| Summary | Stored? | Access |
|---------|---------|--------|
| **TaskevidenceSummary** | Yes — `evidenceSummary` on **LOOKUP** | `GetItem` `TASK#<id>/LOOKUP` |
| **Reminder history** | Yes — `reminderHistory` on **LOOKUP** | `GetItem` `TASK#<id>/LOOKUP` (same read as summary) |
| **TaskStatusSummaryByCarePlan** | No — computed | LSI1 query + aggregate |
| **ChecklistReadinessSummary** | TBD | — |

### CompletionEvidence vs evidenceSummary vs reminders (task partition)

| | **EVID#** | **evidenceSummary** (LOOKUP) | **reminderHistory** (LOOKUP) | **HIST#** (reminder-related) |
|--|-----------|------------------------------|------------------------------|------------------------------|
| Role | Completion proof | Latest rollup | **Operational** send/register/cancel trail | **Audit** settings change + register/cancel **requests** |
| Example | Linked form submit | “Completed” summary | `Scheduled` → `Sent` on one `reminderRecordId` | Portal changed channels; `RegisterReminderJobs` called |

**META** keeps `reminderEnabled` (eligibility) and optional **`reminderSettings`** (latest config — Requirements v2 REM-007).

**Do not conflate:** `reminderHistory` on LOOKUP is for scheduler/send outcomes; **reminder setting changes** and compliance audit belong on **`HIST#`** (same partition as state/owner history), per Requirements v2.

---

## 2) Item attributes

### 2.1 META — `RuntimeTaskInstance`

**Keys:** `PK = ORG#<orgId>#PAT#<patientId>`, `SK = DUE#<dueWindowStartOrMaxMs>#TASK#<runtimeTaskInstanceId>`

| Attribute | Req | Type | Notes |
|-----------|-----|------|-------|
| `entityType` | R | S | `RuntimeTaskInstance` |
| `orgId`, `patientId`, `runtimeTaskInstanceId` | R | S | |
| `runtimeTaskSource` | R | S | `CarePlanTaskLinkage` \| `MonitoringRuntime` \| `ServiceFlowRuntime` \| `ManualSystem` |
| `taskBehaviorCode`, `taskDisplayGroup`, `displayTitle` | R | S | |
| `assignedToType`, `displayToPatient`, `currentState` | R | S / BOOL | |
| `createdAt`, `createdBy`, `lastUpdatedAt`, `lastUpdatedBy` | R | **N** / S | instants = **N** (ms) |
| `assignedToStaffId` | C | S | When `ownerType = User`; mirror of `ownerUserId` for GSI1 / legacy API |
| `ownerType` | C | S | `User` \| `Role` \| `Team` — care-manager/staff tasks (Requirements v2) |
| `ownerUserId` | C | S | When `ownerType = User`; drives `gsi1Pk` |
| `ownerRoleCode` | C | S | When `ownerType = Role` |
| `ownerTeamId` | C | S | When `ownerType = Team` |
| `ownerDisplayName` | O | S | Display label for portal staff queue |
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
| `dueWindowStart`, `dueWindowEnd` | C/O | **N** (ms) — **write-once** schedule snapshot (same as META at create) |
| `carePlanInstanceId`, `assignedToStaffId` | O | Convenience copy for reads |
| `ownerType`, `ownerUserId`, `ownerRoleCode`, `ownerTeamId`, `ownerDisplayName` | O | Mirror of META ownership (optional on LOOKUP) |
| `reminderHistory` | O | List of maps — **canonical** per-task reminder audit; append on register/send/cancel; cap length |
| `evidenceSummary` | O | Map (§11.4 fields); set on complete/miss rollup |

**reminderHistory entry:** `reminderRecordId` (S), `scheduledReminderAt` (**N** ms), `reminderChannel` (S), `reminderStatus` (S), `updatedAt` (**N** ms), optional `sentAt` (**N** ms), optional `schedulerJobId` (S). Dedupe by `reminderRecordId`.

**evidenceSummary map fields:** `taskevidenceSummaryId` (S), `generatedAt` (**N**), `runtimeTaskSource`, `taskBehaviorCode`, `taskDisplayGroup`, `currentState`, optional `carePlanInstanceId`, `workflowStage`, `requiredForStageCompletion`, `completedAt` (**N**), `missedAt` (**N**), `completionSourceType`, `completionSourceReferenceId`, `latestCompletionSummary` (S).

### 2.3 EVID — `CompletionEvidence`

**Keys:** `PK = TASK#<id>`, `SK = EVID#<completionEvidenceId>` · **Condition:** `attribute_not_exists(SK)`

| Attribute | Req | Notes |
|-----------|-----|-------|
| `completionEvidenceId`, `runtimeTaskInstanceId`, `orgId`, `patientId` | R | |
| `completionSource`, `completedAt` | R | `completedAt` = **N** (ms) |
| `completionSourceType`, `completionSourceReferenceId`, `completionEventId` | C | Linked completion |
| `evidencePayload`, `evidenceType`, `evidenceVersion` | O | |

### 2.4 HIST — task history / audit (state, ownership, reminders)

**Keys:** `PK = TASK#<id>`, `SK = HIST#<transitionAtMs13>#<taskStateHistoryId>` · **Condition:** `attribute_not_exists(SK)`

```text
histSK = "HIST#" + String(transitionAt).padStart(13, "0") + "#" + taskStateHistoryId
```

One append-only stream per task. Requirements v2: include **state transitions**, **ownership changes**, **reminder setting changes**, and **reminder register/cancel requests** — not only `currentState` changes.

| Attribute | Req | Notes |
|-----------|-----|-------|
| `taskStateHistoryId`, `runtimeTaskInstanceId`, `transitionAt`, `transitionBy`, `transitionSource` | R | `transitionAt` = **N** (ms) |
| `historyEventType` | R | `stateChange` \| `ownerChange` \| `reminderSettingsChange` \| `reminderRegisterRequest` \| `reminderCancelRequest` |
| `toState`, `fromState` | C | Required when `historyEventType = stateChange` |
| `transitionReason`, `sourceEventId` | O | |
| `previousOwnerType`, `previousOwnerUserId`, `previousOwnerRoleCode`, `previousOwnerTeamId` | C | When `historyEventType = ownerChange` |
| `newOwnerType`, `newOwnerUserId`, `newOwnerRoleCode`, `newOwnerTeamId` | C | |
| `previousReminderEnabled`, `newReminderEnabled` | C | When `historyEventType = reminderSettingsChange` |
| `previousReminderSettings`, `newReminderSettings` | C | Map — v2 REM-008 audit |
| `reminderRecordId`, `reminderChannel`, `schedulerJobId` | C | When register/cancel request events |
| `previousReminderStatus`, `newReminderStatus` | O | Optional on HIST if product wants status-change audit in timeline (else use LOOKUP `reminderHistory` only) |

**Reminder setting change (portal, FR-TASK-REM-006–008):**

1. `UpdateItem` META and/or LOOKUP — set latest `reminderSettings`, `reminderEnabled`
2. `PutItem` HIST — `historyEventType = reminderSettingsChange`, previous/new settings, actor, reason
3. Outbound `RegisterReminderJobs` / `CancelReminderJobs` per REM-010
4. On register/cancel command: optional `PutItem` HIST — `reminderRegisterRequest` / `reminderCancelRequest`; append operational row on LOOKUP `reminderHistory` when job is scheduled/sent

Patient mobile / standard portal task UI: show **current** `reminderEnabled` / settings only — not full HIST reminder audit (v2 REM-009).

### Staff task ownership (Requirements v2)

| Rule | Detail |
|------|--------|
| Initial owner | From create request or source service — set `Owner*` on META at `PutItem` |
| Reassign | Portal only for care-manager/staff tasks (`CARE_TEAM_TASK`, `taskDisplayGroup = StaffTask`, `displayToPatient = false` unless product allows) |
| Writes | `UpdateItem` META (`Owner*`, `assignedToStaffId` when `User`); update `gsi1Pk` if `ownerUserId` changes; `PutItem` HIST with previous/new owner fields |
| Out of scope | Does not update Task Template, Care Plan Linkage, Monitoring Instance, or source-domain objects |
| Patient tasks | Forms, education, check-ins, device setup — no owner-change UI by default |

---

## 3) API → DynamoDB

### GET /health
No DynamoDB.

### POST /tasks/generate-care-plan
**TransactWrite per task:** conditional `PutItem` META (`attribute_not_exists(SK)`), `PutItem` HIST on `TASK#<id>`, `PutItem` LOOKUP. Set `lsi1Sk` at create; GSI1 if staff-assigned.

**Required request fields:** `patientId`, `carePlanInstanceId`, `taskGenerationTrigger`, `sourceLinkageContext.linkages` (min 1).

**Required per linkage:** `carePlanTaskLinkageId`, `taskBehaviorCode`, `taskDisplayGroup`, `displayTitle`, `assignedToType`, `displayToPatient`, `dueWindowStart`, `dueWindowEnd`.

### POST /tasks/monitoring-action
Same pattern; idempotency hash: `patientId|monitoringInstanceId|taskBehaviorCode|dueWindowStart|dueWindowEnd`.

### POST /tasks
META + HIST + LOOKUP; set `Owner*` from body; GSI1 when `ownerType = User` (`ownerUserId`, `assignedToStaffId`).

### PUT /tasks/{runtimeTaskInstanceId}/reminder-settings
**TransactWrite:** `UpdateItem` META (`reminderEnabled`, `reminderSettings`); `PutItem` HIST (`historyEventType=reminderSettingsChange`, previous/new settings, actor, reason). Outbound reminder jobs per REM-010.

### PUT /tasks/{runtimeTaskInstanceId}/owner
**TransactWrite:** `UpdateItem` META (`Owner*`, `assignedToStaffId`, `gsi1Pk` if `ownerUserId` changes); `PutItem` HIST (`historyEventType=OwnerChange`, previous/new owner fields). **No** META SK / `lsi1Sk` change.

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
| 1 | `UpdateItem` META | `currentState`, audit fields; condition `currentState = expectedCurrentState` |
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
**GSI1** `Query` `gsi1Pk=ORG#<org>#STAFF#<staffUserId>` (matches `ownerUserId` when `ownerType = User`); optional `FilterExpression` on `patientId`, `ownerRoleCode`, `ownerTeamId`; derive `surfaceSection` in service when API filter present.

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
| `SendReminderRequest` | Upsert → `Sent`, `sentAt` | — | — (operational only on LOOKUP) |
| `CancelReminderJobs` / terminal state | Mark `Cancelled` | `UpdateItem` state | Optional `ReminderCancelRequest`; state `HIST` if transition |
| Portal **settings** change | — | `reminderSettings`, `reminderEnabled` | **`reminderSettingsChange`** (required per v2) |
| `SchedulerWindowExecution` | Append/update after eligibility | Read `currentState`, `reminderEnabled` | — |

Cap LOOKUP list length (e.g. 50). Dedupe by `reminderRecordId`.

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

## 6) Enum quick reference

- **runtimeTaskSource:** `CarePlanTaskLinkage` · `MonitoringRuntime` · `ServiceFlowRuntime` · `ManualSystem`
- **currentState:** `Scheduled` · `Active` · `Completed` · `Missed` · `Dismissed` · `Cancelled`
- **surfaceSection** (API only, derived): `Today` · `Upcoming` · `NeedsAttention` · `History` · `CarePlanChecklist`
- **transitionSource:** `Manual` · `Scheduler` · `SourceEvent` · `System`
- **ReadinessStatus:** `Ready` · `NotReady` · `NotApplicable`

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
| GSI1 `StaffPatientTasksIndex` | `gsi1Pk = ORG#<org>#STAFF#<ownerUserId>`, `gsi1Sk = DUE#<dueMs13>#PAT#<patient>#TASK#<id>` (when `ownerType=User`) |

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
- **Core META:** `dueWindowStart`, `dueWindowEnd`, `currentState`, `carePlanInstanceId`, `workflowStage`, `reminderEnabled`, `reminderSettings`, `lsi1Sk`, sparse `gsi1Pk`/`gsi1Sk`, `Owner*` / `assignedToStaffId`, timestamps (ms) — **`surfaceSection` not stored**
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
**GSI1:** `ORG#<org>#STAFF#<ownerUserId>` + `DUE#<due>#PAT#<patient>#TASK#<id>` when `ownerType=User`

### B) State / reminder / evidence

- **State transitions:** always `HIST#` `StateChange` on `POST .../state`
- **Ownership:** META + `HIST#` `OwnerChange`
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
| `PUT /tasks/{id}/reminder-settings` | META + HIST `reminderSettingsChange` |
| `PUT /tasks/{id}/owner` | META + HIST `OwnerChange`; gsi1Pk if user changes |

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
