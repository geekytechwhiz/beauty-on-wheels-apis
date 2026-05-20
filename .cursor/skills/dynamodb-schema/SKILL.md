---
name: dynamodb-schema
description: Designs and generates DynamoDB single-table schemas, TypeScript record models, key builders, and GSI access patterns for api-hub. Use when creating tables, pk/sk design, gsi1–gsi5 attributes, entity types, migrations, or documenting storage in docs/services.
---

# DynamoDB Schema — api-hub

## When to apply

- New table or entity type in a service
- Adding or changing GSIs / access patterns
- Generating `*DdbRecord` types and `*KeyBuilder` classes
- Writing or updating `docs/services/*/requirements/*DATABASE*.md`

## Standards

Follow [.cursor/rules.md](../../rules.md): DB access only in repositories; no business logic in key builders.

**Canonical references:**

| Area | Reference |
|------|-----------|
| Alert (rigorous) | `libs/alert-core/src/lib/models/persistence/alert-ddb.model.ts`, `libs/alert-core/src/lib/builder/alert-key.builder.ts` |
| Metadata | `libs/metadata/src/builders/metadata-key.builder.ts` |
| Shared keys | `libs/utils/src/repository/key-builder.ts` |
| Alert DB doc | `docs/services/alert-service/requirements/ALERT_SERVICE_DATABASE.md` |
| Org DB doc | `docs/services/organization-service/requirements/ORGANIZATION_SERVICE_DATABASE_SCHEMA.md` |

## Single-table rules

1. **Primary key**: lowercase `pk` (HASH) + `sk` (RANGE). Exception: metadata registry may use `PK`/`SK` — check `libs/metadata/src/dynamodb/dynamodb.client.ts`.
2. **Entity prefixes**: `ORG#`, `USER#`, `ALERT#`, `PAT#`, `EVENT#`, `GROUP#`, `METADATA_TYPE#`, etc. Never bare UUIDs in pk/sk.
3. **Sort keys**: typed suffixes — `META`, `ACTIVITY#<paddedTs>#<id>`, `TS#<13-digit-padded-ms>`, `begins_with` friendly prefixes.
4. **Time ordering**: use zero-padded epoch ms in SK segments (`padEpochMs13`) so string sort = time sort.
5. **`entityType`**: required string on items for filtering; not part of pk/sk.
6. **GSI names**: literal `GSI1`, `GSI2`, … Attributes: `gsi1pk`/`gsi1sk` (lowercase). **Semantics differ per table** — document each index in the service DB doc.
7. **Projection**: prefer `ProjectionType: ALL` when list APIs filter on non-key attributes (see alert DB doc).

## Schema design workflow

```
Task Progress:
- [ ] List access patterns (read/write, cardinality, filters)
- [ ] Map each pattern → base table or GSI (pk/sk condition)
- [ ] Define item types (pk/sk pairs) on one table
- [ ] Add gsiNpk/gsiNsk only where Query needs them
- [ ] Document in docs/services/<service>/requirements/
- [ ] Add TypeScript model + KeyBuilder + constants
```

For each access pattern, specify:

- Operation: `GetItem` | `Query` (index name) | `TransactWrite`
- Partition key value shape
- Sort key condition (`=`, `begins_with`, between)
- FilterExpression (prefer keys over filters when hot path)
- Sort direction (`ScanIndexForward`)

## Generate: TypeScript record model

Place under `libs/<domain>/src/lib/models/persistence/` or `apps/<service>/src/models/`.

```typescript
export interface ExampleDdbRecord {
  pk: string;
  sk: string;
  entityType: 'EXAMPLE';

  // GSI material (omit optional GSIs when unset)
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk?: string;
  gsi2sk?: string;

  // domain fields...
  organizationId: string;
  createdAt: number;
  updatedAt: number;
}
```

## Generate: KeyBuilder

- Static methods only; no I/O.
- Normalize ids (`trim`, add prefix if missing) — see `AlertKeyBuilder.toOrgPartitionKey`.
- Co-locate GSI key builders with base keys in `*KeyBuilder` or `*.keys.ts`.
- Export SK constants (e.g. `ALERT_METADATA_SK = 'META'`) next to builder or in `*.constants.ts`.

## Generate: DB documentation

Use this template in `docs/services/<service>/requirements/<SERVICE>_DATABASE.md`:

```markdown
# <Service> — DynamoDB

## Table
- Name: `<table>-${stage}` (env: `TABLE_ENV_VAR`)
- Keys: pk (HASH), sk (RANGE)

## Item types
| pk | sk | entityType | Purpose |

## GSIs
| Index | Access pattern | gsiNpk | gsiNsk | Notes |

## API ↔ storage
| API / use case | Operation | Keys / index |
```

## Table provisioning

Most tables are **defined outside** this repo; serverless references env ARNs only. Exception: `services/partner-integration/serverless.yml` (`IdempotencyTable`). Do not add CloudFormation tables unless the user requests infra in-repo.

## Anti-patterns

- Multiple entity types sharing ambiguous pk without prefix
- FilterExpression on hot paths when a GSI could carry the dimension
- Renaming `GSI1` per service (use overloaded semantics + docs, not new index names)
- Storing business rules in key builder
- Uppercase `PK`/`SK` unless the target table requires it

## Output

When generating schema work, deliver:

1. Access-pattern table
2. Item-type table (pk/sk)
3. GSI definitions
4. File paths for model + KeyBuilder to add or edit
5. Short note on idempotency / transact items if writes are multi-item
