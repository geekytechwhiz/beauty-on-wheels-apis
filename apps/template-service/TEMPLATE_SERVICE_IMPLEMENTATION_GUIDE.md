# Template Service — Step-by-Step Implementation Guide

This guide aligns **code**, **OpenAPI** (`template-service-care-plan.openapi.yaml`), and **requirements** (`Requirements_Template_Service.md`) for the multi-template platform flow.

---

## Documents (source of truth)

| Document | Purpose |
| -------- | ------- |
| `Requirements_Template_Service.md` | Product/domain rules (types, linking, org derivation, versioning) |
| `template-service-care-plan.openapi.yaml` | HTTP contract for clients (Swagger / Postman) |
| `serverless.yml` | Deployed routes and Lambda wiring |
| `libs/template-core` | DynamoDB access, create/list/read, lifecycle |

---

## Phase 0 — Environment

1. **Table:** `template-service-dev` (or stage name from `infra/config/infra-custom.yml`).
2. **Run offline:**
   ```bash
   cd apps/template-service
   pnpm offline
   ```
3. **Base URL:** `http://localhost:3000`
4. **Auth:** Cognito JWT with `custom:userID` (and `custom:organizationID` for org APIs).

---

## Phase 1 — Master template flow (Alert / Monitoring first)

Requirements: platform creates **Master Templates** per template profile; each create writes **META + VERSION#001**.

### Step 1.1 — Create Alert Policy master

```http
POST /templates/master
Content-Type: application/json
Authorization: Bearer <token>
```

Body: nested shape (`templateCode`, `templateType: ALERT_POLICY`, `templateProfile`, `templateMetadata`, alert sections).  
See OpenAPI example `alert_policy_nested_create`.

**Verify DynamoDB:**

| pk | sk |
| --- | --- |
| `MASTER_TMPL#ALT-VITALS-V1` | `META` |
| `MASTER_TMPL#ALT-VITALS-V1` | `VERSION#001` |

**Note:** `templateId` = normalized `templateCode` (uppercase). Response `templateId` is canonical.

### Step 1.2 — Create Monitoring master

Same as 1.1 with `templateType: MONITORING`, `templateCode: MON-BP-v1`, `monitoringDefinitions[]`, etc.

### Step 1.3 — List saved templates

```http
GET /templates/master?status=Saved&templateType=ALERT_POLICY
```

- Uses **GSI5** (`SCOPE#MASTER#STATUS#SAVED`).
- Add filters only when values exist on the item (`condition`, `country`, …).

### Step 1.4 — Read META

```http
GET /templates/master/{templateId}/meta
```

Path `templateId` is normalized (e.g. `ALT-VITALS-v1` → `ALT-VITALS-V1`).

### Step 1.5 — Read full version + UI schema

```http
GET /templates/master/{templateId}/versions?version=latest
```

Response: full VERSION document + optional `uiApiResponse` (S3: `alert-api-response.json` / `monitoring-api-response.json`).

### Step 1.6 — List all versions

```http
GET /templates/master/{templateId}/versions?status=Saved
```

### Step 1.7 — Update (draft/saved only)

```http
PUT /templates/master/{templateId}/versions/{versionId}
```

Allowed when `meta.status` ∈ `DRAFT`, `SAVED`, `IN_REVIEW`.

### Step 1.8 — Lifecycle transition

```http
POST /templates/{templateId}/versions/{versionId}/status
Body: { "action": "SUBMIT_REVIEW" | "PUBLISH" | ... }
```

`PUBLISH` sets GSI2 keys for published catalog listing.

---

## Phase 2 — Care Plan master (flat document)

Requirements § Care Plan: flat `CarePlanTemplateDocument` at top level.

1. `POST /templates/master` with `templateType: CARE_PLAN` and flat body (OpenAPI example `cp_htn_standard_create`).
2. Same GET/list/meta/versions flow as Phase 1.
3. Linking sections reference other template version IDs per requirements (Monitoring, Goal, Alert Policy, …).

---

## Phase 3 — Org template flow (step by step)

Requirements (`Requirements_Template_Service.md` § Org Template Derivation):

- Org template is created from a **PUBLISHED** master version only.
- Persists `masterTemplateVersionId` / `derivedFromTemplateVersionId` for lineage.
- Org maintains **independent** version history after clone (`InheritanceType = CopyOnCreate`).

Use your Cognito JWT as `Authorization: Bearer <token>`.  
For **ROOT** platform admin, pass `organizationId` on list/clone/status when the target org is not `ROOT`.

Assume master Alert template `ALT-VITALS-V1` is **PUBLISHED** (`ALT-VITALS-V1-V01`).

---

### Step 3.1 — Publish master (skip if already PUBLISHED)

Master lifecycle (no `organizationId` query — or org META must not exist for this id):

```bash
# 3.1a Submit for review (if status is SAVED)
curl -s -X POST "http://localhost:3000/templates/ALT-VITALS-V1/versions/V01/status" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"action":"SUBMIT_REVIEW"}'

# 3.1b Publish (requires IN_REVIEW)
curl -s -X POST "http://localhost:3000/templates/ALT-VITALS-V1/versions/V01/status" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"action":"PUBLISH","comment":"Approved for org derivation"}'
```

---

### Step 3.2 — Clone published master → org

Creates new org template id, e.g. `ALT-VITALS-V1-ORG-ROOT` when org is `ROOT`.

```bash
curl -s -X POST "http://localhost:3000/templates/organizations/ROOT/ALT-VITALS-v1/versions/V01/clone" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"newTemplateName":"ROOT Org Vitals Alert Policy","inheritLinks":true}'
```

**Verify DynamoDB:**

| pk | sk |
| --- | --- |
| `ORG_TMPL#ROOT#ALT-VITALS-V1-ORG-ROOT` | `META` |
| `ORG_TMPL#ROOT#ALT-VITALS-V1-ORG-ROOT` | `VERSION#001` |

Save **`templateId`** from response (org id, not master id).

---

### Step 3.3 — List org templates

```bash
# All types for org (omit templateType)
curl -s "http://localhost:3000/templates/org?organizationId=ROOT&status=Saved" \
  -H "Authorization: Bearer <token>"

# Alert policies only
curl -s "http://localhost:3000/templates/org?organizationId=ROOT&status=Saved&templateType=ALERT_POLICY" \
  -H "Authorization: Bearer <token>"
```

Org JWT users can omit `organizationId` (taken from `custom:organizationID`).

---

### Step 3.4 — Read org META (`version=meta`)

```bash
curl -s "http://localhost:3000/templates/organizations/ROOT/ALT-VITALS-V1-ORG-ROOT/versions?version=meta" \
  -H "Authorization: Bearer <token>"
```

---

### Step 3.5 — Read org latest version (+ UI schema)

```bash
curl -s "http://localhost:3000/templates/organizations/ROOT/ALT-VITALS-V1-ORG-ROOT/versions?version=latest" \
  -H "Authorization: Bearer <token>"
```

Expect full document + optional `uiApiResponse` for Alert/Monitoring types.

---

### Step 3.6 — List org versions

```bash
curl -s "http://localhost:3000/templates/organizations/ROOT/ALT-VITALS-V1-ORG-ROOT/versions?status=Saved" \
  -H "Authorization: Bearer <token>"
```

---

### Step 3.7 — Update org template (short path)

`organizationId` from JWT (org user). Platform ROOT must use org context that owns the template.

```bash
curl -s -X PUT "http://localhost:3000/templates/org/ALT-VITALS-V1-ORG-ROOT/versions/V01" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"meta":{"templateName":"ROOT Org Vitals Alert Policy (updated)"}}'
```

Allowed only in `DRAFT`, `SAVED`, or `IN_REVIEW`.

---

### Step 3.8 — Org lifecycle (submit / publish)

Uses same URL as master; routes to **org** partition when org META exists and JWT org matches (or `organizationId` query).

```bash
# Submit for review
curl -s -X POST "http://localhost:3000/templates/ALT-VITALS-V1-ORG-ROOT/versions/V01/status?organizationId=ROOT" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"action":"SUBMIT_REVIEW"}'

# Publish org template
curl -s -X POST "http://localhost:3000/templates/ALT-VITALS-V1-ORG-ROOT/versions/V01/status?organizationId=ROOT" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"action":"PUBLISH"}'
```

Org users with matching JWT org can omit `?organizationId=ROOT`.

---

### Org flow diagram

```text
Master PUBLISHED (ALT-VITALS-V1-V01)
        │
        ▼ POST .../organizations/{orgId}/{masterId}/versions/V01/clone
ORG_TMPL#{org}#{newOrgTemplateId}  →  META + VERSION#001 (SAVED)
        │
        ├── GET /templates/org?status=Saved
        ├── GET .../versions?version=meta|latest
        ├── PUT /templates/org/{orgTemplateId}/versions/V01
        └── POST /templates/{orgTemplateId}/versions/V01/status  (org partition)
```

---

## Phase 4 — Enablements & compatible templates (step by step)

**Purpose (requirements):** Before an org clones/uses a master template, platform **enables** the published master version for that org. **Compatible** API finds published masters for linking (e.g. Care Plan → Alert Policy) by profile (`condition`, `country`, `templateType`).

**Prerequisite:** Master template **PUBLISHED** (e.g. `ALT-VITALS-V1-V01`).

---

### Step 4.1 — Create org enablement

Links `ROOT` (or your org) to published master `ALT-VITALS-V1-V01`.

```bash
curl -s -X POST "http://localhost:3000/org-enablements" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId": "ROOT",
    "masterTemplateVersionId": "ALT-VITALS-V1-V01",
    "effectiveFrom": "2026-05-27T00:00:00Z",
    "effectiveTo": null
  }'
```

**Verify DynamoDB:** `pk = ENABLE#ENB-ROOT-…`, `sk = META`, `gsi3pk = MSTR_VER#ALT-VITALS-V1-V01`.

Save `enablementId` from response.

**Errors:**

| Code | Cause |
| ---- | ----- |
| 409 | Enablement already exists for org + version |
| 409 | Master not `PUBLISHED` |
| 404 | Master version not found |

---

### Step 4.2 — List enablements by org

```bash
curl -s "http://localhost:3000/org-enablements/ROOT" \
  -H "Authorization: Bearer <token>"
```

---

### Step 4.3 — Search enablements

```bash
# By org
curl -s "http://localhost:3000/org-enablements?organizationId=ROOT" \
  -H "Authorization: Bearer <token>"

# By master version (GSI3)
curl -s "http://localhost:3000/org-enablements?masterTemplateVersionId=ALT-VITALS-V1-V01" \
  -H "Authorization: Bearer <token>"

# Both filters
curl -s "http://localhost:3000/org-enablements?organizationId=ROOT&masterTemplateVersionId=ALT-VITALS-V1-V01" \
  -H "Authorization: Bearer <token>"
```

---

### Step 4.4 — Get enablement by id

```bash
curl -s "http://localhost:3000/org-enablements/id/ENB-ROOT-XXXXXXXX" \
  -H "Authorization: Bearer <token>"
```

Replace with `enablementId` from Step 4.1.

---

### Step 4.5 — Update enablement window

```bash
curl -s -X PATCH "http://localhost:3000/org-enablements/id/ENB-ROOT-XXXXXXXX" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "UPDATE",
    "effectiveFrom": "2026-06-01T00:00:00Z",
    "effectiveTo": "2027-12-31T23:59:59Z"
  }'
```

---

### Step 4.6 — Revoke enablement

```bash
curl -s -X PATCH "http://localhost:3000/org-enablements/id/ENB-ROOT-XXXXXXXX" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"action": "REVOKE"}'
```

Returns **204** with no body.

---

### Step 4.7 — List compatible published templates (linking)

Find published **Alert Policy** masters for Hypertension + US (for Care Plan linking UI):

```bash
curl -s "http://localhost:3000/templates/compatible?condition=Hypertension&country=US&templateType=ALERT_POLICY" \
  -H "Authorization: Bearer <token>"
```

Care Plan catalog (optional `duration`):

```bash
curl -s "http://localhost:3000/templates/compatible?condition=HYPERTENSION&country=IN&templateType=CARE_PLAN&duration=MONTHS_6" \
  -H "Authorization: Bearer <token>"
```

Monitoring:

```bash
curl -s "http://localhost:3000/templates/compatible?condition=Hypertension&country=US&templateType=MONITORING" \
  -H "Authorization: Bearer <token>"
```

**Note:** Only **PUBLISHED** masters appear (GSI2). `duration` filter applies only when the template stores duration (usually Care Plan).

---

### Phase 4 flow diagram

```text
Master PUBLISHED (ALT-VITALS-V1-V01)
        │
        ▼ POST /org-enablements  (org allowed to use master)
ENABLE#<id>  (GSI1 org + GSI3 master version)
        │
        ├── GET /org-enablements/{orgId}
        ├── GET /org-enablements?organizationId=...
        ├── PATCH /org-enablements/id/{id}  (UPDATE / REVOKE)
        │
        ▼ GET /templates/compatible?templateType=ALERT_POLICY&...
Pick templateVersionId for Care Plan linking
        │
        ▼ (Phase 3) POST .../clone  → org template
```

---

## Phase 5 — Remaining template types (requirements backlog)

Implement in this order (same HTTP surface; different body sections):

1. **GOAL** — Goal Measurement Entries, targets  
2. **THRESHOLD** — ranges, optional Alert Policy linkage  
3. **TASK**, **SYMPTOM**, **OKR** — per requirements sections  
4. Extend `NestedMasterTemplateCreateRequest` in OpenAPI + validators per type  

Each type: create → list (`status` + `templateType`) → meta → versions → publish → org clone.

---

## OpenAPI maintenance checklist

When you change behavior:

1. Update `template-service-care-plan.openapi.yaml` path description + schemas.
2. Bump `info.version` (semver).
3. Import YAML in Swagger UI / Postman and re-export client stubs if used.
4. Keep `serverless.yml` query params in sync with OpenAPI `parameters`.

---

## Code touchpoints (by layer)

| Layer | Path |
| ----- | ---- |
| Routes | `apps/template-service/serverless.yml` |
| Validation | `apps/template-service/src/validators/request.validators.ts`, `template.schemas.ts` |
| HTTP | `apps/template-service/src/controllers/template-http.controller.ts` |
| UI inject | `apps/template-service/src/utils/template-ui-response.ts` |
| Core | `libs/template-core/src/lib/repositories/template.repository.ts` |
| Keys / META+VERSION | `libs/template-core/src/lib/builder/template-entity.builder.ts` |

---

## Testing checklist

- [ ] Create Alert + Monitoring → 2× (META + VERSION#001) in DynamoDB  
- [ ] List with `status=Saved&templateType=ALERT_POLICY` returns items  
- [ ] GET meta + GET `versions?version=latest` (path id any case)  
- [ ] `uiApiResponse` present for Alert/Monitoring when S3/local bucket configured  
- [ ] Publish master → GSI2 catalog  
- [ ] Clone published master → org partition  
- [ ] Org PUT + org status transition  
- [ ] POST `/org-enablements` for published master version  
- [ ] GET `/templates/compatible?templateType=ALERT_POLICY&condition=...&country=...`  

---

## Common issues

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| 404 on GET meta/versions | Path `templateId` case ≠ stored id | Use id from create response; path normalization (implemented) |
| Empty list | Wrong `status` (defaults to PUBLISHED) | Use `status=SAVED` for drafts |
| Empty list with filters | `condition`/`country` not on item | Drop filters or set fields on create |
| No `uiApiResponse` | S3 missing or wrong `templateType` | `ALERT_POLICY` / `MONITORING`; set `TEMPLATE_UI_BUCKET` |
| Enablement 404 | Master version id wrong / not published | Use `ALT-VITALS-V1-V01` from publish response |
| Compatible list empty | Master not published or profile mismatch | Publish master; match `condition`/`country` on meta |
| Enablement 409 duplicate | Same org + master version already enabled | PATCH revoke or use existing enablement |

---

## Next implementation tasks (recommended)

1. **Validators per template type** — Zod schemas for Alert/Monitoring sections (beyond `additionalProperties`).  
2. **S3 `schemaRef`** — offload large VERSION bodies (>50 KB).  
3. **Org read path** — attach `uiApiResponse` on org version reads (mirror master).  
4. **Goal / Threshold / Task** — nested create bodies + list filters.  
5. **Linking validation** — enforce Published master version refs on Care Plan link sections.  
