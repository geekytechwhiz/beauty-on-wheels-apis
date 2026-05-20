---
name: dynamodb-transact
description: Designs and generates DynamoDB TransactWrite patterns, conditional writes, and idempotency keys for api-hub. Use when implementing create flows, multi-item atomic writes, race handling, duplicate events, or idempotency tables.
---

# DynamoDB Transact & Idempotency — api-hub

## When to apply

- Multi-item creates/updates that must be atomic
- Idempotent ingest (HTTP or EventBridge)
- Conditional versioned writes (config, metadata)
- Separate idempotency store tables

## References

| Pattern | Location |
|---------|----------|
| Alert create transact | `libs/alert-core/src/lib/repositories/alert-repository.ts` (`createAlert`) |
| Idempotency resolution | `libs/alert-core/src/lib/service/alert.service.ts` (`createAlert`) |
| Org config versioning | `apps/organization-service/src/repositories/organization.repository.ts` |
| Metadata transact | `libs/metadata/src/repositories/dynamodb/metadata.repository.impl.ts` |
| Simple idempotency table | `services/partner-integration/serverless.yml` (`IdempotencyTable`) |
| Event platform idempotency | `@api-hub/event-platform` consumer orchestration |

## Idempotency — single-table pointer (preferred for domain creates)

**Pattern** (alert service):

| Item | pk | sk | Role |
|------|----|----|------|
| Event pointer | `EVENT#<inputEventId>` | `ALERT` | Maps external id → `alertId`; `attribute_not_exists(pk)` on create |
| Alert | `ALERT#<alertId>` | `META` | Canonical record |

**Flow:**

1. Service calls `resolveInputEventId(inputEventId, organizationId)` before transact.
2. If exists same org → return `{ duplicate: true }`, skip publish.
3. If exists different org → throw `IDEMPOTENCY_KEY_IN_USE` (non-retryable for events).
4. Transact: conditional Put pointer + Put alert (+ activity/group as needed).
5. On `TransactionCanceledException` / `DuplicateEventError` → re-resolve pointer (race).

Generate service code; keep transact items in repository.

## TransactWrite generation template

```typescript
await this.transactWrite({
  TransactItems: [
    {
      Put: {
        TableName: table,
        Item: idempotencyItem,
        ConditionExpression: 'attribute_not_exists(pk)',
      },
    },
    {
      Put: {
        TableName: table,
        Item: primaryItem,
      },
    },
    // Updates: use Update with ConditionExpression
  ],
});
```

**Limits**: max 25 items, 4 MB, all items same region/account. Split sagas if larger (SQS + compensating actions).

## Conditional updates (versioned config)

Pattern: Put new version + Update previous `ACTIVE` → `INACTIVE` in one transact.

- New item: `ConditionExpression: 'attribute_not_exists(pk)'` or version check
- Deactivate old: `ConditionExpression: 'attribute_exists(pk) AND #status = :active'`

See organization repository for org config entities.

## Standalone idempotency tables

Use when event-platform or partner flows need a minimal store:

- Partition key: `idempotencyKey` (string)
- TTL attribute for expiry
- Example: `services/partner-integration/serverless.yml`

Do not duplicate domain logic tables unless cross-service dedup is required.

## Error handling

| Error | Action |
|-------|--------|
| `ConditionalCheckFailedException` | Map to domain conflict; service decides duplicate vs 409 |
| `TransactionCanceledException` | Inspect cancellation reasons; retry resolve for races |
| `IDEMPOTENCY_KEY_IN_USE` | `BaseError` or plain Error with `retryable: false` for consumers |

Event consumers: non-retryable failures must use `BaseError` with `retryable: false` or `NonRetryableError` — plain `Error` defaults to retry in event-platform.

## Generation output

When asked to generate transact logic, provide:

1. Item list (pk/sk, entityType, conditions)
2. Pre-transact read (`resolve*` / GetItem) if any
3. Service-layer duplicate vs error mapping
4. Race/retry handling after cancel
5. Whether outbound events publish only when `!duplicate`

## Anti-patterns

- Idempotency only in application memory
- Transact across multiple tables (not supported)
- Missing condition on idempotency pointer (double-create risk)
- Publishing events before transact commits
- Retry forever on `IDEMPOTENCY_KEY_IN_USE` from EventBridge
