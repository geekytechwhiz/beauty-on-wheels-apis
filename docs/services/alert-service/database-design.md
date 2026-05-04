# Alert service — DynamoDB design

This document describes the **single-table** DynamoDB model as implemented in [`libs/alert-core`](../../../libs/alert-core) (`AlertRepository`, `AlertEntityBuilder`, `AlertKeyBuilder`). Table provisioning may live outside this repo; treat this as the **application contract** for keys and indexes the code expects.

**Implementation note:** Persistence code may still use legacy string timestamps in places; this document standardizes the **intended** time representation as **epoch** below. Align code and migrations to match.

## Time in keys and attributes

All **instants** (when an event occurred, SLA due, sort order for “newest first”, etc.) use **Unix time**:

| Rule | Detail |
|------|--------|
| **Unit** | **Milliseconds since Unix epoch** (`1970-01-01T00:00:00.000Z`), **UTC**. |
| **Item attributes** | Store as DynamoDB **Number** (e.g. `triggerTimestampMs`, `createdAtMs`, `resolveSlaDueAtMs`) or a single agreed field name per concept — **do not** store clock strings in attributes for keys that must sort. |
| **Inside string sort keys** (`TS#…`) | Append a **fixed-width decimal string** of epoch ms (recommended **13 digits**, zero-padded), e.g. `TS#0001736938200000`, so **lexical string order = chronological order** when Dynamo compares `sk` / GSI keys as strings. |
| **Validation** | Reject NaN, negatives where inappropriate, and non-integers; normalize to integer ms before write. |

**Placeholders in this doc:** `<epochMs>` means **integer** epoch milliseconds for attributes; in **string keys** after `TS#`, the same instant appears as the **padded string** of that integer (unless the row stores the key as a **Number** type — then use numeric SK and omit padding rules).

**Date buckets:** `SLA#<YYYY-MM-DD>` (`gsi5pk`) is the **UTC calendar date** derived from `<epochMs>` (format UTC `YYYY-MM-DD` from that instant), not a second clock format.

## Table

| Setting | Value |
|--------|--------|
| **Logical name** | `alert-service-${stage}` (see `apps/alert-service/serverless.yml` → `custom.alertDynamoTableName`) |
| **Environment variable** | `ALERT_TABLE` |
| **Primary key** | `pk` (HASH), `sk` (RANGE) |
| **LSIs** | None are used or referenced in `alert-core`. |

## Base table item types

All item types share the same table and use `pk` / `sk`.

| Purpose | `pk` | `sk` | Notes |
|--------|------|------|--------|
| **Alert metadata** (canonical document) | `ALERT#<alertId>` | `METADATA` | Holds domain fields and GSI key material (`gsi1pk` … `gsi5sk`). |
| **Activity** (timeline / audit) | `ALERT#<alertId>` | `ACTIVITY#<epochMsPadded13>#<activityId>` | `<epochMsPadded13>` = activity time as **padded epoch ms** per **Time** section; query with `begins_with(sk, 'ACTIVITY#')`. |
| **Idempotency event** | `EVENT#<inputEventId>` | `METADATA` | Create path uses conditional write; maps to `organizationId` + `alertId`. |
| **Group membership** | `GROUP#<groupingKey>` | `Alert#<epochMsPadded13>#<alertId>` | Time segment = alert’s trigger instant as **padded epoch ms**; prefix `Alert#` = `GROUP_MEMBERSHIP_SK_PREFIX`. |

## Global secondary indexes (GSIs)

Index **names** in code: `GSI1`, `GSI2`, `GSI3`, `GSI5` (`libs/alert-core/src/lib/constants/alert.constants.ts`).

### GSI1 — organization team queue (by state)

Used for org-scoped lists (e.g. unassigned vs assigned lanes, `queryOrgAlerts` / `queryOrgAlertsPage`).

| Role | Attribute | Format |
|------|-----------|--------|
| Partition | `gsi1pk` | `ORG#<organizationId>#STATE#<AlertState>` — org id is normalized with an `ORG#` prefix when missing. |
| Sort | `gsi1sk` | `TS#<epochMsPadded13>` — trigger instant for ordering; newest-first uses `ScanIndexForward: false`. |

### GSI2 — assignee (“my queue”)

Present **only when** `assignedToUserId` is set. Removed on unassign (`REMOVE gsi2pk`, `gsi2sk`).

| Role | Attribute | Format |
|------|-----------|--------|
| Partition | `gsi2pk` | `USER#<assignedToUserId>` |
| Sort | `gsi2sk` | `STATE#<alertState>#TS#<epochMsPadded13>#<alertId>` — time segment = **padded epoch ms** for trigger ordering. |

Queries (`queryUserAlerts` / `queryUserAlertsPage`) use `gsi2pk = :u` and optionally `begins_with(gsi2sk, 'STATE#<state>#')`.

### GSI3 — patient-centric list

Always populated on create for the alert metadata row.

| Role | Attribute | Format |
|------|-----------|--------|
| Partition | `gsi3pk` | `PAT#<patientId>` — normalized with `PAT#` prefix when missing. |
| Sort | `gsi3sk` | `TS#<epochMsPadded13>` — on **create**, typically **write time** (`Date.now()`), not necessarily the same ms as clinical `triggerTimestamp`; document product choice explicitly in code. |

### GSI5 — SLA bucket

Populated on the alert metadata row for SLA-oriented access patterns.

| Role | Attribute | Format |
|------|-----------|--------|
| Partition | `gsi5pk` | `SLA#<YYYY-MM-DD>` — UTC calendar date from `resolveSlaDueAt` **epoch ms** (`toSlaPartitionKey` equivalent on ms). |
| Sort | `gsi5sk` | `TS#<epochMsPadded13>#<alertId>` — due instant as **padded epoch ms** + `alertId`. |

On create, resolve SLA due is typically initialized from the same **epoch ms** as other create defaults until business rules extend SLA computation.

### GSI4 — not implemented (optional future design)

**Today:** `AlertKeyBuilder` defines `toGsi4Sk` for a possible future shape, but **`gsi4pk` / `gsi4sk` are not** on `AlertDdbRecord` and are **not** queried in `alert-core`. Treat **GSI4 as unused** in the current implementation.

**Why GSI1 alone forces a merge for TEAM lists:** `gsi1pk` includes **workflow state** (`ORG#<org>#STATE#<AlertState>`). A single chronological “all open team work” view across states (e.g. UNASSIGNED + ASSIGNED) cannot be one `Query`; the service uses **`listAlertsTeamMerge`** — two GSI1 branches (per state) merged by time / `alertId` with a composite cursor.

**Possible GSI4 pattern (design discussion, not in code):**

| Role | Attribute | Example shape |
|------|-----------|----------------|
| Partition | `gsi4pk` | `ORG#<organizationId>` — **org only**, no `STATE#` segment. |
| Sort | `gsi4sk` | `TS#<epochMsPadded13>#<alertId>` — same **epoch** rules as **Time** section. |

**Potential benefits**

- **One `Query` per page** on org + time sort — simpler pagination than the dual-stream TEAM merge and a single Dynamo `LastEvaluatedKey` style cursor.
- Good for **org-wide “newest first”** dashboards or exports without caring about state partition.

**Tradeoffs**

- **State / assignment filters** — If `alertState` is **not** in `gsi4pk` / `gsi4sk`, DynamoDB cannot cheaply restrict to “only UNASSIGNED”. You read a wider slice and filter in the app, or use **`FilterExpression`** (still bills reads for skipped items — poor at large org volume).
- **Hot partitions** — Everything for one org shares one `gsi4pk`; GSI1 spreads load across **state-specific** partitions.
- **Write cost & correctness** — Every create and every transition that affects listing must maintain **GSI4** in sync with truth on the item (alongside GSI1 / GSI2 / GSI3 / GSI5).

**Verdict:** GSI4 is **beneficial** mainly to **simplify TEAM default listing and cursors** if you accept broader reads or encode extra dimensions into **`gsi4sk`** (which then overlaps conceptually with tuning GSI1). For **state-selective org queues at scale**, the current **GSI1** layout remains the usual Dynamo pattern.

## Hydration pattern

GSI1 / GSI2 / GSI3 queries may return **projections** or partial items. `AlertRepository.hydrateAlertIdsOrdered` / `hydrateAlertsFromGsiRows` **BatchGet**s full rows by `ALERT#<alertId>` + `METADATA` where possible.

## Write patterns (high level)

| Operation | DynamoDB usage |
|-----------|----------------|
| **Create alert** | `TransactWriteItems`: conditional `Put` on `EVENT#…`, `Put` alert metadata, `Put` create activity, `Put` group membership row. |
| **Update alert / workflow** | `UpdateItem` on `ALERT#…` / `METADATA`; may refresh `gsi1pk` / `gsi1sk` on state change; set or remove `gsi2*` on assign/unassign; optional `TransactWrite` with activity `Put`s. |
| **Add note** | `Put` activity row under `ALERT#…`. |
| **Resolve idempotency** | `GetItem` on `EVENT#<inputEventId>` + `METADATA`. |
| **Alerts in group** | `Query` base table `pk = GROUP#<groupingKey>` and `sk` begins with `Alert#`, then BatchGet metadata. |

## Source of truth in code

| Area | Path |
|------|------|
| Constants (SK prefixes, GSI names) | `libs/alert-core/src/lib/constants/alert.constants.ts` |
| Key string builders | `libs/alert-core/src/lib/builder/alert-key.builder.ts` |
| Item shapes on create / update expressions | `libs/alert-core/src/lib/builder/alert-entity.builder.ts` |
| Queries and hydration | `libs/alert-core/src/lib/repositories/alert-repository.ts` |
| Typed metadata row | `libs/alert-core/src/lib/models/persistence/alert-ddb.model.ts` |

## Related doc

Older notes live under [`requirements/ALERT_SERVICE_DATABASE.md`](./requirements/ALERT_SERVICE_DATABASE.md); **prefer this file** when they disagree with `alert-core`.
