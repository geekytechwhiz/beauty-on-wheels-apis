# Template config APIs — S3 storage (greenfield)

Store template UI configuration JSON in S3. **No migration** from `services-json/` — the bucket starts empty and configs are created only via the APIs below.

---

## Scope

| Method | Route | Lambda | Behavior |
|--------|-------|--------|----------|
| **POST** | `/template-configs` | `createTemplateConfig` | Save the **entire request body** as one JSON object in S3 |
| **GET** | `/template-configs` | `listTemplateConfigs` | Return **all** configs when `configId` is not provided |
| **GET** | `/template-configs/{configId}` | `getTemplateConfig` | Return **one** config by `configId` |
| **PUT** | `/template-configs/{configId}` | `updateTemplateConfig` | **Replace** the whole JSON object with the new request body |

**Out of scope:** `/template-configs/meta` (metadata dropdowns — separate metadata-registry flow).

**Not doing:**

- No upload/sync from `services-json/`
- No filesystem or `/tmp` storage
- No registry files (`ui-meta-registry.json`, etc.)
- No partial/section merge on PUT — always full document replace

---

## Core rules

1. **One config = one S3 object.** The object body is exactly the JSON payload (create body or update body).
2. **`configId` is the object key.** Taken from `id` in the JSON body on create; path `{configId}` on get/update must match `body.id`.
3. **Create** writes a new object. Returns **409** if that `configId` already exists.
4. **Update** overwrites the object with the full new JSON. Returns **404** if `configId` does not exist.
5. **Get one** reads that object. Returns **404** if missing.
6. **Get all** lists every `.json` under the prefix and returns each parsed document.

---

## S3 layout

### Bucket and prefix

| Setting | Example |
|---------|---------|
| Bucket | `{stage}-mvx-template-ui-config` |
| Prefix | `template-configs` |

### Object key

Flat layout — one file per config:

```
{prefix}/{configId}.json
```

Examples:

```
template-configs/CARE-PLAN-MASTER-001.json
template-configs/MONITORING-MASTER-001.json
template-configs/ENABLE_SCOPE.json
```

- `Content-Type`: `application/json`
- Body: full API payload (pretty-printed or compact — either is fine; read path parses JSON)

### Environment variables

Add to `infra/environments/environment.yml`:

```yaml
TEMPLATE_CONFIG_S3_BUCKET: ${self:custom.bundle.templateConfigBucketName}
TEMPLATE_CONFIG_S3_PREFIX: template-configs
```

---

## API behavior

### POST `/template-configs` — create

**Request:** any valid JSON object. Must include string `id` (this becomes `configId` / S3 key).

```json
{
  "configType": "TEMPLATE",
  "templateType": "CARE_PLAN",
  "id": "CARE-PLAN-MASTER-001",
  "titleKey": "carePlan.title",
  "subtitleKey": "carePlan.subtitle",
  "fields": { }
}
```

**Steps:**

1. Validate body is a JSON object with required `id` (trimmed, non-empty).
2. `configId = body.id`
3. `HeadObject` on `template-configs/{configId}.json` → **409 CONFLICT** if exists.
4. `PutObject` — store **whole body** as-is (no field stripping or merging).
5. Return created record:

```json
{
  "configId": "CARE-PLAN-MASTER-001",
  "document": { /* same as request body */ }
}
```

---

### GET `/template-configs` — get all

**No `configId` in path.**

**Steps:**

1. `ListObjectsV2` with prefix `template-configs/` and suffix filter `.json`.
2. For each key, `GetObject` and parse JSON (or use selective parallel gets).
3. Return:

```json
{
  "items": [
    {
      "configId": "CARE-PLAN-MASTER-001",
      "document": { }
    },
    {
      "configId": "MONITORING-MASTER-001",
      "document": { }
    }
  ]
}
```

**Optional query filters** (can add later, not required for v1):

- `configType=TEMPLATE|ORG`
- `templateType=CARE_PLAN`

Filter in memory after load, or encode type in key prefix if volume grows.

---

### GET `/template-configs/{configId}` — get one

**Steps:**

1. `GetObject` on `template-configs/{configId}.json`.
2. **404** if `NoSuchKey`.
3. Parse JSON and return:

```json
{
  "configId": "CARE-PLAN-MASTER-001",
  "document": { /* stored JSON */ }
}
```

---

### PUT `/template-configs/{configId}` — full replace

**Request:** full new JSON document. `body.id` must equal path `{configId}`.

```json
{
  "id": "CARE-PLAN-MASTER-001",
  "titleKey": "carePlan.title.updated",
  "fields": { }
}
```

**Steps:**

1. `HeadObject` on `template-configs/{configId}.json` → **404** if missing.
2. Validate `body.id === configId` (after trim).
3. `PutObject` — replace object with **entire new body** (no merge with old fields).
4. Return:

```json
{
  "configId": "CARE-PLAN-MASTER-001",
  "document": { /* new body */ }
}
```

**After PUT, GET returns the new JSON** — same object that was written.

---

## Request flow

```
POST /template-configs
  → validate id
  → HeadObject (409 if exists)
  → PutObject whole body
  → 201 + { configId, document }

PUT /template-configs/{configId}
  → HeadObject (404 if missing)
  → validate body.id === configId
  → PutObject whole body (replace)
  → 200 + { configId, document }

GET /template-configs/{configId}
  → GetObject
  → 200 + { configId, document } | 404

GET /template-configs
  → ListObjectsV2 + GetObject each
  → 200 + { items: [...] }
```

---

## Implementation plan

### Phase 1 — Infrastructure

1. **S3 bucket** per stage in `infra/resources/` (or name in `infra-custom.yml`).
   - Block public access.
   - SSE enabled.

2. **IAM** — `infra/permissions/s3.yml`:

   ```yaml
   Effect: Allow
   Action:
     - s3:GetObject
     - s3:PutObject
     - s3:HeadObject
     - s3:ListBucket
   Resource:
     - arn:aws:s3:::${bucket}
     - arn:aws:s3:::${bucket}/${prefix}/*
   ```

3. **Env vars** on template-config Lambdas: `TEMPLATE_CONFIG_S3_BUCKET`, `TEMPLATE_CONFIG_S3_PREFIX`.

### Phase 2 — S3 store (`libs/template-core`)

New focused module — no reuse of `TemplateUiMetaService` / `OrgConfigMetaService` filesystem code:

```
libs/template-core/src/lib/storage/
├── template-config-s3.store.ts
└── template-config-s3.store.spec.ts
```

| Method | S3 operation |
|--------|----------------|
| `create(configId, document)` | HeadObject → PutObject |
| `getById(configId)` | GetObject |
| `listAll()` | ListObjectsV2 + GetObject (batch) |
| `replace(configId, document)` | HeadObject → PutObject |

Helper: `buildKey(configId)` → `{prefix}/{configId}.json`

### Phase 3 — Service layer

Replace or simplify `TemplateConfigService`:

```typescript
// libs/template-core/src/lib/services/template-config.service.ts
createConfig(body)   → store.create(body.id, body)
getConfigById(id)  → store.getById(id)
listConfigs()      → store.listAll()
updateConfig(id, body) → store.replace(id, body)  // full replace only
```

Remove dependency on:

- `services-json/` directory
- `prepareServicesJsonDir`, `seedServicesJsonFromBundle`
- `ui-meta-registry.json` / org registry files
- Partial ORG section merge logic

### Phase 4 — HTTP layer

| File | Change |
|------|--------|
| `template-config-http.controller.ts` | Wire to simplified service; list returns all from S3 |
| `createTemplateConfig.ts` | No change to route |
| `getTemplateConfig.ts` | No change to route |
| `listTemplateConfigs.ts` | List all from S3 (drop filesystem scan) |
| `updateTemplateConfig.ts` | Full replace only |
| `template.schemas.ts` | Require `id` on create; PUT body must include matching `id` |

Response shape can drop `fileName`, `configType` wrapper fields if not in stored JSON — or keep thin mapper that always returns `{ configId, document }`.

### Phase 5 — Remove old static file path

After S3 flow works in dev:

1. Stop bundling `services-json/**` in `serverless.yml` `package.patterns`.
2. Remove or deprecate `TemplateUiMetaService`, `OrgConfigMetaService` if nothing else uses them.
3. Remove `TEMPLATE_UI_META_DIR` from `environment.yml`.
4. Update OpenAPI / `TEMPLATE_API.md` to describe S3-backed configs.

**No seed script. No data migration.**

---

## Local development

| Approach | Notes |
|----------|-------|
| **Dev bucket** | Point `TEMPLATE_CONFIG_S3_BUCKET` at shared dev bucket; create configs via POST |
| **Unit tests** | Mock `@aws-sdk/client-s3` in store tests |
| **serverless-offline** | Needs AWS credentials + dev bucket (no local filesystem fallback) |

---

## Testing

| Test | Assert |
|------|--------|
| POST create | Object exists in S3; response `document` matches body |
| POST duplicate `id` | 409 |
| GET by `configId` | Returns stored JSON |
| GET unknown `configId` | 404 |
| GET all | Returns every object under prefix |
| PUT replace | S3 object equals new body; GET returns new body |
| PUT unknown `configId` | 404 |
| PUT `body.id` ≠ path | 400 |
| Cold start | GET after PUT still returns latest (durable in S3) |

**Smoke sequence:**

```
POST /template-configs          → 201
GET  /template-configs/{id}     → 200 (same body)
PUT  /template-configs/{id}     → 200 (changed fields)
GET  /template-configs/{id}     → 200 (updated body)
GET  /template-configs          → 200 (items includes {id})
```

---

## Error mapping

| Condition | HTTP | Code |
|-----------|------|------|
| Create when `configId` already exists | 409 | `CONFLICT` |
| Get/put unknown `configId` | 404 | `NOT_FOUND` |
| Missing or invalid `id` | 400 | `VALIDATION_ERROR` |
| PUT `body.id` ≠ path `configId` | 400 | `VALIDATION_ERROR` |
| S3 failure | 500 | `INTERNAL_ERROR` |

---

## Rollout checklist

- [ ] S3 bucket + IAM deployed
- [ ] `TemplateConfigS3Store` implemented
- [ ] `TemplateConfigService` simplified (create / get one / get all / full replace)
- [ ] Handlers wired; validation requires `id`
- [ ] Dev smoke: POST → GET one → PUT → GET one → GET all
- [ ] Remove `services-json` from Lambda package and old fs services
- [ ] OpenAPI updated

---

## Decision log

| Decision | Choice |
|----------|--------|
| Starting data | Empty bucket — **no migration** |
| Storage | S3 only |
| Key | `{prefix}/{configId}.json` |
| Create | Store whole POST body |
| Update | Full PUT replace — no partial merge |
| Get all | `GET /template-configs` — ListObjects + read each file |
| Get one | `GET /template-configs/{configId}` |
| Registry files | **Not used** |

---

## Reference — code to replace

| Current (filesystem) | Action |
|----------------------|--------|
| `TemplateUiMetaService` | Replace with S3 store for template-config APIs |
| `OrgConfigMetaService` | Replace with same S3 store (one key per `id`) |
| `template-ui-meta.utils.ts` (fs seed/tmp) | Remove from template-config path |
| `meta-registry.utils.ts` | Remove from template-config path |
| `apps/template-service/services-json/` | Not used as source of truth |

| Keep / add | Location |
|------------|----------|
| HTTP controller | `template-config-http.controller.ts` |
| S3 store | `libs/template-core/.../template-config-s3.store.ts` |
| Thin service | `template-config.service.ts` |
