---
name: dynamodb-query
description: Generates DynamoDB repository queries and commands for api-hub using BaseRepository, @aws-sdk/lib-dynamodb, key builders, and GSI patterns. Use when implementing get/query/batch, pagination, filters, repository methods, or translating access patterns to KeyConditionExpression.
---

# DynamoDB Query — api-hub

## When to apply

- Implementing or extending repository methods
- Translating an access pattern into `Query` / `GetItem` / `BatchGetItem`
- Adding pagination, filters, or sort order to list endpoints

## Stack (use these, do not reinvent)

| Piece | Location |
|-------|----------|
| `BaseRepository` | `libs/utils/src/repository/base-repository.ts` |
| `sendDoc` / `ddbDocClient` | `libs/utils/src/configs/` |
| Query helpers | `libs/utils/src/repository/query.builder.ts` — `buildPkQuery`, `buildPrefixQuery` |
| Reference repo | `libs/alert-core/src/lib/repositories/alert-repository.ts` |

**New repositories**: extend `BaseRepository`, resolve table from `process.env.*_TABLE`, use a domain `*KeyBuilder`.

## Generation workflow

1. Read the service DB doc (`docs/services/*/requirements/*DATABASE*.md`).
2. Identify index: base table vs `GSI1`…`GSI5`.
3. Build keys via `*KeyBuilder` — never inline string concat in the repository.
4. Choose `query` vs `queryPage` vs `queryAll` vs `queryOne` from `BaseRepository`.
5. Put `FilterExpression` only for non-key attributes; document if scan-like cost is acceptable.

## Patterns

### GetItem

```typescript
return this.get<AlertDdbRecord>(table, {
  pk: AlertKeyBuilder.toAlertPk(alertId),
  sk: ALERT_METADATA_SK,
});
```

### Query — base table prefix

```typescript
await this.query<AlertActivity>(table, {
  KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
  ExpressionAttributeValues: {
    ':pk': AlertKeyBuilder.toAlertPk(alertId),
    ':prefix': 'ACTIVITY#',
  },
  ScanIndexForward: false,
});
```

### Query — GSI

```typescript
const GSI1_ORG_QUEUE = 'GSI1';

await this.queryPage<AlertDdbRecord>(table, {
  IndexName: GSI1_ORG_QUEUE,
  KeyConditionExpression: 'gsi1pk = :pk',
  ExpressionAttributeValues: {
    ':pk': AlertKeyBuilder.buildGsi1Pk(organizationId, state),
  },
  ScanIndexForward: false,
  Limit: params.limit,
  ExclusiveStartKey: params.exclusiveStartKey,
});
```

### Optional filters

```typescript
FilterExpression: '#state = :state AND #priority = :priority',
ExpressionAttributeNames: { '#state': 'alertState', '#priority': 'priority' },
ExpressionAttributeValues: { ':state': state, ':priority': priority },
```

Prefer composite gsi sk segments over filters when the pattern is hot (see alert `priorityPad` in DB docs).

### Pagination

- Use `queryPage` → return `{ items, lastEvaluatedKey }`.
- Encode cursors in the service layer (see `encodeListAlertsCursor` in alert-core).
- Default `ScanIndexForward: false` for newest-first lists unless product requires ascending.

### BatchGet

Use `batchGet` from `BaseRepository` for bounded multi-key reads; chunk at 100 keys per AWS limit.

## Condition expressions

| Use case | Expression |
|----------|------------|
| Create idempotency | `attribute_not_exists(pk)` on event pointer item |
| Optimistic lock | `attribute_exists(pk) AND version = :v` |
| Update guard | `attribute_exists(pk)` |

Map `ConditionalCheckFailedException` via repository / `ConditionalWriteConflictError` — do not swallow.

## TransactWrite (multi-item writes)

See **dynamodb-transact** skill for full patterns. In repositories:

```typescript
await this.transactWrite({
  TransactItems: [
    {
      Put: {
        TableName: table,
        Item: eventItem,
        ConditionExpression: 'attribute_not_exists(pk)',
      },
    },
    { Put: { TableName: table, Item: alertItem } },
    { Put: { TableName: table, Item: activityItem } },
  ],
});
```

On `TransactionCanceledException`, resolve idempotency in the **service** layer (see `AlertService.createAlert`), not in the handler.

## Logging

`BaseRepository` logs `dynamodb_get`, `dynamodb_query`, etc. Do not log full items or PII. Pass `organizationId` / `alertId` as structured fields only.

## Output checklist

Generated repository method should include:

- [ ] Table env var constant
- [ ] Typed return (`Promise<T | null>` / `Promise<QueryPage<T>>`)
- [ ] Keys from KeyBuilder
- [ ] Correct `IndexName` when not base table
- [ ] `ScanIndexForward` documented in comment if non-obvious
- [ ] No business logic (orchestration stays in service)

## Anti-patterns

- Raw `ddbDocClient.send` in new code (legacy only)
- `Scan` on production tables
- `begins_with` on high-cardinality pk without sort key bound
- Cross-table queries in one method
- N+1 GetItem loops when `BatchGetItem` fits
