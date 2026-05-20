# Alert service DynamoDB mappings

This file documents the implemented DynamoDB item and query mappings for `alert-service`. It reflects the single-table model used by `libs/alert-core`.

## Table

- Table name: `alert-service-${stage}`
- Primary key: `pk` / `sk`
- Base key prefixes and index names are defined in `libs/alert-core/src/lib/constants/alert.constants.ts`

## Item mappings

| Item | `pk` | `sk` | Purpose |
|------|------|------|---------|
| Alert metadata | `ALERT#<alertId>` | `METADATA` | Canonical alert document |
| Activity | `ALERT#<alertId>` | `ACTIVITY#<epochMsPadded13>#<activityId>` | Alert timeline / audit row |
| Idempotency event | `EVENT#<inputEventId>` | `METADATA` | Create dedupe pointer to an alert |
| Group membership | `GROUP#<groupingKey>` | `Alert#<epochMsPadded13>#<alertId>` | Group-based alert listing |

## GSI mappings

| Index | Partition key | Sort key | Notes |
|------|---------------|----------|------|
| GSI1 | `gsi1pk = ORG#<organizationId>#STATE#<AlertState>` | `gsi1sk = TS#<epochMsPadded13>` | Org team queue |
| GSI2 | `gsi2pk = USER#<assignedToUserId>` | `gsi2sk = TS#<epochMsPadded13>#<alertId>` | "My queue"; present only when assigned |
| GSI3 | `gsi3pk = PAT#<patientId>` | `gsi3sk = TS#<epochMsPadded13>` | Patient timeline |
| GSI4 | `gsi4pk = ORG#<organizationId>` | `gsi4sk = TS#<epochMsPadded13>#<alertId>` | Org-wide time stream |
| GSI5 | `gsi5pk = SLA#<YYYY-MM-DD>` | `gsi5sk = TS#<dueEpochMsPadded13>#<alertId>` | SLA bucket / due-date access |

## Query mappings

| Operation | Table / index | Key condition |
|-----------|---------------|---------------|
| Resolve idempotency | Base table | `pk = EVENT#<inputEventId>`, `sk = METADATA` |
| Get alert by id | Base table | `pk = ALERT#<alertId>`, `sk = METADATA` |
| Alert activities | Base table | `pk = ALERT#<alertId> AND begins_with(sk, 'ACTIVITY#')` |
| Alerts by grouping key | Base table | `pk = GROUP#<groupingKey> AND begins_with(sk, 'Alert#')` |
| Org queue | `GSI1` | `gsi1pk = :pk` |
| My queue | `GSI2` | `gsi2pk = :u` |
| Patient view | `GSI3` | `gsi3pk = :p` |
| Org-wide list | `GSI4` | `gsi4pk = :pk` |

## Filter behavior

- `GSI1` and `GSI4` are the main list indexes for org-scoped listing.
- `GSI2` uses `FilterExpression` for `alertState`, `priority`, `inputType`, `assignedToUserId`, and search matching.
- `GSI3` uses `FilterExpression` for `alertState`, `priority`, `inputType`, `assignedToUserId`, `openOnly`, and `triggerTimestamp` range checks.
- `GSI4` uses `FilterExpression` for `alertState`, `priority`, `inputType`, `assignedToUserId`, `search`, and `unassignedOnly`.

## Write-time behavior

- Create writes:
  - alert metadata row
  - activity row
  - idempotency event row
  - group membership row
- Update workflows may rewrite:
  - `gsi1pk` / `gsi1sk` when state changes
  - `gsi2pk` / `gsi2sk` when assignment changes
  - `gsi5pk` / `gsi5sk` on first assignment when resolve SLA is initialized

## Source of truth

- Key builders: `libs/alert-core/src/lib/builder/alert-key.builder.ts`
- Item builders: `libs/alert-core/src/lib/builder/alert-entity.builder.ts`
- Queries: `libs/alert-core/src/lib/repositories/alert-repository.ts`
- Typed row shape: `libs/alert-core/src/lib/models/persistence/alert-ddb.model.ts`

