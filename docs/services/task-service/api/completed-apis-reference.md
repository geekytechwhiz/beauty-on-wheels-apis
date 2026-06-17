# Task Service — Completed APIs Reference

> **Scope:** All HTTP APIs currently wired in `apps/task-service/serverless.yml` (12 endpoints).  
> **Last aligned with code:** task-service + `@api-hub/task-core` as implemented today.  
> **Related:** [OpenAPI](./open-api.yaml) · [DynamoDB mapping](../../../apps/task-service/development-files/option-b-db-mapping.md)

---

## Shared conventions

### Authentication & tenancy

| Source | Resolution |
|--------|------------|
| `Authorization: Bearer <JWT>` | Required on all endpoints except `/health` (authorizer commented out on `createMonitoringAction` in serverless; still resolves org from token when present) |
| Organization | `orgId` from JWT claim (`custom:organizationID`) — **never** from request body |
| Patient scope | `patientId`, `patientDisplayName` from **request body** (create/list query) — **never** from JWT |
| Actor (`createdBy`, `actorId`) | Derived in validators from JWT or system actor constants |

### DynamoDB table

| Env var | Purpose |
|---------|---------|
| `TASK_TABLE` | Single table for META, LOOKUP, HIST, EVID items |

### Key patterns

| Item | PK | SK |
|------|----|----|
| **META** (runtime task) | `ORG#<orgId>#PAT#<patientId>` | `DUE#<dueWindowStartOrMaxMs13>#TASK#<runtimeTaskInstanceId>` |
| **LOOKUP** | `TASK#<runtimeTaskInstanceId>` | `LOOKUP` |
| **HIST** | `TASK#<runtimeTaskInstanceId>` | `HIST#<transitionAtMs13>#<taskStateHistoryId>` |
| **EVID** | `TASK#<runtimeTaskInstanceId>` | `EVID#...` |

**Indexes used by completed APIs:**

| Index | On | Used by |
|-------|-----|---------|
| Base table PK/SK | Patient partition | `GET /tasks` (default), all META/LOOKUP/HIST reads |
| `CarePlanIndex` (LSI1) | `lsi1Sk = CP#<carePlanInstanceId>#TASK#<id>` | `GET /tasks?carePlanInstanceId=...` |
| `StaffPatientTasksIndex` (GSI1) | `gsi1Pk`, `gsi1Sk` | `GET /staff/tasks`; written on staff-assigned creates / first `PUT .../assigned-staff` |

`dueWindowStartOrMaxMs` = `dueWindowStart ?? dueWindowEnd ?? 9999999999999` (13-digit zero-padded in SK).

### HTTP response envelope

All handlers use the platform `ApiResponse` wrapper:

```json
{
  "success": true,
  "statusCode": 200,
  "message": {
    "title": "SUCCESS",
    "description": "Request processed successfully",
    "severity": "SUCCESS"
  },
  "data": { },
  "error": null,
  "meta": {
    "correlationId": "<uuid>",
    "timestamp": "2026-06-09T12:00:00.000Z",
    "version": "v1"
  }
}
```

Handler return values below describe the **`data`** object only.

### `RuntimeTaskCard` (shared list/detail shape)

META fields returned to clients (DDB keys stripped):

| Field | Type | Notes |
|-------|------|-------|
| `runtimeTaskInstanceId` | string | |
| `orgId` | string | from JWT at create (persisted on META) |
| `patientId`, `patientDisplayName` | string | from request input at create (persisted on META) |
| `runtimeTaskSource` | enum | `carePlanTaskLinkage`, `monitoringRuntime`, `serviceFlowRuntime`, `manualSystem` |
| `taskBehaviorCode` | string | e.g. `METRIC_CHECKIN`, `CARE_TEAM_TASK` |
| `taskDisplayGroup` | enum | `action`, `learning`, `checkIn`, `staffTask` |
| `displayTitle`, `description` | string | |
| `assignedToType` | enum | `patient`, `staff` |
| `assignedToStaffId`, `assignedToStaffDisplayName` | string | optional |
| `currentState` | enum | `open` (in-progress), `completed`, `missed`, `dismissed`, `cancelled` — legacy `active`/`scheduled` rows normalized to `open` on read |
| `dueWindowStart`, `dueWindowEnd` | number (epoch ms) | UI derives today / upcoming / needsAttention from these + `now` |
| `carePlanInstanceId`, `workflowStage`, … | various | other optional META fields when present |

> **`surfaceSection` is returned only by GET `/action-center/items`** (server-derived). Other list/detail APIs do not include it.

---

## API index

| # | Method | Path | DB op | Idempotent |
|---|--------|------|-------|------------|
| 1 | GET | `/health` | none | — |
| 2 | POST | `/tasks/monitoring-action` | TransactWrite ×3 Put | yes |
| 3 | POST | `/tasks/generate-care-plan` | TransactWrite ×3 Put per linkage | yes (per linkage) |
| 4 | GET | `/tasks` | Query (+ filter) | — |
| 5 | POST | `/tasks` | TransactWrite ×3 Put | no |
| 6 | GET | `/tasks/{runtimeTaskInstanceId}` | Get ×2–4 | — |
| 7 | GET | `/tasks/{runtimeTaskInstanceId}/history` | Get + Query | — |
| 8 | PUT | `/tasks/{runtimeTaskInstanceId}/assigned-staff` | TransactWrite Update×2 + Put | no |
| 9 | GET | `/staff/tasks` | Query GSI1 | — |
| 10 | GET | `/action-center/items` | Query patient / LSI | — |
| 11 | POST | `/tasks/{runtimeTaskInstanceId}/state` | TransactWrite Update×2 + Put (+ optional EVID) | no |
| 12 | GET | `/care-plans/{carePlanInstanceId}/task-status-summary` | Query LSI1 + aggregate | — |
| 13 | PUT | `/tasks/{runtimeTaskInstanceId}/reminder-settings` | TransactWrite META + HIST (1–3 puts) | no |
| 14 | PATCH | `/tasks/{runtimeTaskInstanceId}` | TransactWrite Update×1–2 + Put | no |

---

## 1. GET `/health`

**Purpose:** Liveness probe.

### Input

| Source | Fields |
|--------|--------|
| Headers | none required |
| Query / path / body | none |

### Database

No DynamoDB access.

### Response (`data`)

```json
{
  "status": "healthy",
  "service": "task-service",
  "timestamp": "2026-06-09T12:00:00.000Z",
  "requestId": "<awsRequestId or correlationId>",
  "region": "us-east-1",
  "stage": "dev"
}
```

**HTTP:** `200`

---

## 2. POST `/tasks/monitoring-action`

**Purpose:** Create a monitoring-runtime task (idempotent natural key).  
**Caller:** Monitoring Runtime.

### Input

**Headers:** `Authorization: Bearer <JWT>`

**Body** (Zod structural validation; business rules in task-core):

| Field | Type | Required |
|-------|------|----------|
| `patientId` | string | yes |
| `patientDisplayName` | string | yes |
| `carePlanInstanceId` | string | yes |
| `monitoringInstanceId` | string | yes |
| `taskBehaviorCode` | string | yes |
| `assignedToType` | string | yes | `patient` or `staff` |
| `assignedToStaffId` | string | when staff | Required with `assignedToStaffDisplayName` when `assignedToType` is `staff` |
| `assignedToStaffDisplayName` | string | when staff | Drives GSI1 staff inbox with `assignedToStaffId` |
| `dueWindowStart` | number (epoch ms) | yes |
| `dueWindowEnd` | number (epoch ms) | yes |
| `reminderContext` | object \| null | no |

**Resolved server-side:** `organizationId` from JWT only. `patientId`, `patientDisplayName`, and all other body fields come from the **request body**.

### Idempotency key

```
orgId|patientId|monitoringInstanceId|taskBehaviorCode|dueWindowStart|dueWindowEnd|assignedToType|assignedToStaffIdOrEmpty
→ runtimeTaskInstanceId = rtask-<sha256-prefix-32>
```

### Database flow

**Step 1 — resolve (read):**

```
GetItem  pk = TASK#<runtimeTaskInstanceId>, sk = LOOKUP
  → if missing: proceed to create
  → if org mismatch: 409 IDEMPOTENCY_KEY_IN_USE
  → if exists + same org: return existing META (skippedDuplicate)
```

**Step 2 — create (TransactWrite, all conditional `attribute_not_exists(sk)`):**

| # | Item | PK | SK | Key attributes |
|---|------|----|----|----------------|
| 1 | **META** | `ORG#<org>#PAT#<patient>` | `DUE#<dueMs13>#TASK#<id>` | `entityType=RuntimeTaskInstance`, `runtimeTaskSource=monitoringRuntime`, `assignedToType` (`patient` or `staff` from request), `displayToPatient` (`true` for patient, `false` for staff), `taskBehaviorCode`, `displayTitle` (from behavior), `taskDisplayGroup` (`staffTask` when `staff`), `currentState=open`, `dueWindowStart`, `dueWindowEnd`, `reminderEnabled`, optional `reminderSettings`, `assignedToStaffId` + `assignedToStaffDisplayName` + GSI1 when `staff`, `idempotencyKey`, `generationHash`, `lsi1Sk=CP#<carePlan>#TASK#<id>`, `createdAt/By`, `lastUpdatedAt/By`, `version=1` |
| 2 | **LOOKUP** | `TASK#<id>` | `LOOKUP` | `taskSk` (full META sk), `orgId`, `patientId`, `patientDisplayName`, `dueWindowStart`, `dueWindowEnd`, `carePlanInstanceId`, optional staff fields, `reminderHistory=[]` |
| 3 | **HIST** | `TASK#<id>` | `HIST#<nowMs13>#<uuid>` | `historyEventType=stateChange`, `toState=<initial>`, `transitionAt=now`, `transitionBy=system:monitoring-runtime`, `transitionSource=system` |

### Response (`data`)

```json
{
  "runtimeTaskInstanceId": "rtask-abc123...",
  "outcome": "created",
  "task": { }
}
```

| `outcome` | Meaning |
|-----------|---------|
| `created` | New META + LOOKUP + HIST written |
| `skippedDuplicate` | Idempotent replay; existing task returned |

**HTTP:** `200` (create and duplicate both 200) · `401` · `409` (cross-org key) · `422`

---

## 3. POST `/tasks/generate-care-plan`

**Purpose:** Batch-create care-plan linkage tasks (idempotent per linkage).  
**Caller:** Care Plan Runtime.

### Input

**Headers:** `Authorization: Bearer <JWT>`

**Body:**

| Field | Type | Required |
|-------|------|----------|
| `patientId` | string | yes |
| `patientDisplayName` | string | yes |
| `carePlanInstanceId` | string | yes |
| `taskGenerationTrigger` | string | yes |
| `workflowStage` | string | no |
| `dryRun` | boolean | no |
| `actorType` | string | no |
| `actorId` | string | no |
| `sourceLinkageContext.linkages[]` | array | yes (min 1) |

**Each linkage:**

| Field | Type | Required |
|-------|------|----------|
| `carePlanTaskLinkageId` | string | yes |
| `taskBehaviorCode` | string | yes |
| `taskDisplayGroup` | string | yes |
| `displayTitle` | string | yes |
| `assignedToType` | string | yes | `patient` or `staff` |
| `displayToPatient` | boolean | yes |
| `dueWindowStart` | number | yes |
| `dueWindowEnd` | number | yes |
| `sourceTaskTemplateVersionId`, `description`, `assignedToStaffId`, `assignedToStaffDisplayName`, `actionTargetId`, `completionSourceType`, `completionSourceReferenceId`, `reminderEnabled`, `reminderSettings`, `requiredForStageCompletion`, `displayAsChecklistItem` | various | no |

**Resolved server-side:**

- `organizationId` from JWT only
- `createdBy` = `system:care-plan-runtime` or `system:care-plan-runtime:<actorId>`

All other persisted patient and linkage fields (`patientId`, `patientDisplayName`, `carePlanInstanceId`, linkage materialization) come from the **request body**.

### Idempotency key (per linkage)

```
orgId|patientId|carePlanInstanceId|carePlanTaskLinkageId|resolvedDueWindowStart|dueWindowEnd
→ runtimeTaskInstanceId = rtask-<sha256-prefix-32>
```

### Database flow

For each linkage:

- **`dryRun: true`** — no DynamoDB writes; builds in-memory META card only.
- **`dryRun: false`** — same pattern as monitoring:
  1. `GetItem` LOOKUP → resolve idempotency
  2. `TransactWrite` 3× `Put` (META + LOOKUP + HIST)

**META keys**

| Attribute | Value |
|-----------|--------|
| `pk` | `ORG#<orgId>#PAT#<patientId>` — `orgId` from JWT, `patientId` from input |
| `sk` | `DUE#<dueWindowStartOrMaxMs13>#TASK#<runtimeTaskInstanceId>` |

**META attributes (server-derived + input)**

| Attribute | Value |
|-----------|--------|
| `entityType` | `RuntimeTaskInstance` |
| `orgId` | from JWT |
| `patientId`, `patientDisplayName` | from input |
| `runtimeTaskInstanceId` | deterministic hash |
| `runtimeTaskSource` | `carePlanTaskLinkage` |
| `carePlanInstanceId`, `taskGenerationTrigger` | from input |
| `carePlanTaskLinkageId` | from linkage |
| `workflowStage` | from input (optional) |
| `sourceTaskTemplateVersionId` | from linkage (optional) |
| `taskBehaviorCode`, `taskDisplayGroup`, `displayTitle` | from linkage |
| `description` | from linkage (optional) |
| `assignedToType`, `displayToPatient` | from linkage |
| `assignedToStaffId`, `assignedToStaffDisplayName` | from linkage (required when `assignedToType` is `staff`) |
| `actionTargetId`, `completionSourceType`, `completionSourceReferenceId` | from linkage (optional) |
| `currentState` | `open` |
| `dueWindowStart` | resolved: `dueWindowStart` if set, else `dueWindowEnd` |
| `dueWindowEnd` | from linkage |
| `reminderEnabled`, `reminderSettings` | from linkage (optional; only written when provided) |
| `requiredForStageCompletion`, `displayAsChecklistItem` | from linkage (optional) |
| `idempotencyKey`, `generationHash` | from hash logic |
| `lsi1Sk` | `CP#<carePlanInstanceId>#TASK#<id>` (always) |
| `gsi1Pk`, `gsi1Sk` | only when `assignedToStaffId` is set |
| `createdAt` / `createdBy`, `lastUpdatedAt` / `lastUpdatedBy` | now / `system:care-plan-runtime` (+ optional `:<actorId>`) |
| `version` | `1` |

Patient linkages (`assignedToType: patient`, no `assignedToStaffId`) — **no GSI1**.

**LOOKUP** (`TASK#<id>` / `LOOKUP`): `taskSk`, `orgId`, `patientId`, `patientDisplayName` (from input), `dueWindowStart`, `dueWindowEnd`, `carePlanInstanceId`, optional staff fields, `reminderHistory=[]`.

**HIST** (`TASK#<id>` / `HIST#<nowMs13>#<uuid>`): `historyEventType=stateChange`, `toState=open`, `transitionBy=<createdBy>`, `transitionSource=system`, `transitionReason=carePlanTaskLinkage create (<taskGenerationTrigger>)`.

### Response (`data`)

```json
{
  "results": [
    {
      "runtimeTaskInstanceId": "rtask-...",
      "outcome": "created",
      "task": { }
    }
  ]
}
```

**HTTP:** `200` · `401` · `409` · `422`

---

## 4. GET `/tasks`

**Purpose:** Patient-scoped task list split into patient-facing and staff-assigned buckets.  
**Sort:** `dueWindowStart` ascending within each bucket (re-sorted in service after DDB page).

### Input

**Headers:** `Authorization: Bearer <JWT>`

**Query parameters:**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `patientId` | string | **yes** | |
| `staffUserId` | string | no | When set, populates `staffTasks` for that staff member; staff-assigned rows never appear in `patientTasks` |
| `carePlanInstanceId` | string | no | Switches to LSI `CarePlanIndex` |
| `workflowStage` | enum | no | `onboarding`, `ongoing`, `review`, `closure` |
| `currentState` | enum | no | When omitted, terminal states (`completed`, `missed`, `dismissed`, `cancelled`) are excluded at query time |
| `pageSize` | integer | no | default `50`, max `200` |
| `nextToken` | string | no | Opaque pagination cursor (single token for the underlying patient query) |

**Resolved server-side:** `organizationId` from JWT.

### Database query

**Path A — no `carePlanInstanceId` (due-date sort order):**

```
Query  TableName = TASK_TABLE
       KeyConditionExpression: pk = :pk AND begins_with(sk, :duePrefix)
       :pk   = ORG#<orgId>#PAT#<patientId>
       :duePrefix = DUE#
       FilterExpression: entityType = RuntimeTaskInstance
                         [AND workflowStage = :workflowStage]
                         [AND currentState = :currentState]
                         [AND currentState <> terminal states when currentState omitted]
       Limit = pageSize
       ExclusiveStartKey = decoded(nextToken)  // if provided
```

**Path B — with `carePlanInstanceId`:**

```
Query  IndexName = CarePlanIndex
       KeyConditionExpression: pk = :pk AND begins_with(lsi1Sk, :cpPrefix)
       :cpPrefix = CP#<carePlanInstanceId>#
       (same FilterExpression and pagination)
```

**In-memory split (service):**

- `patientTasks`: rows **without** `assignedToStaffId`
- `staffTasks`: rows **with** `assignedToStaffId` matching `staffUserId` when provided; otherwise empty

### Response (`data`)

```json
{
  "patientId": "pat-101",
  "staffUserId": "staff-nurse-44721",
  "patientTasks": {
    "items": [
      {
        "runtimeTaskInstanceId": "rtask-...",
        "patientId": "pat-101",
        "displayTitle": "Log your blood pressure",
        "currentState": "open",
        "dueWindowStart": 1780581600000,
        "dueWindowEnd": 1780668000000
      }
    ]
  },
  "staffTasks": {
    "items": []
  },
  "nextToken": "<opaque>"
}
```

**HTTP:** `200` · `400` · `401`

---

## 5. POST `/tasks`

**Purpose:** Ad-hoc / service-flow / manual runtime task create (non-idempotent).  
**Callers:** Service Flow Runtime, care UI (`manualSystem`).

### Input

**Headers:** `Authorization: Bearer <JWT>`

**Body:**

| Field | Type | Required |
|-------|------|----------|
| `patientId` | string | yes |
| `patientDisplayName` | string | yes |
| `runtimeTaskSource` | string | yes | `serviceFlowRuntime` \| `manualSystem` |
| `taskBehaviorCode` | string | yes |
| `taskDisplayGroup` | string | yes |
| `displayTitle` | string | yes |
| `assignedToType` | string | yes | `patient` or `staff` |
| `displayToPatient` | boolean | yes |
| `carePlanInstanceId` | string | no |
| `workflowStage` | string | no |
| `description` | string | no |
| `assignedToStaffId` | string | when `staff` | Required with `assignedToStaffDisplayName`; sets GSI1 |
| `assignedToStaffDisplayName` | string | when `staff` | |
| `actionTargetId` | string | no |
| `completionSourceType` | string | no |
| `completionSourceReferenceId` | string | no |
| `dueWindowStart` | number | no |
| `dueWindowEnd` | number | no |
| `reminderEnabled` | boolean | no |
| `requiredForStageCompletion` | boolean | no |
| `displayAsChecklistItem` | boolean | no |

**Resolved server-side:**

- `organizationId` from JWT only
- `patientId`, `patientDisplayName`, and all other body fields from the **request body**
- `createdBy` = `system:service-flow-runtime` OR `user:<jwtUserId>` when `runtimeTaskSource=manualSystem`
- `runtimeTaskInstanceId` = `rtask-<randomUUID>` (non-deterministic)
- **GSI1** only when `assignedToStaffId` is set at create (patient tasks — no GSI1)

### Database flow

**TransactWrite** (3× `Put`, `attribute_not_exists(sk)`):

| # | Item | Notes |
|---|------|-------|
| 1 | **META** | `runtimeTaskSource` from body; `currentState` = `scheduled` if future `dueWindowStart`, else `active`; optional GSI1 when staff assigned |
| 2 | **LOOKUP** | `taskSk`, schedule snapshot, optional staff fields |
| 3 | **HIST** | `stateChange`; `transitionSource=manual` for `manualSystem`, else `system` |

### Response (`data`)

```json
{
  "runtimeTaskInstanceId": "rtask-<uuid>",
  "task": { }
}
```

**HTTP:** `200` · `401` · `422` · `500`

---

## 6. GET `/tasks/{runtimeTaskInstanceId}`

**Purpose:** Single task detail with optional related records.

### Input

**Headers:** `Authorization: Bearer <JWT>`

**Path:**

| Param | Required |
|-------|----------|
| `runtimeTaskInstanceId` | yes |

**Query:**

| Param | Default | Notes |
|-------|---------|-------|
| `includeRelated` | `true` | Set `false` to omit reminders, evidence |

**Resolved server-side:** `organizationId` from JWT.

### Database flow

```
1. GetItem  pk = TASK#<id>, sk = LOOKUP
   → 404 if missing
   → 403 if lookup.orgId ≠ JWT org

2. GetItem  pk = ORG#<org>#PAT#<patient>, sk = lookup.taskSk
   → 404 if META missing

3. If includeRelated (default):
   a. reminders ← lookup.reminderHistory (embedded on LOOKUP)
   b. evidenceSummary ← lookup.evidenceSummary (if set)
   c. Query  pk = TASK#<id>, begins_with(sk, EVID#)
              ScanIndexForward = false
```

### Response (`data`)

```json
{
  "task": { },
  "reminders": [],
  "completionEvidence": [
    {
      "completionEvidenceId": "evid-...",
      "completionSource": "patientApp",
      "completedAt": 1780600000000
    }
  ],
  "evidenceSummary": {
    "generatedAt": 1780600000000,
    "latestCompletionSummary": "BP logged"
  }
}
```

`reminders`, `completionEvidence`, `evidenceSummary` omitted when `includeRelated=false`.

**HTTP:** `200` · `401` · `403` · `404`

---

## 7. GET `/tasks/{runtimeTaskInstanceId}/history`

**Purpose:** Paginated audit timeline (newest first).

### Input

**Headers:** `Authorization: Bearer <JWT>`

**Path:** `runtimeTaskInstanceId` (required)

**Query:**

| Param | Default | Max |
|-------|---------|-----|
| `pageSize` | 50 | 200 |
| `nextToken` | — | opaque cursor |

### Database flow

```
1. GetItem LOOKUP (org scope check — same as GET detail)

2. Query  pk = TASK#<id>, begins_with(sk, HIST#)
          ScanIndexForward = false
          Limit = pageSize
          ExclusiveStartKey = decoded(nextToken)
```

Includes all history event types: `stateChange`, `assignedToStaffChange`, `reminderSettingsChange`, `reminderRegisterRequest`, `reminderCancelRequest`.

### Response (`data`)

```json
{
  "items": [
    {
      "taskStateHistoryId": "uuid",
      "historyEventType": "assignedToStaffChange",
      "transitionAt": 1780550000000,
      "transitionBy": "staff-nurse-44721",
      "transitionSource": "manual",
      "transitionReason": "Shift handoff",
      "previousAssignedToStaffId": "staff-a",
      "newAssignedToStaffId": "staff-b",
      "previousAssignedToStaffDisplayName": "Nurse Lee",
      "newAssignedToStaffDisplayName": "Nurse Patel"
    }
  ],
  "nextToken": "<opaque>"
}
```

**HTTP:** `200` · `401` · `403` · `404`

---

## 8. PUT `/tasks/{runtimeTaskInstanceId}/assigned-staff`

**Purpose:** Initial staff assignment or reassignment for `staff` tasks.

### Input

**Headers:** `Authorization: Bearer <JWT>`

**Path:** `runtimeTaskInstanceId` (required)

**Body:**

| Field | Type | Required |
|-------|------|----------|
| `actorId` | string | yes |
| `assignedToStaffId` | string | yes |
| `assignedToStaffDisplayName` | string | yes |
| `reason` | string | no |

**Resolved server-side:** `organizationId` from JWT only. Staff fields (`assignedToStaffId`, `assignedToStaffDisplayName`) from **request body**.

**Business rules:** `assignedToType` must be `staff`; new staff must differ from current (`422 STAFF_ALREADY_ASSIGNED`). **GSI1** is created on first assignment (`gsi1Pk` + `gsi1Sk`) or updated on reassignment (`gsi1Pk` only).

### Database flow

```
1. GetItem LOOKUP → org check
2. GetItem META via lookup.taskSk

3. TransactWrite:
   a. Update META  Key { pk, sk }
      First assignment:
        SET assignedToStaffId, assignedToStaffDisplayName,
            gsi1Pk = ORG#<org>#STAFF#<staffId>,
            gsi1Sk = DUE#<dueMs13>#PAT#<patient>#TASK#<id>,
            lastUpdatedAt, lastUpdatedBy
      Reassignment:
        SET assignedToStaffId, assignedToStaffDisplayName,
            gsi1Pk = ORG#<org>#STAFF#<staffId>,
            lastUpdatedAt, lastUpdatedBy
        (gsi1Sk unchanged on reassignment)

   b. Update LOOKUP  SET assignedToStaffId, assignedToStaffDisplayName

   c. Put HIST  historyEventType = assignedToStaffChange
                previous/new staff ids + display names
                transitionSource = manual
```

### Response (`data`)

```json
{
  "runtimeTaskInstanceId": "rtask-...",
  "task": { },
  "historyEntry": {
    "taskStateHistoryId": "uuid",
    "historyEventType": "assignedToStaffChange",
    "transitionAt": 1780550000000,
    "transitionBy": "staff-nurse-44721",
    "transitionSource": "manual",
    "newAssignedToStaffId": "staff-nurse-55210",
    "newAssignedToStaffDisplayName": "Nurse Patel"
  }
}
```

**HTTP:** `200` · `401` · `403` · `404` · `422` (`NOT_STAFF_TASK`, `STAFF_ALREADY_ASSIGNED`)

---

## 9. GET `/staff/tasks`

**Purpose:** Staff inbox — tasks assigned to the authenticated staff member (GSI1).  
**Auth:** `staffUserId` query param must match JWT `custom:userID` (403 otherwise).

### Input

**Headers:** `Authorization: Bearer <JWT>`

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `staffUserId` | string | **yes** | Must match authenticated user |
| `patientId` | string | no | FilterExpression on META |
| `carePlanInstanceId` | string | no | FilterExpression on META |
| `currentState` | enum | no | When omitted, terminal states excluded |
| `pageSize` | integer | no | default `50`, max `200` |
| `nextToken` | string | no | Opaque pagination cursor |

### Database query

```
Query  IndexName = StaffPatientTasksIndex
       KeyConditionExpression: gsi1Pk = :gsi1Pk AND begins_with(gsi1Sk, :duePrefix)
       :gsi1Pk = ORG#<orgId>#STAFF#<staffUserId>
       :duePrefix = DUE#
       FilterExpression: entityType = RuntimeTaskInstance
                         [AND patientId = :patientId]
                         [AND carePlanInstanceId = :carePlanInstanceId]
                         [AND currentState = :currentState]
                         [AND terminal exclusion when currentState omitted]
       Limit = pageSize
```

### Response (`data`)

```json
{
  "items": [
    {
      "runtimeTaskInstanceId": "rtask-staff-...",
      "patientId": "pat-101",
      "assignedToStaffId": "staff-nurse-44721",
      "currentState": "open",
      "dueWindowStart": 1780581600000,
      "dueWindowEnd": 1780668000000
    }
  ],
  "nextToken": "<opaque>"
}
```

**HTTP:** `200` · `400` · `401` · `403`

---

## 10. GET `/action-center/items`

**Purpose:** Patient Action Center — server-derived `surfaceSection` for Mobile/Portal. Clients **must not** re-bucket Today vs Upcoming.

### Input

**Query:** `patientId` (required), `surfaceSection` (required: `today` | `upcoming` | `needsAttention` | `history` | `carePlanChecklist` | `all`), `timezone` (IANA, default `UTC`), optional `carePlanInstanceId`, `workflowStage`, `pageSize`, `nextToken`.

### Classification rules (service)

- `completed`, `dismissed`, `cancelled` → `history`
- `missed` → `needsAttention`
- In progress (`open`) + calendar today &lt; StartDate (`dueWindowStart`) → `upcoming`
- In progress + StartDate ≤ today ≤ DueDate (`dueWindowEnd`) → `today`
- In progress + today &gt; DueDate → `needsAttention`
- `carePlanChecklist`: `displayAsChecklistItem === true` and primary section not `history` (also listed under primary section when `surfaceSection=all`)

### Database

Query patient PK `begins_with(DUE#)` or LSI `CarePlanIndex`; filter `displayToPatient = true`, no `assignedToStaffId`.

### Response (`data`)

- `surfaceSection=all` → `{ patientId, timezone, sections: { today, upcoming, needsAttention, history, carePlanChecklist }, nextToken }`
- Single section → `{ patientId, surfaceSection, timezone, items[], nextToken }`
- Each card includes full META projection + `surfaceSection`

**HTTP:** `200` · `401` · `403` · `404`

---

## 11. POST `/tasks/{runtimeTaskInstanceId}/state`

**Purpose:** Manual state transition (`complete`, `dismiss`, `cancel`, `markMissed`) with optimistic concurrency and audit trail.

### Input

**Headers:** `Authorization: Bearer <JWT>`

**Path:** `runtimeTaskInstanceId` (required)

**Body:**

| Field | Type | Required |
|-------|------|----------|
| `action` | `complete` \| `dismiss` \| `cancel` \| `markMissed` | yes |
| `actorId` | string | yes |
| `actorType` | `patient` \| `staff` | yes |
| `expectedCurrentState` | enum (`open`, legacy `active`/`scheduled`, terminal states) | yes |
| `reason` | string | no |
| `evidencePayload` | object | no |

**Resolved server-side:** `organizationId` from JWT only.

**Business rules:** Terminal tasks reject transitions (`422 INVALID_STATE_TRANSITION`). `actorType` must match `assignedToType` when enforced (`422 ACTOR_NOT_ALLOWED`). META conditional `currentState = expected` mismatch → `409 EXPECTED_STATE_MISMATCH`.

### Database flow

```
1. GetItem LOOKUP → org check
2. GetItem META via lookup.taskSk

3. TransactWrite (one request, conditional items by toState):
   a. Update META  SET currentState, lastUpdatedAt, lastUpdatedBy, version++
      Condition: currentState = :expected

   b. Put HIST  historyEventType = stateChange
                fromState, toState, transitionSource = manual
                transitionBy = actorId, transitionReason

   c. [completed] Update LOOKUP  SET evidenceSummary rollup
                   cancel open reminderHistory entries
                   optional Put EVID# when evidencePayload present

   d. [dismissed | cancelled] Update LOOKUP  cancel reminderHistory

   e. [missed] Update LOOKUP  optional evidenceSummary.missedAt
               cancel scheduled reminders

4. After commit (non-blocking): publish CancelReminderJobs when terminal
   transition cancelled scheduled reminders
```

**Unchanged on this API:** registry/template snapshot META fields (`taskBehaviorCode`, `displayTitle`, `assignedToType`, `reminderSettings`, …), `dueWindowStart`/`dueWindowEnd`, staff assignment, META `sk` / `lsi1Sk`, LOOKUP `taskSk`, GSI keys.

### Response (`data`)

```json
{
  "runtimeTaskInstanceId": "rtask-...",
  "currentState": "completed",
  "surfaceSection": "history",
  "historyEntry": {
    "taskStateHistoryId": "uuid",
    "historyEventType": "stateChange",
    "fromState": "open",
    "toState": "completed",
    "transitionAt": 1780550000000,
    "transitionBy": "pat-101",
    "transitionSource": "manual"
  }
}
```

**HTTP:** `200` · `401` · `403` · `404` · `409` (`EXPECTED_STATE_MISMATCH`) · `422` (`INVALID_STATE_TRANSITION`, `ACTOR_NOT_ALLOWED`)

---

## 12. GET `/care-plans/{carePlanInstanceId}/task-status-summary`

**Purpose:** Care-plan stage readiness facts for Care Plan Runtime gating (FR-TASK-RDY-001–003). Computed read — not persisted.

### Input

**Headers:** `Authorization: Bearer <JWT>`

**Path:** `carePlanInstanceId` (required)

**Query:**

| Field | Type | Required |
|-------|------|----------|
| `patientId` | string | yes |
| `workflowStage` | enum | no |

**Resolved server-side:** `organizationId` from JWT only.

### Database flow

```
1. Query CarePlanIndex (LSI1):
   PK = ORG#<org>#PAT#<patient>
   begins_with(lsi1Sk, "CP#<carePlan>#")
   optional FilterExpression: workflowStage = :workflowStage

2. Paginate until exhausted (max 20 rounds × 200 items)

3. In-memory aggregate:
   - counts by currentState (all tasks in scope)
   - requiredTotal / incompleteRequiredTasks from requiredForStageCompletion
   - readinessStatus: notApplicable | ready | notReady
```

**Readiness rules:** `ready` when every required task is `completed`; dismissed/cancelled required tasks count as incomplete (`notReady`).

### Response (`data`)

```json
{
  "orgId": "org-1",
  "patientId": "pat-1",
  "carePlanInstanceId": "cp-1",
  "workflowStage": "onboarding",
  "readinessStatus": "notReady",
  "counts": {
    "total": 3,
    "requiredTotal": 2,
    "completed": 1,
    "missed": 0,
    "active": 1,
    "scheduled": 0
  },
  "incompleteRequiredTasks": [
    {
      "runtimeTaskInstanceId": "rtask-open",
      "displayTitle": "Watch video",
      "requiredForStageCompletion": true,
      "currentState": "open"
    }
  ]
}
```

**HTTP:** `200` · `400` · `401`

---

## 13. PUT `/tasks/{runtimeTaskInstanceId}/reminder-settings`

**Purpose:** Portal-authorized update of `reminderEnabled` and `reminderSettings` on META with HIST audit; coordinates Scheduler via EventBridge when eligibility or channels change (REM-006–010).

### Input

**Headers:** `Authorization: Bearer <JWT>`

**Path:** `runtimeTaskInstanceId` (required)

**Body:**

| Field | Type | Required |
|-------|------|----------|
| `actorId` | string | yes |
| `reminderEnabled` | boolean | yes |
| `reminderSettings` | object | no | e.g. `{ channels: ['push', 'inApp'], quietHoursRespected: true }` |
| `reason` | string | no |

**Resolved server-side:** `organizationId` from JWT only.

**Business rules:** Identical `reminderEnabled` + `reminderSettings` → `422 REMINDER_SETTINGS_UNCHANGED`. `reminderEnabled: true` on terminal task (`completed`, `missed`, `dismissed`, `cancelled`) → `422 REMINDER_NOT_ELIGIBLE`. Disabling reminders on terminal tasks is allowed (cancel path only).

### Database flow

```
1. GetItem LOOKUP → org check
2. GetItem META via lookup.taskSk

3. TransactWrite (one request):
   a. Update META  SET reminderEnabled, reminderSettings, lastUpdatedAt, lastUpdatedBy, version++

   b. Put HIST  historyEventType = reminderSettingsChange
                previous/new reminderEnabled + reminderSettings, actor, reason

   c. [coordination.shouldCancel] Put HIST  historyEventType = reminderCancelRequest

   d. [coordination.shouldRegister] Put HIST  historyEventType = reminderRegisterRequest

4. After commit (non-blocking): publish CancelReminderJobs and/or RegisterReminderJobs
   aligned with coordination (disable → cancel; enable → register; re-register → both)
```

**Unchanged on this API:** LOOKUP keys and `reminderHistory` (scheduler consumer updates operational trail), META `sk` / `lsi1Sk`, GSI keys, task state.

### Response (`data`)

```json
{
  "runtimeTaskInstanceId": "rtask-...",
  "reminderEnabled": true,
  "reminderSettings": {
    "channels": ["push", "inApp"],
    "quietHoursRespected": true
  },
  "historyEntry": {
    "taskStateHistoryId": "uuid",
    "historyEventType": "reminderSettingsChange",
    "previousReminderEnabled": false,
    "newReminderEnabled": true,
    "transitionAt": 1780550000000,
    "transitionBy": "staff-nurse-44721",
    "transitionSource": "manual"
  }
}
```

**HTTP:** `200` · `400` · `401` · `403` · `404` · `422` (`REMINDER_SETTINGS_UNCHANGED`, `REMINDER_NOT_ELIGIBLE`)

---

## 14. PATCH `/tasks/{runtimeTaskInstanceId}`

**Purpose:** Portal-authorized partial metadata edit on META (and LOOKUP when `patientDisplayName` changes). Appends HIST `taskMetadataChange` audit. Does not change due windows, identity keys, staff assignment, reminders, or task state.

### Input

**Headers:** `Authorization: Bearer <JWT>`

**Path:** `runtimeTaskInstanceId` (required)

**Body:**

| Field | Type | Required |
|-------|------|----------|
| `actorId` | string | yes |
| `reason` | string | no |
| `displayTitle` | string | no |
| `description` | string \| null | no |
| `displayToPatient` | boolean | no |
| `requiredForStageCompletion` | boolean | no |
| `displayAsChecklistItem` | boolean | no |
| `workflowStage` | enum | no | `onboarding`, `ongoing`, `review`, `closure` |
| `actionTargetId` | string \| null | no |
| `completionSourceType` | string \| null | no |
| `completionSourceReferenceId` | string \| null | no |
| `patientDisplayName` | string | no |

At least one mutable field (other than `actorId` / `reason`) must be present.

**Forbidden in body** (use dedicated APIs or immutable): `dueWindowStart`, `dueWindowEnd`, `patientId`, `orgId`, `carePlanInstanceId`, source/registry fields, `taskBehaviorCode`, `taskDisplayGroup`, staff assignment fields, reminder fields, `currentState`.

**Resolved server-side:** `organizationId` from JWT only.

**Business rules:** No effective change → `422 TASK_METADATA_UNCHANGED`. `requiredForStageCompletion: true` on `completed`, `dismissed`, or `cancelled` → `422 INVALID_METADATA_FOR_STATE`.

### Database flow

```
1. GetItem LOOKUP → org check
2. GetItem META via lookup.taskSk

3. TransactWrite (one request):
   a. Update META  SET only changed fields + lastUpdatedAt, lastUpdatedBy, version++

   b. [patientDisplayName changed] Update LOOKUP SET patientDisplayName

   c. Put HIST  historyEventType = taskMetadataChange
                changedFields, previousValues, newValues
                transitionBy = actorId, transitionSource = manual
```

**Unchanged on this API:** META `sk`, `lsi1Sk`, `gsi1Pk`, `gsi1Sk`, `dueWindowStart`/`dueWindowEnd`, LOOKUP `taskSk`, `reminderHistory`, `evidenceSummary`, staff assignment, reminder config, `currentState`.

### Response (`data`)

```json
{
  "runtimeTaskInstanceId": "rtask-...",
  "task": { },
  "historyEntry": {
    "taskStateHistoryId": "uuid",
    "historyEventType": "taskMetadataChange",
    "transitionAt": 1780550000000,
    "transitionBy": "staff-nurse-001",
    "transitionSource": "manual",
    "transitionReason": "Care plan template wording updated",
    "changedFields": ["displayTitle", "description", "requiredForStageCompletion"],
    "previousValues": { "displayTitle": "BP check", "requiredForStageCompletion": false },
    "newValues": { "displayTitle": "Complete daily blood pressure check", "requiredForStageCompletion": true }
  }
}
```

**HTTP:** `200` · `400` · `401` · `403` · `404` · `422` (`TASK_METADATA_UNCHANGED`, `INVALID_METADATA_FOR_STATE`)

---

## Quick DynamoDB operation matrix

| API | Get LOOKUP | Get META | Query | TransactWrite |
|-----|:----------:|:--------:|:-----:|:-------------:|
| GET `/health` | | | | |
| POST `/tasks/monitoring-action` | ✓ (resolve) | | | Put×3 |
| POST `/tasks/generate-care-plan` | ✓ per linkage | | | Put×3 per linkage |
| GET `/tasks` | | | ✓ patient / LSI | |
| GET `/staff/tasks` | | | ✓ GSI1 | |
| GET `/action-center/items` | | | ✓ patient / LSI | |
| POST `/tasks` | | | | Put×3 |
| GET `/tasks/{id}` | ✓ | ✓ | ✓ EVID | |
| GET `/tasks/{id}/history` | ✓ | | ✓ HIST | |
| PUT `/tasks/{id}/assigned-staff` | ✓ | ✓ | | Update×2 + Put |
| POST `/tasks/{id}/state` | ✓ | ✓ | | TransactWrite (META+HIST+LOOKUP+optional EVID) |
| GET `/care-plans/{id}/task-status-summary` | | | ✓ LSI1 | |
| PUT `/tasks/{id}/reminder-settings` | ✓ | ✓ | | TransactWrite (META+HIST 1–3) |
| PATCH `/tasks/{id}` | ✓ | ✓ | | TransactWrite (META+HIST; optional LOOKUP) |
