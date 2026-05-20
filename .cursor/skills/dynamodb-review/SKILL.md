---
name: dynamodb-review
description: Reviews DynamoDB schemas, repositories, queries, transact writes, and stream handlers in api-hub for correctness, access-pattern fit, cost, and healthcare security. Use when reviewing PRs or diffs touching pk/sk, GSI, BaseRepository, TransactWrite, or stream consumers.
---

# DynamoDB Review — api-hub

## When to apply

Review any change to repositories, key builders, `*DdbRecord` models, DB docs, stream handlers, or serverless table/stream config.

Cross-check with [.cursor/rules.md](../../rules.md) and the service `*DATABASE*.md` doc.

## Review workflow

1. **Access patterns** — Does each new query match a documented pattern? Wrong index or missing GSI?
2. **Keys** — Built via KeyBuilder? Prefixes consistent? Padded timestamps for sort?
3. **Layering** — DB logic only in repository; service orchestrates transact + idempotency.
4. **Cost** — Scan avoided? FilterExpression on hot paths? Pagination on lists?
5. **Correctness** — Conditions, races, duplicate handling, GSI updates on state change.
6. **Security** — No PII in logs; tenant scoping on keys (`organizationId` in gsi pk where required).

## Must-block

- `Scan` on large/production tables
- Direct `ddbDocClient` in **new** code without justification
- Business logic in repository or key builder
- Cross-tenant key leakage (org id not in pk/gsi when data is tenant-scoped)
- Missing `attribute_not_exists` on idempotency pointer creates
- Transact publish before commit
- Logging full stream/item payloads with PHI
- Breaking GSI semantics without migration plan and doc update

## Should-fix

- Inline pk/sk string concat instead of KeyBuilder
- Hot-path `FilterExpression` replaceable by composite sk
- Missing `ScanIndexForward` comment when sort order is product-critical
- `queryAll` without limit on unbounded partitions
- GSI keys not updated when mutable dimensions change (e.g. assign/unassign alert)
- Plain `Error` on non-retryable conflicts in event consumers
- Missing `entityType` on new items

## Optional

- Migrate legacy repo to `BaseRepository`
- BatchGet instead of N+1 GetItem
- DB doc drift from implementation

## Feedback format

```markdown
## Summary
[Risk: low/medium/high — what storage change does]

## Critical
- [Must fix]

## Suggestions
- [Should fix]

## Optional
- [Nice to have]

## Access pattern check
| Pattern | Index | OK? | Notes |
```

## Module-specific

| Module | Focus |
|--------|--------|
| `libs/alert-core` | GSI1–5 updates on workflow; idempotency `EVENT#`; transact item set |
| `libs/metadata` | Versioned types/values; PK/SK casing |
| `apps/user-service` | Legacy vs v2 repository; stream side effects |
| `apps/organization-service` | Org list GSI1; subdomain GSI2 |
| Stream handlers | event-platform wiring; filtered ack; idempotency |

## Related skills

- Schema design issues → mention `dynamodb-schema`
- Query generation gaps → `dynamodb-query`
- Transact/idempotency → `dynamodb-transact`
- Streams → `dynamodb-streams`
