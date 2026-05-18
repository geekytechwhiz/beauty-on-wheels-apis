# Template Service — API Implementation Plan

This document is the step-by-step plan to implement **all HTTP APIs** for `template-service`, following the same architecture as `alert-service`, using:

| Source | Purpose |
|--------|---------|
| `template-service-care-plan.openapi.yaml` | API contract (paths, request/response schemas, status codes) |
| `template_dynamodb_json.json` | Sample DynamoDB document shape (care-plan flat template) |
| `alert-service` | Reference implementation pattern (handlers → controllers → `*-core` lib) |

**Infrastructure (done):**

- DynamoDB: `template-service-dev` (GSI/LSI shell same as `alert-service-dev`)
- S3 deploy bucket: `dev-mvx-template-service-bucket`
- Env: `TEMPLATE_TABLE=template-service-dev`

---

## 1. Target architecture (same as alert-service)

```text
API Gateway
    │
    ▼
src/handlers/http/<operation>.ts     ← thin: withApiHandler + export main
    │
    ▼
src/controllers/*-http.controller.ts ← authz, orchestration, map to DTOs
    │
    ▼
libs/template-core                     ← domain: services, repositories, key builders
    │
    ▼
DynamoDB (template-service-{stage})    ← single table pk/sk + gsi1..gsi5
```

### Request flow (per HTTP call)

1. API Gateway invokes Lambda (`src/handlers/http/*.main`).
2. `withApiHandler` (`@api-hub/middleware`) builds `LambdaRequest`, logger, correlation id.
3. Optional `bodySchema` (Zod) + `validator` resolves **org id / actor** from JWT (like alert).
4. Controller calls `TemplateService` / `OrgTemplateService` in `@api-hub/template-core`.
5. Repository reads/writes DynamoDB; updates `gsi1pk`…`gsi5pk` on write when status/org/type changes.
6. Controller returns DTO; middleware wraps in standard success envelope (`@api-hub/utils`).
7. On publish (optional phase 2): `publishTemplatePublished` → EventBridge `template-service-bus-{stage}`.

### Folder layout to implement

```text
apps/template-service/
├── serverless.yml                    # register every Lambda + authorizer
├── swagger.json                      # Swagger 2 subset for serverless-auto-swagger
├── src/
│   ├── utils/helpers.ts
│   ├── utils/helpers.ts              # getOrganizationIdForRequest, getActorUserIdForRequest
│   ├── validators/
│   │   ├── template.schemas.ts       # Zod from OpenAPI components
│   │   ├── org-template.schemas.ts
│   │   ├── enablement.schemas.ts
│   │   └── request.validators.ts     # JWT + business rules
│   ├── controllers/
│   │   ├── template-http.controller.ts      # master + lifecycle + compatible
│   │   ├── org-template-http.controller.ts  # org list/update/clone/versions
│   │   └── enablement-http.controller.ts
│   └── handlers/http/
│       ├── health.ts
│       ├── createMasterTemplate.ts
│       ├── listMasterTemplates.ts
│       ├── getMasterTemplateMeta.ts
│       ├── getMasterTemplateVersions.ts
│       ├── updateMasterTemplateVersion.ts
│       ├── cloneOrgTemplate.ts
│       ├── getOrgTemplateVersions.ts
│       ├── listOrgTemplates.ts
│       ├── updateOrgTemplateVersion.ts
│       ├── transitionTemplateStatus.ts
│       ├── createOrgEnablement.ts
│       ├── searchOrgEnablements.ts
│       ├── listOrgEnablementsByOrg.ts
│       ├── getOrgEnablementById.ts
│       ├── updateOrgEnablement.ts
│       └── listCompatibleTemplates.ts

libs/template-core/
├── src/
│   ├── index.ts
│   ├── constants/template.constants.ts
│   ├── builder/template-key.builder.ts
│   ├── builder/template-entity.builder.ts
│   ├── models/persistence/template-ddb.model.ts
│   ├── repositories/template.repository.ts
│   ├── repositories/org-template.repository.ts
│   ├── repositories/enablement.repository.ts
│   ├── services/template.service.ts
│   ├── services/org-template.service.ts
│   ├── services/template-publish.service.ts   # lifecycle PUBLISH
│   ├── mappers/template-http.dto.ts
│   └── errors/...
```

---

## 2. DynamoDB model (from OpenAPI + JSON sample)

### 2.1 Table

| Setting | Value |
|---------|--------|
| Name | `template-service-${stage}` |
| Partition key | `pk` (String) |
| Sort key | `sk` (String) |
| GSIs | GSI1–GSI5 on `gsi1pk`/`gsi1sk` … `gsi5pk`/`gsi5sk` (same attribute names as alert) |
| LSIs | `pk` + `sk1` … `sk4` (optional; provisioned like alert) |

Use **lowercase** `pk`/`sk` in code (alert convention). Map from sample JSON fields (`PK`/`SK` in docs → `pk`/`sk` in items).

### 2.2 Base-table item types

| entityType | pk | sk | Notes |
|------------|----|----|-------|
| `MASTER_TEMPLATE` | `MASTER_TMPL#<templateId>` | `VERSION#<versionId>` | Full document (see `template_dynamodb_json.json`) |
| `MASTER_TEMPLATE` | `MASTER_TMPL#<templateId>` | `META` | Header / latest pointers |
| `ORG_TEMPLATE` | `ORG_TMPL#<orgId>#<templateId>` | `VERSION#<versionId>` | Org copy / derived |
| `ORG_TEMPLATE` | `ORG_TMPL#<orgId>#<templateId>` | `META` | Org header |
| `ORG_ENABLEMENT` | `ENABLE#<enablementId>` | `META` | Org ↔ master version link |

### 2.3 Document shape (`template_dynamodb_json.json`)

Store on each **VERSION** row (master example):

- Top-level: `entityType`, `meta`, `carePlanAttributes`, `sharedComponents`, `links`, `steps`, `templateTypeConfig`
- `meta`: `templateId`, `templateVersionId`, `templateType`, `templateName`, `status`, `publishedAt`, `specialty`, `countries`, audit fields, etc.
- Large payloads: if `schemaSize` > 50 KB → set `schemaRef` (S3), `schemaHash`, strip inline body per OpenAPI

### 2.4 GSI projections (template values on generic gsi* attributes)

| Index | When to set | gsiNpk | gsiNsk |
|-------|-------------|--------|--------|
| **GSI1** | Org templates + enablements | `ORG#<organizationId>` | Org template: `TMPL#<templateType>#<status>#<lastModifiedAt>#<templateId>` |
| | | | Enablement: `ENABLE#<effectiveFrom>#<enablementId>` |
| **GSI2** | Published **master** catalog | `TYPE#<templateType>#SCOPE#MASTER` | `PUB#<publishedAt>#<templateId>#<templateVersionId>` |
| **GSI3** | Enablement search by master version | `MSTR_VER#<masterTemplateVersionId>` | `ORG#<organizationId>#<enablementId>` |
| **GSI4** | Optional: `templateCode` lookup | `CODE#<templateCode>` | `VER#<version>#<templateId>` |
| **GSI5** | Optional: non-published admin queues | `SCOPE#MASTER#STATUS#<status>` | `TS#<lastModifiedAt>#<templateId>` |

Clear `gsi2pk`/`gsi2sk` when master is not `PUBLISHED`. Rewrite GSI keys on lifecycle transitions (same idea as alert rewriting `gsi1pk` on state change).

---

## 3. API catalog → implementation map

**Authorizer (all routes except `/health`):** same as alert-service:

```yaml
authorizer:
  name: common_authorizer
  type: token
  identitySource: method.request.header.Authorization
  arn: arn:aws:lambda:${region}:${account}:function:${stage}_global_user_package_custom_authorization
  resultTtlInSeconds: 0
```

| # | Method | Path | operationId | Handler file | Controller method | Primary DDB access |
|---|--------|------|-------------|--------------|---------------------|-------------------|
| 0 | GET | `/health` | — | `health.ts` | — | none |
| 1 | POST | `/templates/master` | `createMasterTemplate` | `createMasterTemplate.ts` | `handleCreateMaster` | TransactWrite: `META` + `VERSION#001` |
| 2 | GET | `/templates/master` | `listMasterTemplates` | `listMasterTemplates.ts` | `handleListMaster` | Query **GSI2**; FilterExpression for category/condition/country/status |
| 3 | GET | `/templates/master/{templateId}/meta` | `getMasterTemplateMeta` | `getMasterTemplateMeta.ts` | `handleGetMasterMeta` | GetItem `pk=MASTER_TMPL#id`, `sk=META` |
| 4 | GET | `/templates/master/{templateId}/versions` | `getMasterTemplateVersions` | `getMasterTemplateVersions.ts` | `handleGetMasterVersions` | Query `pk` + `begins_with(sk,'VERSION#')` OR `version=latest` / `version={id}` |
| 5 | PUT | `/templates/master/{templateId}/versions/{versionId}` | `updateMasterTemplateVersion` | `updateMasterTemplateVersion.ts` | `handleUpdateMasterVersion` | UpdateItem VERSION (+ merge META if needed) |
| 6 | POST | `/templates/organizations/{organizationId}/{templateId}/versions/{versionId}/clone` | `cloneOrgTemplate` | `cloneOrgTemplate.ts` | `handleCloneToOrg` | Put new `ORG_TMPL#org#newId` + `VERSION#001` |
| 7 | GET | `/templates/organizations/{organizationId}/{templateId}/versions` | `getOrgTemplateVersions` | `getOrgTemplateVersions.ts` | `handleGetOrgVersions` | Query org partition; `version=meta` → `sk=META` |
| 8 | GET | `/templates/org` | `listOrgTemplates` | `listOrgTemplates.ts` | `handleListOrg` | Query **GSI1** `gsi1pk=ORG#<orgId>` |
| 9 | PUT | `/templates/org/{templateId}/versions/{versionId}` | `updateOrgTemplateVersion` | `updateOrgTemplateVersion.ts` | `handleUpdateOrgVersion` | UpdateItem; org from JWT; validate downstream rules |
| 10 | POST | `/templates/{templateId}/versions/{versionId}/status` | `transitionTemplateStatus` | `transitionTemplateStatus.ts` | `handleStatusTransition` | Update META; PUBLISH → new immutable VERSION + GSI2 |
| 11 | POST | `/org-enablements` | `createOrgEnablement` | `createOrgEnablement.ts` | `handleCreateEnablement` | Put `ENABLE#id` / `META`; GSI1 + GSI3 |
| 12 | GET | `/org-enablements` | `searchOrgEnablements` | `searchOrgEnablements.ts` | `handleSearchEnablements` | GSI1 and/or GSI3 by query params |
| 13 | GET | `/org-enablements/{orgId}` | `listOrgEnablementsByOrg` | `listOrgEnablementsByOrg.ts` | `handleListEnablementsByOrg` | Query GSI1 `ORG#orgId`, `begins_with(gsi1sk,'ENABLE#')` |
| 14 | GET | `/org-enablements/id/{enablementId}` | `getOrgEnablementById` | `getOrgEnablementById.ts` | `handleGetEnablement` | GetItem `pk=ENABLE#id`, `sk=META` |
| 15 | PATCH | `/org-enablements/id/{enablementId}` | `updateOrgEnablement` | `updateOrgEnablement.ts` | `handlePatchEnablement` | UPDATE dates or REVOKE (soft delete / clear GSIs) |
| 16 | GET | `/templates/compatible` | `listCompatibleTemplates` | `listCompatibleTemplates.ts` | `handleListCompatible` | Query GSI2; filter `status=PUBLISHED`, package linking rules |

---

## 4. Implementation phases

### Phase 0 — Plumbing (do first)

- [ ] Fix `libs/template-core/src/index.ts` (remove broken `./lib/template-core.js` export).
- [ ] Fix `tsconfig.base.json` path: `@api-hub/template-core` → `libs/template-core/src/index.ts`.
- [ ] Add `@api-hub/template-core` to `apps/template-service/esbuild-plugins.js`.
- [ ] Fix `health.ts`: `export const main` (serverless expects `.main`).
- [ ] Add `apps/template-service/project.json` (build/test targets like alert).
- [x] Table name via `TEMPLATE_TABLE` env (`libs/template-core` → `assertTemplateTable()`); set in `serverless.yml` / `.env`.
- [ ] Add `src/utils/helpers.ts` (copy pattern from `apps/alert-service/src/utils/helpers.ts`).
- [ ] Add `buildspec.yml` + wire CI (copy from alert-service, rename paths).

### Phase 1 — `libs/template-core` foundation

| Step | Task |
|------|------|
| 1.1 | `template.constants.ts` — table env, SK prefixes, GSI index names (`GSI1`…`GSI5`), entity types |
| 1.2 | `template-key.builder.ts` — `toMasterPk`, `toOrgPk`, `toEnablePk`, `buildGsi1Pk`, `buildGsi2Pk`, … |
| 1.3 | `template-ddb.model.ts` — TypeScript interface matching JSON sample + gsi/sk fields |
| 1.4 | `template-entity.builder.ts` — create master from `MasterTemplateCreateRequest`; set gsi keys |
| 1.5 | `template.repository.ts` — get/put/query/transact for master rows |
| 1.6 | `org-template.repository.ts` — org partition + GSI1 list |
| 1.7 | `enablement.repository.ts` — enablement CRUD + GSI1/GSI3 |
| 1.8 | `template-http.dto.ts` — `toTemplateSummary`, `toMasterListItem`, strip `pk`/`sk` from responses if required |
| 1.9 | Unit tests for key builder + repository (mock DynamoDB) |

### Phase 2 — Validators (Zod from OpenAPI)

Create schemas under `src/validators/` mirroring OpenAPI `components/schemas`:

| Schema | Used by |
|--------|---------|
| `MasterTemplateCreateRequest` | POST `/templates/master` |
| `MasterTemplateUpdateRequest` | PUT master version |
| `OrgTemplateUpdateRequest` | PUT `/templates/org/...` |
| `CloneTemplateRequest` | POST clone |
| `TemplateStatusTransitionRequest` | POST status |
| `OrgEnablementCreateRequest` / `UpdateRequest` | enablement APIs |
| Query schemas | list filters (`templateType`, `status`, `version`, `nextToken`, …) |

`request.validators.ts`:

- `validateOrgScopedRequest` — attach `orgId`, `actorUserId`, `authHeader` on `req` (same pattern as `ValidatedCreateAlert`).
- Reject cross-org access when path `organizationId` ≠ JWT org.

### Phase 3 — Controllers

| Controller | Responsibilities |
|------------|------------------|
| `template-http.controller.ts` | Master CRUD/list/meta/versions, status transition, compatible list |
| `org-template-http.controller.ts` | Org list, org update, org versions, clone |
| `enablement-http.controller.ts` | All `/org-enablements` routes |

Each method: validate → call service → map errors via `normalizeTemplateServiceError` (like alert).

### Phase 4 — HTTP handlers (thin)

One file per row in section 3. Pattern:

```typescript
import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { getTemplateHttpController } from '../../controllers/template-http.controller';
import { createMasterBodySchema } from '../../validators/template.schemas';
import { validateCreateMasterRequest } from '../../validators/request.validators';

const c = getTemplateHttpController();
export const main = withApiHandler(
  {
    operation: 'template.master.create',
    bodySchema: createMasterBodySchema,
    validator: validateCreateMasterRequest,
  },
  (req: LambdaRequest) => c.handleCreateMaster(req),
);
```

### Phase 5 — `serverless.yml`

For each API, add a `functions:` block:

- `handler: src/handlers/http/<file>.main`
- `events.http.path` + `method` from OpenAPI
- `cors: *httpApiCors`
- `authorizer` (except health)
- `bodyType` / `queryStringParameters` for swagger (optional, like alert)

Deploy order suggestion: health → create master → get meta → list → … → enablements.

### Phase 6 — Swagger & docs

- [ ] Port request/response `definitions` from OpenAPI into `swagger.json` (Swagger 2) for `serverless-auto-swagger`.
- [ ] Add `docs/services/template-service/db-mappings.md` (copy structure from alert `db-mappings.md`).
- [ ] Keep `template-service-care-plan.openapi.yaml` as **contract source of truth**.

### Phase 7 — Events (after HTTP stable)

- [ ] `src/handlers/events/bootstrap/event-runtime.ts` — EventBridge adapter, `source: template-service`.
- [ ] On `PUBLISH`: emit `Template.Published.v1` to `template-service-bus-{stage}`.
- [ ] Optional consumer + DLQ wiring (see `docs/engineering/EVENT_DRIVEN_DEVELOPMENT_GUIDE.md`).

### Phase 8 — Tests

| Layer | What to test |
|-------|----------------|
| `template-core` | Key builder, gsi rewrites on status change, repository queries |
| Handlers | `*.spec.ts` with mocked controller (copy `createAlert.spec.ts` pattern) |
| E2E (later) | serverless-offline + local DynamoDB optional |

---

## 5. Per-API implementation notes

### 5.1 POST `/templates/master` (create)

- **Body:** full `CarePlanTemplateDocument` (same structure as `template_dynamodb_json.json`).
- **Write:** `META` + `VERSION#001` (or `VERSION#` + padded id from `meta.version`).
- **Generate:** `templateId`, `templateVersionId` if not supplied; initial `status` = `DRAFT` or `SAVED`.
- **Response:** `ApiSuccessTemplateCreated` → `TemplateSummaryData` (OpenAPI example).
- **Errors:** 400 validation, 409 duplicate `templateCode` / id.

### 5.2 GET `/templates/master` (list)

- **Query GSI2:** `gsi2pk = TYPE#CARE_PLAN#SCOPE#MASTER` (or filter by `templateType` param).
- **Filters:** `category`, `condition`, `country`, `status`, `language`, `specialty`, `templateCode` — `FilterExpression` on projected attributes.
- **Pagination:** `nextToken` = base64 encoded `LastEvaluatedKey`.
- **Response:** `ApiSuccessMasterTemplateList`.

### 5.3 GET `.../versions` (master & org — unified)

Query param `version`:

| `version` | Behavior |
|-----------|----------|
| omitted | Query all `VERSION#*` under `pk` |
| `latest` | Single item where `meta.isLatestVersion === true` or highest version |
| `meta` | **Org only:** `sk=META` |
| `<versionId>` | GetItem `sk=VERSION#<versionId>` |

Return full document or summary per OpenAPI response schema.

### 5.4 PUT `/templates/org/{templateId}/versions/{versionId}` (required)

- **Org id:** from JWT only (ignore body override unless spec allows).
- **Validate:** downstream rules — fields with `downstream.update = NO` on master cannot change on org.
- **Update:** VERSION row + optionally merge into META.
- **Rewrite:** `gsi1pk`/`gsi1sk` if status or `lastModifiedAt` changes.

### 5.5 POST `.../status` (lifecycle — required)

| action | Transition |
|--------|------------|
| `SUBMIT_REVIEW` | DRAFT/SAVED → IN_REVIEW |
| `PUBLISH` | IN_REVIEW → PUBLISHED; new immutable VERSION row; set `publishedAt`; populate GSI2 |
| `REJECT` | IN_REVIEW → DRAFT/SAVED; `reason` required |
| `ARCHIVE` | PUBLISHED → ARCHIVED |
| `DEPRECATE` | PUBLISHED → DEPRECATED |

Resolve master vs org by caller scope + `templateId` (document in controller).

### 5.6 Clone org template

- **Read** source: `ORG_TMPL#org#templateId` + `VERSION#versionId` (or master source per spec).
- **Write** new partition `ORG_TMPL#org#newTemplateId`, `VERSION#001`.
- Set `derivedFromTemplateVersionId` in `meta`.

### 5.7 Enablements

- Only **published** master versions can be enabled.
- **Create:** validate master exists and `status=PUBLISHED`.
- **PATCH:** `action=UPDATE` (dates) or `REVOKE` (soft revoke / remove from active GSI projections).

### 5.8 GET `/templates/compatible`

- Query GSI2 (published masters), filter by `condition`, `countries`, `duration`, linking rules in OpenAPI.

---

## 6. Response & error envelope

Match alert-service / OpenAPI wrappers:

- Success: `{ success: true, message: string, data: T, nextToken?: string }`
- Errors via `@api-hub/utils` `BaseError` → 400 / 401 / 403 / 404 / 409 / 422 / 500
- Use same codes as OpenAPI `components/responses` where defined

Do **not** expose raw `pk`/`sk` in API responses unless OpenAPI `MasterTemplateRecord` explicitly includes them (prefer stripping in mapper).

---

## 7. `serverless.yml` checklist (per function)

```yaml
functions:
  createMasterTemplate:
    handler: src/handlers/http/createMasterTemplate.main
    events:
      - http:
          path: templates/master
          method: post
          cors: *httpApiCors
          authorizer: <common_authorizer>
```

Repeat for all 16 endpoints. Keep `health` without authorizer.

---

## 8. Suggested build order (sprints)

| Sprint | Deliverables |
|--------|----------------|
| **S1** | Phase 0 + Phase 1 (core lib) + POST master + GET meta + GET one version |
| **S2** | List master, update master version, unified versions query |
| **S3** | Org list, org update, org versions, clone |
| **S4** | Status transition (PUBLISH + GSI2), compatible templates |
| **S5** | All enablement APIs |
| **S6** | Events, swagger.json, handler tests, stg/prd deploy |

---

## 9. Definition of done (per API)

- [ ] Handler + controller + service + repository implemented
- [ ] Zod schema matches OpenAPI request body / query params
- [ ] DynamoDB keys and GSI fields match section 2.4
- [ ] Response shape matches OpenAPI example / schema
- [ ] Registered in `serverless.yml` with authorizer + CORS
- [ ] Unit test for happy path + 404 + validation error
- [ ] Manual test via `serverless offline --stage dev`

---

## 10. Quick reference links

| Resource | Path |
|----------|------|
| OpenAPI contract | `apps/template-service/template-service-care-plan.openapi.yaml` |
| Sample DynamoDB document | `apps/template-service/template_dynamodb_json.json` |
| Serverless config | `apps/template-service/serverless.yml` |
| Alert pattern (handlers) | `apps/alert-service/src/handlers/http/` |
| Alert pattern (controller) | `apps/alert-service/src/controllers/alert-http.controller.ts` |
| Alert pattern (domain lib) | `libs/alert-core/` |
| Alert DB mappings doc | `docs/services/alert-service/db-mappings.md` |

---

*Last updated: Sprint 1 — create/list master templates implemented.*

---

## 11. Implemented APIs (Sprint 1) — run & test

### 11.1 Status

| API | Status | Files |
|-----|--------|-------|
| `POST /templates/master` | Done | `createMasterTemplate.ts`, `template-http.controller.ts`, `template.service.ts` |
| `GET /templates/master` | Done | `listMasterTemplates.ts`, same controller/service |
| `GET /health` | Done | `health.ts` |

### 11.2 Prerequisites

From repo root:

```bash
pnpm install
```

**Environment (no `.env` required):** Lambda env vars are defined in Serverless (SAM-style), same as `alert-service`:

- `provider.environment` → `infra/environments/environment.yml`
- Stage-specific names/URLs → `infra/config/infra-custom.yml` (`template-service-${stage}`, event bus, CORS, service URLs)

For `dev`: `TEMPLATE_TABLE=template-service-dev`, `TEMPLATE_EVENT_BUS_NAME=template-service-bus-dev`, `AWS_REGION=us-east-1` are set automatically when you run `serverless offline --stage dev` or deploy.

AWS credentials must allow DynamoDB read/write on `template-service-dev`.

### 11.3 Start server (offline)

From repo root:

```bash
pnpm template-service:offline
```

Or from the app folder:

```bash
cd apps/template-service
pnpm offline
```

Default URL: `http://localhost:3000` (see `serverless.yml` → `serverless-offline.httpPort`).

**Note:** Alert-service also uses port `3000`. Run only one at a time, or change `httpPort` in `serverless.yml`.

### 11.4 Unit tests

From repo root (PowerShell: ensure Node on PATH, e.g. `$env:Path = "C:\nvm4w\nodejs;" + $env:Path`):

```bash
# template-service only (handlers, controller, validators)
pnpm --filter @api-hub/template-service test

# template-core only (entity builder, service)
cd libs/template-core && pnpm exec jest --config jest.config.cts

# both packages (recommended before PR)
pnpm --filter @api-hub/template-service run test:all
```

Or via Nx:

```bash
nx test template-service
nx test template-core
```

**What is covered:** auth (401), body validation (422), create/list happy paths, GSI key materialization, `specialties` → `meta.specialty`.

### 11.5 Auth token (required for create/list)

Handlers decode the **middle** JWT segment (same as unit tests in `handler-test-utils.ts`). Format:

```text
Bearer header.<base64url(JSON claims)>.signature
```

**Required claims** (at least one user id claim):

| Claim | Example |
|-------|---------|
| `custom:userID` | `platform-admin-1` |
| `custom:organizationID` | `org-apollo-001` (optional for master APIs; used when `organizationId` query omitted) |

**Bash — build token once per shell:**

```bash
export TOKEN=$(node -e "const p={'custom:organizationID':'org-apollo-001','custom:userID':'platform-admin-1'}; console.log('Bearer header.'+Buffer.from(JSON.stringify(p)).toString('base64url')+'.signature')")
echo "$TOKEN"
```

**PowerShell:**

```powershell
$TOKEN = node -e "const p={'custom:organizationID':'org-apollo-001','custom:userID':'platform-admin-1'}; console.log('Bearer header.'+Buffer.from(JSON.stringify(p)).toString('base64url')+'.signature')"
```

If you get **401 Unauthorized**, the token is missing `custom:userID` / `userId` / `sub`.

### 11.6 cURL — health (no auth)

```bash
curl -s http://localhost:3000/health
```

### 11.7 POST `/templates/master` — create

**Body shape:** flat JSON (`CarePlanTemplateDocument` / OpenAPI). Do **not** send a nested `meta` object — META + `VERSION#001` rows are built server-side from top-level fields.

#### Required fields (validated)

| Field | Type | Notes |
|-------|------|--------|
| `templateCode` | string | Business code; `CP_HTN_STANDARD` → stored `templateId` **`CP-HTN-STANDARD`** (underscores → hyphens, uppercased) |
| `templateName` | string | Max 150 chars |

#### Fields that populate META (recommended)

| Field | Type | Notes |
|-------|------|--------|
| `templateType` | string | Default `CARE_PLAN` |
| `templateDescription` | string | Max 300 |
| `status` | enum | `DRAFT` (default), `SAVED`, `IN_REVIEW`, `PUBLISHED`, `ARCHIVED`, `DEPRECATED` |
| `category` | string or string[] | e.g. `CHRONIC_DISEASE` or `["CHRONIC_DISEASE"]` |
| `condition` | string | Single condition |
| `conditions` | string[] | e.g. `["HYPERTENSION"]` |
| `countries` | string[] | e.g. `["IN","US"]` |
| `languages` | string[] | e.g. `["EN"]` |
| `specialty` or `specialties` | string[] | OpenAPI uses `specialties`; both accepted |
| `version` | number | Default `1` → `templateVersionId` e.g. `CP-HTN-STANDARD-V01`, `sk=VERSION#001` |
| `createdBy` | string | Optional; defaults to JWT `custom:userID` |

#### Extra OpenAPI fields (stored on VERSION row)

Any other keys from `CarePlanTemplateDocument` are persisted on the **version** item (passthrough), e.g. `enabledScope`, `manageability`, `carePlanConfiguration`, `linkedTemplates`, `visibilityRules`, `compliance`, `searchMetadata`, `auditInformation`, `tags`, `shareScope`, etc. See OpenAPI example under `POST /templates/master`.

#### Minimal create (curl)

```bash
curl -s -X POST "http://localhost:3000/templates/master" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "templateCode": "CP_HTN_STANDARD",
    "templateName": "Hypertension Management Plan",
    "templateType": "CARE_PLAN",
    "templateDescription": "Standard hypertension care plan",
    "status": "DRAFT",
    "category": ["CHRONIC_DISEASE"],
    "conditions": ["HYPERTENSION"],
    "countries": ["IN"],
    "languages": ["EN"],
    "specialties": ["CARDIOLOGY"],
    "version": 1
  }'
```

#### Rich create (matches OpenAPI example — truncated)

Use a unique `templateCode` each run (or delete the META row) to avoid **409 Conflict**.

```bash
curl -s -X POST "http://localhost:3000/templates/master" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "templateCode": "CP_HTN_STANDARD_V2",
  "templateName": "Hypertension Standard Care Plan",
  "templateDescription": "Standard hypertension management care plan.",
  "templateType": "CARE_PLAN",
  "templateSource": "MASTER",
  "status": "DRAFT",
  "category": ["CHRONIC_DISEASE"],
  "conditions": ["HYPERTENSION"],
  "countries": ["US", "IN"],
  "languages": ["EN"],
  "specialties": ["CARDIOLOGY", "INTERNAL_MEDICINE"],
  "shareScope": "SHAREABLE",
  "tags": ["HTN", "RPM"],
  "version": 1,
  "reviewRequired": true,
  "enabledScope": {
    "sections": [
      {
        "sectionCode": "CAREPLAN_OVERVIEW",
        "enabled": true,
        "mandatory": true,
        "allowOrgUpdate": true
      }
    ]
  },
  "carePlanConfiguration": {
    "duration": { "durationType": "90D" },
    "rpmMonitoring": { "enabled": true, "devices": ["BP_MONITOR"] }
  },
  "auditInformation": {
    "createdBy": "platform-admin-1",
    "changeReason": "Initial master template creation."
  }
}
EOF
```

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "templateId": "CP-HTN-STANDARD",
    "templateVersionId": "CP-HTN-STANDARD-V01",
    "version": 1,
    "status": "DRAFT",
    "createdAt": "2026-05-15T..."
  }
}
```

**DynamoDB:** `MASTER_TMPL#<templateId>` + `META` and `VERSION#001`; **GSI5** for non-published status; **GSI2** only when `status=PUBLISHED`.

### 11.8 GET `/templates/master` — list

#### Query parameters (OpenAPI-aligned)

| Query | Required | Implementation |
|-------|----------|----------------|
| `status` | **Recommended** | `DRAFT` / `SAVED` / `IN_REVIEW` / `ARCHIVED` / `DEPRECATED` → **GSI5**. `PUBLISHED` → **GSI2**. **If omitted → GSI2 (published catalog only).** |
| `templateType` | No | Default `CARE_PLAN` (GSI2 partition key) |
| `category` | No | Filter on `meta.category` / `meta.conditions` |
| `condition` | No | Filter on `meta.condition` / `meta.conditions` |
| `country` | No | `contains(meta.countries, country)` |
| `language` | No | `contains(meta.languages, language)` |
| `specialty` | No | `contains(meta.specialty, specialty)` |
| `templateCode` | No | Exact or prefix on `meta.templateCode` |
| `nextToken` | No | From previous `data.nextToken` |
| `organizationId` | No | **Accepted but not applied to GSI1 yet** (Sprint 2+) |

#### List DRAFT templates (use after create)

```bash
curl -s "http://localhost:3000/templates/master?status=DRAFT&templateType=CARE_PLAN" \
  -H "Authorization: $TOKEN"
```

#### List PUBLISHED catalog (GSI2)

```bash
curl -s "http://localhost:3000/templates/master?status=PUBLISHED&templateType=CARE_PLAN" \
  -H "Authorization: $TOKEN"
```

#### All filters combined

```bash
curl -s "http://localhost:3000/templates/master?status=DRAFT&templateType=CARE_PLAN&category=CHRONIC_DISEASE&condition=HYPERTENSION&country=IN&language=EN&specialty=CARDIOLOGY&templateCode=CP_HTN" \
  -H "Authorization: $TOKEN"
```

#### Pagination

```bash
curl -s "http://localhost:3000/templates/master?status=DRAFT&nextToken=PASTE_TOKEN_FROM_PREVIOUS_RESPONSE" \
  -H "Authorization: $TOKEN"
```

**Success response:**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "templateId": "CP-HTN-STANDARD",
        "templateVersionId": "CP-HTN-STANDARD-V01",
        "templateName": "Hypertension Management Plan",
        "templateType": "CARE_PLAN",
        "category": "CHRONIC_DISEASE",
        "condition": "HYPERTENSION",
        "countries": ["IN"],
        "version": 1,
        "status": "DRAFT",
        "isActive": true,
        "publishedAt": null
      }
    ],
    "nextToken": "..."
  }
}
```

### 11.9 PowerShell — full flow

```powershell
$env:Path = "C:\nvm4w\nodejs;" + $env:Path
$TOKEN = node -e "const p={'custom:organizationID':'org-apollo-001','custom:userID':'platform-admin-1'}; console.log('Bearer header.'+Buffer.from(JSON.stringify(p)).toString('base64url')+'.signature')"

$body = @{
  templateCode = "CP_HTN_STANDARD"
  templateName = "Hypertension Management Plan"
  templateType = "CARE_PLAN"
  status = "DRAFT"
  category = @("CHRONIC_DISEASE")
  conditions = @("HYPERTENSION")
  countries = @("IN")
  languages = @("EN")
  specialties = @("CARDIOLOGY")
  version = 1
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method POST -Uri "http://localhost:3000/templates/master" `
  -Headers @{ Authorization = $TOKEN; "Content-Type" = "application/json" } `
  -Body $body

Invoke-RestMethod -Uri "http://localhost:3000/templates/master?status=DRAFT&templateType=CARE_PLAN" `
  -Headers @{ Authorization = $TOKEN }
```

### 11.10 Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| 401 | Missing `custom:userID` in JWT |
| 422 | Missing `templateName` or empty `templateCode` |
| 409 | `templateCode` already exists (change code or delete META in DynamoDB) |
| List empty after create | Forgot `?status=DRAFT` (default list = **published** GSI2 only) |
| 403 before handler | API Gateway authorizer in AWS (offline may still reference authorizer ARN) |

### 11.11 Next APIs (not yet implemented)

Continue with section 8 Sprint 2: meta, versions, update master, then org + lifecycle + enablements.
