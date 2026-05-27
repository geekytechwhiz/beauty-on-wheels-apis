# Template Service — Metadata Registry Integration Plan

**Status:** Planning only (no code in this document)  
**Owner:** Template Service team  
**Related service:** `apps/metadata-registry-service` (`libs/metadata` domain)  
**Dev API base (example):** `https://244vhkoib0.execute-api.us-east-1.amazonaws.com/dev/`

---

## 1. Purpose

Today, Template Service treats many business codes as **fixed enums** in OpenAPI and examples (`HYPERTENSION`, `CHRONIC_DISEASE`, `MONTHS_6`, etc.). Product direction is to source those values from **Metadata Registry Service** so:

- Super Admin can add/change metadata without redeploying Template Service.
- Template APIs **validate** incoming codes against the registry (ACTIVE values).
- UI can load dropdowns from the same source of truth.
- `metadataConfig.metadataType` on care-plan fields aligns with registry **type codes**, not local enums.

This plan describes **what to change**, **how to integrate**, and **which APIs are affected** — step by step, without implementation.

---

## 2. Metadata Registry API (source of truth)

### 2.1 Endpoints you provided

| Use case | HTTP | Path |
|----------|------|------|
| List all metadata **types** (catalog) | `GET` | `{baseUrl}/metadata/type/list` |
| List **values** for one type | `GET` | `{baseUrl}/metadata/value/list?metadataTypeCode={code}` |

**Example base URL:**  
`https://244vhkoib0.execute-api.us-east-1.amazonaws.com/dev/`

**Full examples:**

```http
GET https://244vhkoib0.execute-api.us-east-1.amazonaws.com/dev/metadata/type/list
GET https://244vhkoib0.execute-api.us-east-1.amazonaws.com/dev/metadata/value/list?metadataTypeCode=Condition
```

### 2.2 Path parameters

| Path param | Allowed values | Meaning |
|------------|----------------|---------|
| `entityType` | `type` \| `value` | `type` = metadata type catalog; `value` = values under a type |

### 2.3 Useful query params (from registry OpenAPI)

**`GET /metadata/type/list`** (`entityType=type`):

| Query | Purpose for Template Service |
|-------|------------------------------|
| `module` | Filter types used by care-plan / template module (e.g. `CARE_PLAN`) |
| `applicableModules` | Same idea (comma-separated tokens) |
| `status` / `include-inactive` | Usually **ACTIVE only** for validation |

**`GET /metadata/value/list`** (`entityType=value`):

| Query | Required | Purpose |
|-------|----------|---------|
| `metadataTypeCode` | **Yes** | Which type’s values to load (e.g. `Condition`, `DurationType`) |
| `status` | No (default ACTIVE) | Only active values for validation |
| `applicableConditions` | No | Narrow values by condition (when type supports applicability) |
| `applicableCountries` | No | Narrow by country |
| `applicableCategories` | No | Narrow by category |
| `applicableLanguages` | No | Narrow by language |

**Note:** Registry also exposes `v1/metadata/...` routes in `serverless.yml`. Confirm which path prefix API Gateway uses in dev (`/metadata` vs `/v1/metadata`) before implementation.

### 2.4 Related registry APIs (later phases)

| Endpoint | When Template Service might use it |
|----------|----------------------------------|
| `GET /metadata/{entityType}` | Resolve single type/value |
| `GET /metadata/values/related` | Dependent dropdowns (e.g. condition → allowed durations) |
| `GET /metadata/relations` | Category ↔ condition relationships |
| `POST /metadata/{entityType}` | **Not** in Template Service scope (admin owns registry writes) |

---

## 3. Current state in Template Service (what is “hardcoded”)

### 3.1 OpenAPI (`template-service-care-plan.openapi.yaml`)

Fixed **enum schemas** (main gap):

| OpenAPI schema | Example hardcoded values | Used on |
|----------------|-------------------------|---------|
| `TemplateCategory` | `CHRONIC_DISEASE`, `POST_OP`, … | Create/list master, meta, compatible filters |
| `Condition` | `HYPERTENSION`, `DIABETES`, … | Create, list, compatible, enablement examples |
| `DurationType` | `DAYS_30`, `MONTHS_6`, `90D`, `6M`, … | Compatible query, care-plan attributes |
| `ReviewCadenceFrequency` | `DAILY`, `WEEKLY`, … | Care-plan document (may stay template-specific) |
| `TemplateStatus` | `DRAFT`, `PUBLISHED`, … | **Keep** — lifecycle, not registry metadata |

**Metadata-driven fields in care-plan document** (already modeled as registry **type codes**, but examples are static):

| Field in template JSON | `metadataConfig.metadataType` in YAML | Should match registry `metadataTypeCode` |
|------------------------|--------------------------------------|------------------------------------------|
| Duration | `DurationType` / `DURATION_TYPE` | Confirm exact code in dev registry |
| Devices in steps | `Device` | Confirm code |
| Data sources | `DataSourceType` | Confirm code |

### 3.2 Runtime code (`apps/template-service` + `libs/template-core`)

| Location | Hardcoded behavior |
|----------|-------------------|
| `template.schemas.ts` | `category`, `condition`, `country` are **free strings** (good); status uses local enum (correct) |
| `compatible-templates.service.ts` | Duration alias map (`90D` → `DAYS_90`, `6M` → `MONTHS_6`) — should align with registry value codes |
| OpenAPI examples / curls in `API_IMPLEMENTATION_PLAN.md` | Sample codes like `HYPERTENSION`, `IN` |

**No HTTP client to metadata-registry exists today** in template-service.

### 3.3 What should NOT move to registry (stay in Template Service)

| Concept | Reason |
|---------|--------|
| `TemplateStatus` (DRAFT, PUBLISHED, …) | Template lifecycle, not business metadata catalog |
| `StatusTransition` actions | Workflow owned by template domain |
| Enablement `action` UPDATE / REVOKE | API contract, not metadata values |
| DynamoDB keys / GSI design | Infrastructure, unchanged |

---

## 4. Target architecture

```text
┌─────────────┐     JWT      ┌──────────────────┐
│   Client    │ ──────────► │ Template Service │
│  (UI/BFF)   │             │                  │
└─────────────┘             │  ┌──────────────┐  │
       │                    │  │ Validators   │──┼──► validate codes vs cache/registry
       │                    │  └──────────────┘  │
       │ optional           │  ┌──────────────┐  │
       └────────────────────┼─►│ Metadata     │  │
         proxy list APIs     │  │ Client       │──┼──► HTTP GET registry
                            │  └──────────────┘  │
                            └────────┬───────────┘
                                     │ server-side (Lambda VPC / public API)
                                     ▼
                            ┌──────────────────┐
                            │ Metadata Registry │
                            │ Service           │
                            └──────────────────┘
```

### 4.1 Integration patterns (pick per use case)

| Pattern | Description | Best for |
|---------|-------------|----------|
| **A — Validate on write** | On POST/PUT, Template Service calls registry (or cache) and rejects unknown/inactive codes | Create/update master & org templates |
| **B — Proxy read APIs** | New Template Service endpoints return registry lists (pass-through + filter for template module) | UI dropdowns (single entry point, same auth) |
| **C — Client calls registry directly** | UI calls metadata-registry; Template Service only validates | Fewer template changes; two services to secure |
| **D — Warm cache at cold start** | Lambda loads type/value lists periodically; validation uses in-memory set | Performance, fewer registry calls |

**Recommendation:** **A + B** for Template Service: validate on write, expose optional **read** helpers for template UI; use **D** with TTL (e.g. 5–15 min) to avoid registry latency on every request.

### 4.2 Configuration

| Env var (proposed) | Example | Purpose |
|--------------------|---------|---------|
| `METADATA_REGISTRY_BASE_URL` | `https://244vhkoib0.execute-api.us-east-1.amazonaws.com/dev` | Registry HTTP base |
| `METADATA_REGISTRY_TIMEOUT_MS` | `3000` | Client timeout |
| `METADATA_CACHE_TTL_SECONDS` | `600` | In-process cache TTL |
| `TEMPLATE_METADATA_MODULE` | `CARE_PLAN` | Filter types for template domain |

Forward **Authorization** header (or service token) on registry calls so list endpoints respect tenant/rules if added later.

---

## 5. Metadata type mapping (template field → registry)

**Sprint 0 discovery (required):** Call dev registry and document actual `metadataTypeCode` values. Table below is **expected** from OpenAPI; names must be confirmed.

| Template field / filter | Registry `metadataTypeCode` (confirm) | List values API |
|----------------------|----------------------------------------|-----------------|
| `meta.category` | `TemplateCategory` or `Category` | `GET .../value/list?metadataTypeCode=...` |
| `meta.condition` / `conditions[]` | `Condition` | same |
| `meta.countries[]` | `Country` | same |
| `meta.languages[]` | `Language` | same |
| `meta.specialty` / `specialties[]` | `Specialty` | same |
| `meta.templateType` | `TemplateType` | same |
| `carePlanAttributes.duration` | `DurationType` | same |
| Step fields `metadataConfig.metadataType` | Per field (e.g. `Device`, `DataSourceType`) | same |
| Package linking filter `condition` | `Condition` | same |
| Package linking filter `country` | `Country` | same |
| Package linking filter `duration` | `DurationType` | same |

Store mapping in a single config file (e.g. `template-metadata-types.config.ts`) — **not** scattered strings.

---

## 6. Phased implementation plan

### Phase 0 — Discovery & alignment (1–2 days, no template code)

- [ ] Inventory ACTIVE types: `GET {base}/metadata/type/list?module=CARE_PLAN` (or agreed module token).
- [ ] For each type in §5, list values and document `metadataValueCode` / display names.
- [ ] Confirm API path prefix (`/metadata` vs `/v1/metadata`) on dev API Gateway.
- [ ] Agree canonical value codes for duration aliases (`90D`, `6M` vs `DAYS_90`, `MONTHS_6`).
- [ ] Sign-off with metadata-registry owners on applicability filters (`applicableConditions`, etc.).
- [ ] Update this doc’s mapping table with **confirmed** codes.

### Phase 1 — Shared client + cache (`libs` or `template-service`)

- [ ] Add `MetadataRegistryClient` (HTTP): `listTypes()`, `listValues(metadataTypeCode, filters?)`.
- [ ] Add in-memory cache with TTL + optional force-refresh for tests.
- [ ] Unit tests with mocked HTTP responses (no live registry in CI).
- [ ] Wire env vars in `serverless.yml` / `environment.yml`.

### Phase 2 — Validation on write (highest value)

Apply to **create/update** paths before DynamoDB write:

| API | Fields to validate against registry |
|-----|-------------------------------------|
| `POST /templates/master` | `category`, `condition`/`conditions`, `countries`, `languages`, `specialty`/`specialties`, `templateType` |
| `PUT /templates/master/.../versions/{versionId}` | Same + nested `carePlanAttributes` / `metadataConfig.selectedValues` |
| `PUT /templates/org/.../versions/{versionId}` | Same |
| `POST /org-enablements` | Optional: validate `masterTemplateVersionId` lineage only (not registry) |
| Care-plan nested fields | Any `metadataConfig.selectedValues` and duration fields |

**Error model:** `422 VALIDATION_ERROR` — `"Invalid metadata value '{code}' for type '{metadataTypeCode}'"`.

**Failure if registry down:** Policy choice — **fail closed** (reject writes) vs **fail open** (log + allow, risky). Recommend **fail closed** for create/update; reads can degrade with stale cache.

### Phase 3 — OpenAPI contract update

- [ ] Replace fixed enums (`Condition`, `TemplateCategory`, `DurationType`) with `type: string` + description: *Must be an ACTIVE metadata value code; see Metadata Registry type `{metadataTypeCode}`*.
- [ ] Add optional new Template Service endpoints (if Pattern B):

| Proposed endpoint | Behavior |
|-------------------|----------|
| `GET /templates/metadata/types` | Proxy/filter `metadata/type/list` for template module |
| `GET /templates/metadata/types/{metadataTypeCode}/values` | Proxy `metadata/value/list` |

- [ ] Version bump OpenAPI (`2.0.5` → `2.1.0`).
- [ ] Update `API_IMPLEMENTATION_PLAN.md` curls to use codes from registry, not hardcoded examples.

### Phase 4 — Read paths & filters

| API | Change |
|-----|--------|
| `GET /templates/master` (query filters) | Validate filter values if present; invalid filter → 400 |
| `GET /templates/org` | Same for `condition`, `specialty` |
| `GET /templates/compatible` | Validate `condition`, `country`, `duration` against registry before query |
| List/search enablements | No registry fields (unless adding metadata later) |

### Phase 5 — Relations & dependent metadata (optional)

- [ ] Use `GET /metadata/values/related` when UI needs “durations valid for condition X”.
- [ ] Use `GET /metadata/relations` for category ↔ condition if product requires hierarchies.

### Phase 6 — Observability & ops

- [ ] Metrics: registry latency, cache hit rate, validation failures by type.
- [ ] Dashboards/alerts when registry unreachable > N minutes.
- [ ] Runbook: “new condition not showing” → check registry ACTIVE status, then cache TTL.

---

## 7. API-by-api impact matrix (existing Template Service)

| # | API | Registry integration | Phase |
|---|-----|----------------------|-------|
| 1 | `POST /templates/master` | Validate metadata fields | 2 |
| 2 | `GET /templates/master` | Validate query filters | 4 |
| 3 | `GET /templates/master/{id}/meta` | No change (stored data) | — |
| 4 | `GET /templates/master/{id}/versions` | No change | — |
| 5 | `PUT /templates/master/{id}/versions/{versionId}` | Validate body metadata | 2 |
| 6 | `POST /templates/.../status` | No (lifecycle enums local) | — |
| 7 | `POST .../clone` | Validate optional body; cloned doc inherits codes already validated at master | 2 |
| 8 | `GET .../organizations/.../versions` | No change | — |
| 9 | `GET /templates/org` | Validate query filters | 4 |
| 10 | `PUT /templates/org/.../versions/{versionId}` | Validate body metadata | 2 |
| 11 | `GET /templates/compatible` | Validate query params | 4 |
| 12 | `POST /org-enablements` | No metadata codes in body | — |
| 13–16 | Enablement GET/PATCH | No change | — |
| — | **New** `GET /templates/metadata/...` | Proxy registry lists | 3 |

---

## 8. Data stored in DynamoDB (no schema migration required)

Template rows already store **codes as strings** (`meta.condition`, `countries`, etc.). Integration does **not** require a DynamoDB migration — only:

- Stricter validation on write.
- OpenAPI/docs no longer implying a closed enum set.
- Optional normalization (e.g. always store canonical `metadataValueCode` from registry, not display labels).

**Duration aliases:** Keep normalization layer in template-core but drive allowed aliases from registry values (or store only canonical codes).

---

## 9. Testing strategy (when implementing)

| Layer | What to test |
|-------|----------------|
| Metadata client | Mock HTTP; list types/values; error handling |
| Validators | Unknown code → 422; inactive code → 422; valid code → pass |
| Handlers | One create + one compatible query with mocked registry |
| Contract | OpenAPI no longer lists closed enums for registry-backed fields |
| E2E (manual) | Against dev base URL: create template with registry ACTIVE code |

**Do not** call live dev registry from unit tests in CI.

---

## 10. Risks & decisions needed

| Topic | Options | Recommendation |
|-------|---------|----------------|
| Registry unavailable | Fail open vs closed | Fail **closed** on writes |
| Who calls registry for UI | Template proxy vs direct | Template proxy (Pattern B) for consistent auth |
| Enum removal in OpenAPI | Breaking for codegen clients | Major version + release notes |
| `metadataType` naming | `DurationType` vs `DURATION_TYPE` | Single canonical code from registry catalog |
| Cross-service auth | Pass user JWT vs internal IAM | Start with **forward JWT**; revisit for service-to-service |

---

## 11. Out of scope (this initiative)

- Writing metadata types/values from Template Service (admin uses registry APIs).
- Replacing **template lifecycle** statuses with registry.
- Package linking service changes (Rohan) — only **compatible** query validation in Template Service.
- Four-level hierarchy addendum (Org Master / Org Care Plan) — separate plan.

---

## 12. Simple summary for stakeholders

| Question | Answer |
|----------|--------|
| Are template HTTP APIs done? | **Yes** (current OpenAPI). |
| Is metadata dynamic today? | **No** — enums and examples are hardcoded in YAML; validation is mostly loose strings. |
| What will change? | Template Service will **read** Metadata Registry to **validate** (and optionally **expose**) category, condition, country, duration, specialty, etc. |
| What APIs do we call? | `GET /metadata/type/list` and `GET /metadata/value/list?metadataTypeCode=...` on metadata-registry-service. |
| First step? | Phase 0: confirm type codes and value codes in **dev** registry, then implement client + validate-on-write. |

---

## 13. References

| Document / code | Path |
|---------------|------|
| Metadata Registry OpenAPI | `apps/metadata-registry-service/openapi.yaml` |
| Metadata Registry serverless routes | `apps/metadata-registry-service/serverless.yml` |
| Template OpenAPI (enums to relax) | `apps/template-service/template-service-care-plan.openapi.yaml` |
| Template implementation status | `apps/template-service/API_IMPLEMENTATION_PLAN.md` |
| Metadata domain library | `libs/metadata/` |
| Dev base URL (example) | `https://244vhkoib0.execute-api.us-east-1.amazonaws.com/dev/` |

---

*Last updated: planning draft for metadata-registry integration (no code changes in this file).*
