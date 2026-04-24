# Alert Service — DynamoDB mapping

This document translates the Confluence export `Alert+Service+Table+DB+design-3.doc` into the **implemented** single-table design: table resources in `apps/alert-service/serverless.yml`, persistence and query logic in [`libs/alert-repository`](../../../../libs/alert-repository) (`alert-service-<stage>`).

## Table

- **Table name**: `alert-service-${stage}` (PITR enabled, on-demand billing).
- **Primary key**: `pk` (HASH), `sk` (RANGE).

## Item types

| pk | sk | Purpose |
|----|----|---------|
| `ALERT#<alertId>` | `META` | Canonical alert document (includes all GSI key material). |
| `EVENT#<inputEventId>` | `ALERT` | Idempotency pointer → `alertId`. |

## Attributes (alert row)

Aligned with the design doc (lifecycle, assignment, queues, SLA):

- **Identifiers**: `alertId`, `patientId`, `organizationId`, `inputEventId`
- **Classification**: `inputType`, `alertPolicyTemplateVersionId`, `groupingKey`
- **State**: `alertState` (`OPEN` \| `ACK` \| `IN_PROGRESS` \| `CLOSED` \| `ESCALATED`)
- **Work management**: `priority`, `assignedToUserId`, `triggerTimestamp`
- **SLA**: `slaBreachIndicator` (boolean)
- **GSI keys**: `gsi1pk` / `gsi1sk`, `gsi2pk` / `gsi2sk`, optional `gsi3pk` / `gsi3sk` when assigned

## Global secondary indexes

| Index | Access pattern (from doc) | Keys |
|-------|---------------------------|------|
| **GSI1** | Patient-centric: all alerts for patient, latest, history (`PK = PATIENT#id`, `SK` sortable) | `gsi1pk` = `PATIENT#<patientId>`, `gsi1sk` = `<triggerTimestamp>#<alertId>` |
| **GSI2** | Team / org queue: open by org, priority, input type filters, unassigned filter (app-side), sort by trigger time, breached (`SLABreachIndicator`) | `gsi2pk` = `ORG#<organizationId>`, `gsi2sk` = `<alertState>#<priorityPad>#<triggerTimestamp>#<alertId>` |
| **GSI3** | My queue: assigned user, open/priority/overdue | `gsi3pk` = `USER#<userId>`, `gsi3sk` = `<alertState>#<triggerTimestamp>#<alertId>` (present only when assigned) |

`priorityPad` is a descending-friendly zero-padded value derived from `priority` so higher priority sorts first within a state.

## API ↔ storage

| HTTP | DynamoDB use |
|------|----------------|
| `POST /alerts` | `TransactWrite`: `ALERT#` + `EVENT#` (condition on `EVENT#` for idempotency). |
| `GET /alerts/{id}` | `GetItem` on `ALERT#` / `META`. |
| `GET /patients/{id}/alerts` | `Query` **GSI1**; optional `openOnly` / `inputType` (filter after query for MVP). |
| `GET /organizations/{id}/alerts` | `Query` **GSI2** `begins_with` on `gsi2sk` with `state` (default `OPEN`); `unassignedOnly` filtered in app. |
| `GET /users/{id}/alerts` | `Query` **GSI3** (assigned alerts only). |
| `PATCH /alerts/{id}` | `UpdateItem` on `ALERT#` / `META`; updates `gsi2sk`; sets or **removes** `gsi3*` on assign/unassign. |
