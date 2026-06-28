# Template Service — Route Trim Plan

Goal: keep **only** the HTTP routes listed below. Remove all other Lambda functions and API Gateway events from `template-service`. Shared domain logic in `libs/template-core` stays where kept routes still need it (enablement rows, DynamoDB, etc.).

**Source of truth today:** `apps/template-service/serverless.yml` (28 Lambdas, 30 HTTP events).

**After trim:** 15 HTTP routes kept · 13 Lambda functions · 15 routes removed · 15 Lambda functions removed.

---

## Keep vs remove — are any routes the same?

**No. The keep list and remove list do not overlap.**

Each API route is unique by **HTTP method + path** together. A route appears in exactly one list — never both.

| Question | Answer |
|----------|--------|
| Is any kept route identical to a removed route? | **No** — no matching method + path in both lists. |
| Are some routes *similar* but different endpoints? | **Yes** — legacy or alternate paths for related behavior (see section 3). Those are **different URLs**; only the canonical one is kept. |
| Same path, different method? | **Allowed on keep list** — e.g. GET and PUT both use `/template-configs/{configId}` but are different routes (read vs update). |

**Examples of similar-but-not-same (kept vs removed):**

| Kept | Removed (different route) | Why they differ |
|------|---------------------------|-----------------|
| GET `/templates?templateLevel=MASTER` | GET `/templates/master` | Different path — legacy alias removed. |
| GET `/templates?templateLevel=ORG` | GET `/templates/org` | Query on `/templates` vs bare `/templates/org` — different handlers. |
| POST `/templates/derive` | POST `…/organizations/…/clone` | Canonical derive vs legacy clone path. |
| PUT `/templates/org/{templateId}/{orgId}` | PUT `/templates/org/{templateId}/versions/{versionId}` | Field rules vs full version body update. |
| PUT `/templates/derive` | PATCH `/org-enablements/id/{enablementId}` | Enable/disable via derive vs standalone enablement API. |

---

## 1. Routes to keep

### Operations

| Method | Route | Lambda | Description |
|--------|-------|--------|-------------|
| **GET** | `/health` | `health` | Lightweight health check for load balancers, monitoring, and deploy smoke tests. Returns service availability without touching DynamoDB or auth-heavy logic. |

### Template configs

| Method | Route | Lambda | Description |
|--------|-------|--------|-------------|
| **POST** | `/template-configs` | `createTemplateConfig` | Creates a new UI configuration document for template authoring or org enablement drawers. Body includes `configType` (`TEMPLATE` or `ORG`) and the form JSON. Returns 409 if a config with the same id already exists. |
| **GET** | `/template-configs` | `listTemplateConfigs` | Lists UI configuration files used by the template builder. Filter by `configType` and/or `templateType` (e.g. `MONITORING`, `ALERT`) to load the correct form layout. |
| **GET** | `/template-configs/{configId}` | `getTemplateConfig` | Fetches one UI config by id (e.g. `MONITORING-MASTER-001` or an org key like `ENABLE_SCOPE`). Used when the UI opens a single form instead of listing all configs. |
| **PUT** | `/template-configs/{configId}` | `updateTemplateConfig` | Updates an existing config by id (e.g. `ALERT-MASTER-001`). TEMPLATE configs are full-document writes; ORG configs support partial section updates. Returns 404 if the config does not exist. |
| **GET** | `/template-configs/meta` | `postTemplateConfigMeta` | Returns dropdown options (country, language, conditions, specialty, etc.) for template-config forms. **Note:** deployed today as **POST** with body `{ metadataTypeCodes: [...] }`; align method to GET during trim if clients expect GET. |

### Master templates

| Method | Route | Lambda | Description |
|--------|-------|--------|-------------|
| **POST** | `/templates` | `upsertMasterTemplate` | Creates a new master template: writes META plus an initial VERSION in `draft` status and assigns a `templateId`. Used when starting a new care plan, monitoring, alert, or goal template from scratch. |
| **POST** | `/templates/{templateId}` | `upsertMasterTemplate` | Updates an existing master template’s content or runs lifecycle actions (publish, submit for review, etc.) on that `templateId`. Same handler as POST `/templates`; path id selects the template to update. |
| **GET** | `/templates?templateLevel=MASTER&status=PUBLISHED` | `listTemplates` | Lists master templates from the published catalog. Supports filters such as `status`, `country`, `category`, `templateType`, and pagination. `templateLevel=MASTER` is the default when omitted. |
| **GET** | `/templates?templateLevel=ORG&country=all` | `listTemplates` | Lists the org enablement catalog: published masters joined with per-org enablement state. Without `organizationId` returns the org-wide list; with `organizationId` returns that org’s enabled templates. `country=all` passes through as a filter. |

### Org templates

| Method | Route | Lambda | Description |
|--------|-------|--------|-------------|
| **GET** | `/templates/org-version-status?organizationId=…&templateId=…` | `getOrgVersionStatus` | Returns version status for one org + master pair: current org version, derived-from master version, latest published master, whether an upgrade is available, and whether the org copy has local changes. Powers the org versioning table in the UI. |
| **GET** | `/templates/org/{templateId}/{orgId}` | `getOrgTemplateRules` | Returns the org’s copy of a template (field values and document) plus full field rules for customization. `templateId` is the master id; `orgId` is the organization id. |
| **POST** | `/templates/derive` | `deriveTemplate` | Enables an org template from the latest (or specified) **published** master: creates the org partition copy, upserts enablement, and optionally org profile metadata. Idempotent if the org copy already exists. |
| **PUT** | `/templates/derive` | `updateOrgTemplateEnable` | Turns org template enablement on or off for a given org + master `templateId`. Disabling sets `effectiveTo`; re-enabling clears it. Does not delete the org copy. |
| **PUT** | `/templates/org/{templateId}/{orgId}` | `updateOrgTemplateRules` | Partially merges field-rule changes on the enabled org copy and bumps the minor version. Allowed only while the org version is in `draft`, `saved`, or `inReview`. |

**Total kept:** 15 routes → **13 Lambda functions** (`upsertMasterTemplate` serves POST `/templates` and POST `/templates/{templateId}`; GET `/templates` covers both MASTER and ORG query variants).

---

## 2. Routes to remove

These routes are **not** in the kept set. They are legacy aliases, standalone CRUD surfaces, or alternate paths for behavior already covered by a kept route. **None of these appear in section 1.**

### Legacy aliases

| Method | Route | Lambda | Why remove |
|--------|-------|--------|------------|
| POST | `/templates/master` | `upsertMasterTemplate` | Legacy alias for POST `/templates` — remove **event only**, keep the Lambda. |
| GET | `/templates/master` | `listMasterTemplates` | Legacy list; replaced by GET `/templates?templateLevel=MASTER`. |

### Version read/update

| Method | Route | Lambda | Why remove |
|--------|-------|--------|------------|
| GET | `/templates/{templateId}/versions` | `getTemplateVersions` | Unified version list/read; not in kept set. Master updates use POST `/templates/{templateId}`. |
| GET | `/templates/master/{templateId}/versions` | `getMasterTemplateVersions` | Legacy master versions path. |
| PUT | `/templates/{templateId}/versions/{versionId}` | `updateTemplateVersion` | Org version content update via canonical path; kept org rules use PUT `/templates/org/{templateId}/{orgId}`. |
| PUT | `/templates/org/{templateId}/versions/{versionId}` | `updateOrgTemplateVersion` | Org version body update; not the field-rules PUT in the kept set. |
| POST | `/templates/{templateId}/versions/{versionId}/status` | `transitionTemplateStatus` | Legacy org lifecycle; master lifecycle uses POST `/templates/{templateId}`. |

### Legacy org paths (replaced by kept routes)

| Method | Route | Lambda | Why remove |
|--------|-------|--------|------------|
| POST | `/templates/organizations/{organizationId}/{templateId}/versions/{versionId}/clone` | `cloneOrgTemplate` | Legacy derive; replaced by POST `/templates/derive`. |
| GET | `/templates/organizations/{organizationId}/{templateId}/versions` | `getOrgTemplateVersions` | Legacy org versions list. |
| GET | `/templates/org` | `listOrgTemplates` | **Different from** kept GET `/templates?templateLevel=ORG` — lists org partition copies (GSI1), not the enablement catalog. Not in kept set. |

### Catalog / enablement HTTP (not in kept set)

| Method | Route | Lambda | Why remove |
|--------|-------|--------|------------|
| GET | `/templates/compatible` | `listCompatibleTemplates` | Published catalog filtered by condition/country/duration; not in kept set. |
| POST | `/org-enablements` | `createOrgEnablement` | Standalone enablement create; derive flow handles enablement internally. |
| GET | `/org-enablements` | `searchOrgEnablements` | Standalone enablement search. |
| GET | `/org-enablements/{orgId}` | `listOrgEnablementsByOrg` | Standalone enablement list by org. |
| GET | `/org-enablements/id/{enablementId}` | `getOrgEnablementById` | Standalone enablement read. |
| PATCH | `/org-enablements/id/{enablementId}` | `updateOrgEnablement` | Standalone enablement update/revoke; PUT `/templates/derive` covers enable/disable. |

**Total remove:** 15 HTTP events → **15 Lambda functions** dropped from `serverless.yml`, plus **1 legacy event** removed from `upsertMasterTemplate` (POST `/templates/master`).

### Handlers not wired in serverless (safe to delete with cleanup)

| File | Notes |
|------|-------|
| `createMasterTemplate.ts` | Deprecated re-export of `upsertMasterTemplate`. |
| `saveMasterTemplate.ts` | Deprecated re-export of `upsertMasterTemplate`. |
| `updateMasterTemplateVersion.ts` | No deployed route; master updates go through POST `/templates/{templateId}`. |

---

## 3. Important distinctions (avoid accidental removal)

| Kept route | Do **not** confuse with | Difference |
|------------|-------------------------|------------|
| GET `/templates?templateLevel=ORG` | GET `/templates/org` | Query form = enablement catalog (`listTemplates`). Path `/templates/org` = org partition copies (`listOrgTemplates`) — **remove** the latter. |
| POST `/templates/derive` | POST `…/versions/{versionId}/clone` | Canonical derive vs legacy clone — **remove** clone. |
| PUT `/templates/org/{templateId}/{orgId}` | PUT `/templates/org/{templateId}/versions/{versionId}` | Field rules merge vs full version body update — **remove** version PUT. |
| PUT `/templates/derive` | `/org-enablements/*` | Enable/disable via derive vs standalone enablement CRUD — **remove** `/org-enablements/*` HTTP; enablement **data** in DynamoDB remains used by kept routes. |

---

## 4. Lambda summary after trim

| Keep (13 functions) | Remove (15 functions) |
|---------------------|------------------------|
| `health` | `listMasterTemplates` |
| `createTemplateConfig` | `getTemplateVersions` |
| `listTemplateConfigs` | `getMasterTemplateVersions` |
| `getTemplateConfig` | `updateTemplateVersion` |
| `postTemplateConfigMeta` | `cloneOrgTemplate` |
| `updateTemplateConfig` | `getOrgTemplateVersions` |
| `upsertMasterTemplate` *(drop legacy POST `/templates/master` event only)* | `listOrgTemplates` |
| `listTemplates` | `updateOrgTemplateVersion` |
| `getOrgVersionStatus` | `listCompatibleTemplates` |
| `deriveTemplate` | `createOrgEnablement` |
| `updateOrgTemplateEnable` | `searchOrgEnablements` |
| `getOrgTemplateRules` | `listOrgEnablementsByOrg` |
| `updateOrgTemplateRules` | `getOrgEnablementById` |
| | `updateOrgEnablement` |
| | `transitionTemplateStatus` |

---

## 5. Implementation checklist

1. **`serverless.yml`** — Remove 15 function blocks and the legacy POST `/templates/master` event on `upsertMasterTemplate`. Leave only the 13 functions above.
2. **Handlers** — Delete handler files (and `*.spec.ts`) for removed Lambdas only.
3. **Controllers** — Remove unused controller methods (e.g. `enablement-http.controller.ts` and compatible/versions helpers) if nothing else imports them.
4. **`libs/template-core`** — Keep repositories and services used by kept routes (`TemplateService`, `OrgTemplateService`, `OrgTemplateRulesService`, `TemplateConfigService`, `EnablementRepository` via derive/status/rules). Remove or trim **only** code exclusively used by removed HTTP routes (e.g. `CompatibleTemplatesService`, `EnablementService` HTTP-only paths) after confirming no other apps import them.
5. **Validators / schemas** — Remove Zod schemas and validators tied only to removed routes.
6. **OpenAPI** — Update `template-service.swagger.yaml`, `swagger.json`, and any `api-center` specs to match the trimmed surface. Today several specs lag deployment (missing org rules, meta, etc.).
7. **`/template-configs/meta` method** — Decide: change handler to GET or document POST as canonical; user list shows GET.
8. **Tests** — Delete specs for removed handlers; keep integration coverage for the 15 kept routes.
9. **Consumers** — Grep monorepo for removed paths (`/templates/master`, `/org-enablements`, `/templates/compatible`, `/templates/org` without `{templateId}/{orgId}`, etc.) and migrate callers to kept routes before deploy.

---

## 6. Files to touch (reference)

```
apps/template-service/
├── serverless.yml                          # primary trim
├── src/handlers/http/                      # delete removed handler + spec files
├── src/controllers/
│   ├── template-http.controller.ts         # trim unused methods
│   ├── org-template-http.controller.ts     # trim unused methods
│   ├── template-config-http.controller.ts
│   └── enablement-http.controller.ts       # candidate full removal
├── src/validators/                           # trim unused schemas
├── template-service.swagger.yaml
└── swagger.json

libs/template-core/src/lib/services/
├── compatible-templates.service.ts           # remove if only used by listCompatible
└── enablement.service.ts                   # trim if only used by /org-enablements HTTP
```

---

## 7. Pre-deploy verification

- [x] `serverless.yml` trimmed to 13 Lambdas / 15 HTTP events (legacy POST `/templates/master` removed).
- [x] Removed handler files + `enablement-http.controller.ts`; kept-route handlers unchanged.
- [x] Controller methods trimmed only where exclusive to removed routes (`handleListOrg`, `handleCloneToOrg` kept for `listTemplates` / `deriveTemplate`).
- [x] `npx jest --config jest.config.cts` in `apps/template-service` — 13 tests passed.
- [ ] OpenAPI / swagger specs updated to match trimmed surface.
- [ ] Grep monorepo consumers for removed paths before deploy.
- [ ] Kept flows smoke-tested in dev: create master → publish → derive → rules → org-version-status.
