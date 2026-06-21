# Org template field rules — plan (Phase 2)

Phase 1 stores flat `rules` on **master** VERSION rows (generated from `fieldValues`).  
Phase 2 copies those rules to **org** templates on enable, and exposes dedicated GET/PUT APIs for org admins to read and customize rules.

**Depends on:** `TEMPLATE_FIELD_RULES_PLAN.md` (master rules shape and path algorithm).

---

## What we store

On the **org** VERSION row (same shape as master, next to `fieldValues`):

```json
{
  "pk": "ORG_TMPL#mlepbaj40dac678b#CARE-PLAN-7-ORG-MLEPBAJ40DAC678B",
  "sk": "VERSION#001",
  "entityType": "OrgTemplate",
  "meta": { ... },
  "fieldValues": { ... },
  "rules": { ... }
}
```

| API | Returns `rules`? |
|-----|------------------|
| `POST /templates/derive` | **No** — same as master create (response unchanged) |
| `GET /templates`, list org APIs | **No** |
| **`GET /templates/org/{templateId}/{orgId}`** | **Yes** — minimal org meta + full `rules` |
| **`PUT /templates/org/{templateId}/{orgId}`** | **Yes** — returns updated minimal meta + full `rules` |

---

## Path parameters

| Param | Meaning | Example |
|-------|---------|---------|
| `templateId` | **Master** template id (same as derive body `templateId`) | `CARE-PLAN-7` |
| `orgId` | Organization id | `mlepbaj40dac678b` |

Resolve org copy:

1. `orgTemplateId = buildOrgTemplateId(templateId, orgId)` → e.g. `CARE-PLAN-7-ORG-MLEPBAJ40DAC678B`
2. Load org META + current VERSION row via `ORG_TMPL#<orgId>#<orgTemplateId>`
3. Verify enablement exists and `templateEnabled === true` (404 if never enabled)

Auth: `orgId` must match JWT `organizationId` (ROOT admin may pass any org).

---

## Org template versioning

Org templates use **minor decimal versioning** — same model as master templates (`bumpMinorVersion` in `template.utils.ts`).

### Version number rules

| Rule | Value |
|------|-------|
| **Starting version** (after derive / first enable) | `1` |
| **Each save** (rules or `fieldValues`) | `bumpMinorVersion(current)` → `1` → `1.1` → `1.2` → `1.3` … |
| **NOT allowed** | Integer major bump `1` → `2` → `3` |
| **`templateVersionId`** | Stays fixed at derive time, e.g. `CARE-PLAN-7-ORG-MLEPBAJ40DAC678B-V01` |
| **DynamoDB `sk`** | Stays `VERSION#001` — **in-place** update on the enabled org version row |
| **Display `version` in API** | `meta.version` (e.g. `1.2`) — use `resolveTemplateDisplayVersion()` |

```typescript
// Platform helper — already used by master template updates
bumpMinorVersion(1);   // → 1.1
bumpMinorVersion(1.1); // → 1.2
bumpMinorVersion(1.2); // → 1.3
```

### What bumps version

| Action | Bumps `meta.version`? | Changes `fieldValues`? | Changes `rules`? |
|--------|----------------------|------------------------|------------------|
| `POST /templates/derive` (first enable) | Sets `1` | Copy from master | Copy from master |
| `POST /templates/derive` (re-enable sync) | **No** — keeps current org version* | Replace from master | Replace from master |
| **`PUT /templates/org/{templateId}/{orgId}`** (rules) | **Yes** — minor bump | No | Partial merge |
| **`PUT /templates/org/{templateId}/versions/{versionId}`** (`fieldValues`) | **Yes** — minor bump | Merge/replace | Additive paths only if `fieldValues` changes |
| Status-only / `active`-only update | No | No | No |

\*Re-derive refreshes content from master but does not increment org version — only explicit org edits bump version.

### Persistence on each version bump

1. Merge changed document fields (`rules` and/or `fieldValues`) on the **current** VERSION row.
2. `meta.version = bumpMinorVersion(meta.version ?? 1)` on **both** META and VERSION rows.
3. `meta.lastModifiedAt` / `meta.lastModifiedBy` updated.
4. Append entry to `versionHistory` on the VERSION row (same as master).
5. **Do not** create `VERSION#002`, **do not** change `templateVersionId`.

### Fix required in existing org update

`OrgTemplateOpsService.updateOrgTemplateVersion` today does `(meta.version ?? 1) + 1` and creates `VERSION#002`. Phase 2 changes this to **in-place minor bump** (align with master `updateMasterTemplateVersion` in-place path).

---

## Rule object (same as Phase 1)

Every field path maps to one flat rule object with **eight** keys (see `TEMPLATE_FIELD_RULES_PLAN.md`):

```json
{
  "enable": true,
  "orgedit": true,
  "add": true,
  "defaultedit": true,
  "delete": true,
  "metadataMode": "Fixed",
  "min": 1,
  "max": 1
}
```

| Key | Type | Default at derive |
|-----|------|-------------------|
| `enable` … `delete` | boolean | all `true` |
| `metadataMode` | string | `"Fixed"` |
| `min` | number | `1` |
| `max` | number | `1` |

Flat map only — no nesting inside `rules`. Org copies inherit the full object from master on derive.

---

## 1. Enable / derive — copy rules from master

### Trigger

`POST /templates/derive` (existing endpoint — behaviour extension only).

### Request (example — CARE-PLAN-7 for ocean org)

```http
POST /templates/derive
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "organizationMeta": {
    "id": "mlepbaj40dac678b",
    "name": "ocean",
    "active": true,
    "country": "India",
    "updated": "1770613123722",
    "description": null
  },
  "categoryCode": "CHRONIC_CARE",
  "conditionCode": "DIABETES",
  "templateType": "care plan 7",
  "templateId": "CARE-PLAN-7"
}
```

### Behaviour

| Scenario | Rules behaviour |
|----------|-----------------|
| **First enable** (new org VERSION row) | Deep-copy `rules` from master VERSION row onto org VERSION row |
| **Re-enable** (org already exists → `syncOrgTemplateContentFromMaster`) | Replace org `rules` with master `rules` snapshot (full copy, not additive) |
| Master has no `rules` (legacy row) | Generate from master `fieldValues` via `buildRulesFromFieldValues()` then store on org |

Implementation hook: `OrgTemplateEntityBuilder.buildOrgVersionRow()` already spreads `extractDocumentFields(masterVersion)` — **`rules` flows automatically** if present on master. Add explicit fallback when master `rules` is missing (generate from `fieldValues`).

### Derive response

**Unchanged** — no `rules` in `POST /templates/derive` response.

```json
{
  "organizationMeta": { "id": "mlepbaj40dac678b", "name": "ocean", ... },
  "masterTemplate": {
    "templateId": "CARE-PLAN-7",
    "templateVersionId": "CARE-PLAN-7-V01",
    "templateName": "Care plan Template 7",
    "status": "published",
    ...
  },
  "orgTemplate": {
    "templateId": "CARE-PLAN-7-ORG-MLEPBAJ40DAC678B",
    "templateVersionId": "CARE-PLAN-7-ORG-MLEPBAJ40DAC678B-V01",
    "version": 1,
    "status": "saved",
    ...
  },
  "templateEnabled": true
}
```

Initial org version is always **`1`** (`meta.version` on META + VERSION rows).

### DynamoDB after derive (org VERSION row — excerpt)

Master had these rules (from Phase 1 walk of `fieldValues`):

```json
{
  "rules": {
    "TEMPLATE_NAME": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "CATEGORY": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "CONDITION": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "DURATION_TYPES": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "id": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "workflowStage": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "REVIEW_CADENCE": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 }
  }
}
```

Org VERSION row gets an **identical** `rules` object after first enable (including `metadataMode`, `min`, `max` on every path).

> **Note:** Re-derive overwrites org `rules` with the latest master snapshot. Org customizations made via PUT are lost on re-derive — document for clients.

---

## 2. GET org template rules

### Endpoint

```http
GET /templates/org/{templateId}/{orgId}
```

Example:

```http
GET /templates/org/CARE-PLAN-7/mlepbaj40dac678b
Authorization: Bearer <token>
```

### Response — minimal org details + all rules

Does **not** return full `fieldValues`, links, or overrides.

```json
{
  "organizationId": "mlepbaj40dac678b",
  "masterTemplateId": "CARE-PLAN-7",
  "orgTemplateId": "CARE-PLAN-7-ORG-MLEPBAJ40DAC678B",
  "templateVersionId": "CARE-PLAN-7-ORG-MLEPBAJ40DAC678B-V01",
  "version": 1,
  "templateName": "Care plan Template 7",
  "templateType": "care plan 7",
  "status": "saved",
  "templateEnabled": true,
  "derivedFromMasterVersion": 1,
  "derivedFromTemplateVersionId": "CARE-PLAN-7-V01",
  "lastModifiedAt": "2026-06-10T12:00:00.000Z",
  "rules": {
    "TEMPLATE_NAME": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "CATEGORY": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "CONDITION": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "DURATION_TYPES": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "id": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "workflowStage": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "REVIEW_CADENCE": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 }
  }
}
```

### Errors

| Status | When |
|--------|------|
| `404` | Org template not found or not enabled for this master + org |
| `401` | Missing/invalid token |
| `403` | JWT org does not match `orgId` (non-ROOT) |

---

## 3. PUT org template rules

### Endpoint

```http
PUT /templates/org/{templateId}/{orgId}
```

Updates `rules` on the **current org VERSION row** (`VERSION#001`) and **bumps `meta.version`** via `bumpMinorVersion` (e.g. `1` → `1.1`). Does **not** create a new `VERSION#00N` row and does **not** change `templateVersionId`.

Example:

```http
PUT /templates/org/CARE-PLAN-7/mlepbaj40dac678b
Content-Type: application/json
Authorization: Bearer <token>
```

### Request body

Top-level `rules` object. Include only field paths you want to change. Each value is a **partial** rule object — omitted booleans stay as stored.

```json
{
  "rules": {
    "CATEGORY": {
      "enable": false,
      "orgedit": false,
      "metadataMode": "Fixed",
      "min": 1,
      "max": 1
    },
    "CONDITION": {
      "orgedit": false,
      "defaultedit": false
    },
    "workflowStage": {
      "add": false,
      "delete": false,
      "min": 0,
      "max": 5
    }
  }
}
```

### Merge semantics

```
for each (fieldPath, partialRule) in body.rules:
  if fieldPath not in existingRules → 400 VALIDATION_ERROR (unknown field)
  existingRules[fieldPath] = { ...existingRules[fieldPath], ...partialRule }
```

- **Per-field shallow merge** — valid keys inside each rule object:

| Key | Type | Validation |
|-----|------|------------|
| `enable`, `orgedit`, `add`, `defaultedit`, `delete` | boolean | optional in PATCH |
| `metadataMode` | string | optional; e.g. `"Fixed"` |
| `min`, `max` | number | optional; non-negative integers; `min` ≤ `max` when both sent |

- **Cannot add new field paths** via PUT (paths come from master/derive only).
- **Cannot remove field paths** via PUT.
- Unknown keys or invalid types inside a rule → `400`.

### Version bump on rules PUT

After the PUT example above (org was at version `1`):

| Before | After |
|--------|-------|
| `version`: `1` | `version`: `1.1` |
| `templateVersionId`: `…-V01` | `templateVersionId`: `…-V01` (unchanged) |
| `sk`: `VERSION#001` | `sk`: `VERSION#001` (unchanged) |

A second rules PUT would yield `1.2`, then `1.3`, and so on.

### Response

Same shape as GET — minimal org meta + full `rules` after merge. **`version` reflects the bump.**

```json
{
  "organizationId": "mlepbaj40dac678b",
  "masterTemplateId": "CARE-PLAN-7",
  "orgTemplateId": "CARE-PLAN-7-ORG-MLEPBAJ40DAC678B",
  "templateVersionId": "CARE-PLAN-7-ORG-MLEPBAJ40DAC678B-V01",
  "version": 1.1,
  "templateName": "Care plan Template 7",
  "templateType": "care plan 7",
  "status": "saved",
  "templateEnabled": true,
  "derivedFromMasterVersion": 1,
  "derivedFromTemplateVersionId": "CARE-PLAN-7-V01",
  "lastModifiedAt": "2026-06-10T12:05:00.000Z",
  "rules": {
    "TEMPLATE_NAME": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "CATEGORY": { "enable": false, "orgedit": false, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "CONDITION": { "enable": true, "orgedit": false, "add": true, "defaultedit": false, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "DURATION_TYPES": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "id": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "workflowStage": { "enable": true, "orgedit": true, "add": false, "defaultedit": true, "delete": false, "metadataMode": "Fixed", "min": 0, "max": 5 },
    "REVIEW_CADENCE": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 }
  }
}
```

### Version row update

In-place read-modify-write on:

```
pk = ORG_TMPL#mlepbaj40dac678b#CARE-PLAN-7-ORG-MLEPBAJ40DAC678B
sk = VERSION#001   (current version from org META — never increments sk)
```

Also update META row: same `meta.version`, `lastModifiedAt`, `lastModifiedBy`. Append `versionHistory` entry on VERSION row.

### Editable status

Allow PUT in org statuses: `saved`, `draft`, `inReview` (same as `updateOrgTemplateVersion`). Reject `published` / `archived` with `409`.

---

## 4. PUT org template fieldValues — version alignment

### Endpoint (existing)

```http
PUT /templates/org/{orgTemplateId}/versions/{versionId}
```

`organizationId` from JWT. Updates `fieldValues`, overrides, and optional meta on the org copy.

### Version behaviour (Phase 2 fix)

| Today (wrong) | Phase 2 (correct) |
|---------------|-------------------|
| `version` `1` → `2` → `3` | `version` `1` → `1.1` → `1.2` → `1.3` |
| New row `VERSION#002`, `VERSION#003` | In-place on `VERSION#001` |
| `templateVersionId` changes to `…-V02` | `templateVersionId` stays `…-V01` |

### Example — fieldValues update after rules PUT

Org is at `version` `1.1` (from rules PUT above). User updates `fieldValues`:

```http
PUT /templates/org/CARE-PLAN-7-ORG-MLEPBAJ40DAC678B/versions/V01
Content-Type: application/json
```

```json
{
  "fieldValues": {
    "CATEGORY": "CHRONIC_CARE",
    "CONDITION": "DIABETES",
    "REVIEW_CADENCE": ["30_DAYS"]
  }
}
```

| Before | After |
|--------|-------|
| `version`: `1.1` | `version`: `1.2` |
| `rules`: unchanged paths + additive new paths if new `fieldValues` keys | additive merge for new field paths only |
| `sk`: `VERSION#001` | `VERSION#001` |

### Shared version counter

Rules PUT and fieldValues PUT share the **same** `meta.version` on the org template. Sequence example:

```
derive           → 1
rules PUT        → 1.1
fieldValues PUT  → 1.2
rules PUT        → 1.3
fieldValues PUT  → 1.4
```

---

## Example 4 — GOAL org template (nested array fields)

After derive of master `GOAL-1` for org `mlepbaj40dac678b`, GET returns:

```json
{
  "organizationId": "mlepbaj40dac678b",
  "masterTemplateId": "GOAL-1",
  "orgTemplateId": "GOAL-1-ORG-MLEPBAJ40DAC678B",
  "templateVersionId": "GOAL-1-ORG-MLEPBAJ40DAC678B-V01",
  "version": 1,
  "templateName": "Hypertension Goals",
  "templateType": "goal",
  "status": "saved",
  "templateEnabled": true,
  "rules": {
    "CATEGORY": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "goalName": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "goalType": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "measurements": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "appliesToType": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "linkedEntityCode": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 }
  }
}
```

PUT to lock down goal naming and allow up to 20 measurements (bumps `version` `1` → `1.1`):

```json
{
  "rules": {
    "goalName": { "orgedit": false, "defaultedit": false },
    "goalType": { "orgedit": false },
    "measurements": { "min": 1, "max": 20 }
  }
}
```

---

## Example 5 — THRESHOLD org template

GET after derive:

```json
{
  "organizationId": "mlepbaj40dac678b",
  "masterTemplateId": "THRESHOLD-HTN",
  "orgTemplateId": "THRESHOLD-HTN-ORG-MLEPBAJ40DAC678B",
  "rules": {
    "APPLIES_TO_TYPE": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "alertRequired": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "evaluationType": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "comparisonOperator": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "thresholdValue": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "severityLevel": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 }
  }
}
```

PUT — org cannot change severity bands:

```json
{
  "rules": {
    "severityLevel": { "enable": false, "orgedit": false, "add": false, "delete": false, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "thresholdValue": { "orgedit": true, "defaultedit": true, "min": 1, "max": 10 }
  }
}
```

---

## Implementation (short)

### `libs/template-core`

| Item | Purpose |
|------|---------|
| `mergeOrgRulesPartial(existing, patch)` | Per-field shallow merge for PUT; validate booleans + `metadataMode` + `min` + `max` |
| `generateDefaultRule()` | Include `metadataMode: "Fixed"`, `min: 1`, `max: 1` on every new path |
| `resolveOrgRulesFromMaster(masterVersion)` | `master.rules ?? buildRulesFromFieldValues(fieldValues)` |
| `bumpOrgTemplateVersionInPlace(...)` | Shared helper: merge doc fields + `bumpMinorVersion` + `versionHistory` + save META+VERSION |
| `OrgTemplateRulesService` (or extend `OrgTemplateOpsService`) | `getOrgTemplateRules`, `updateOrgTemplateRules` |
| `toOrgTemplateRulesResponse(record, enablement)` | Minimal DTO mapper |
| Hook in `buildOrgVersionRow` / derive sync | Ensure `resolveOrgRulesFromMaster` when cloning |
| **Fix** `OrgTemplateOpsService.updateOrgTemplateVersion` | Replace `(version + 1)` + new `VERSION#00N` with in-place `bumpMinorVersion` |

### `apps/template-service`

| Item | Purpose |
|------|---------|
| `GET .../getOrgTemplateRules.ts` handler | |
| `PUT .../updateOrgTemplateRules.ts` handler | |
| Validators for path + PUT body | Zod: `rules` record of partial rule objects |
| `serverless.yml` | Register both routes under `templates/org/{templateId}/{orgId}` |
| Tests | derive copies rules; GET returns rules; PUT merges partial; version `1`→`1.1`→`1.2`; fieldValues PUT uses minor bump; no `VERSION#002` |

### Files (suggested)

```
libs/template-core/src/lib/utils/template-rules.utils.ts     — add mergeOrgRulesPartial
libs/template-core/src/lib/services/org-template-rules.service.ts
libs/template-core/src/lib/mappers/org-template-rules.dto.ts
apps/template-service/src/handlers/http/getOrgTemplateRules.ts
apps/template-service/src/handlers/http/updateOrgTemplateRules.ts
```

---

## Phase 1 vs Phase 2 summary

| Concern | Phase 1 (master) | Phase 2 (org) |
|---------|------------------|---------------|
| Rules source | Walk `fieldValues` on create/update | Copy from master on derive |
| Rules in list/get APIs | Hidden | Hidden everywhere **except** new GET |
| Rules update API | None (auto from `fieldValues` additive) | **PUT** partial per field path |
| Version on save | `bumpMinorVersion` (`1` → `1.1` → `1.2`) | Same — rules PUT + fieldValues PUT |
| Physical VERSION row | In-place on `VERSION#001` (or master pattern) | In-place on `VERSION#001` |
| Re-sync from master | N/A | Re-derive replaces org `rules` (version unchanged) |

---

## Out of scope (later phases)

- Returning `rules` on derive or org list responses
- Adding new rule paths on org without master `fieldValues` change
- Inferring per-field `min` / `max` from `fieldValues` shape at create (defaults are uniform `1` / `1` until org PUT)
- Additional `metadataMode` enum values beyond `"Fixed"`
- New `VERSION#00N` row per org save (major version snapshots)
- Bulk rules update across multiple orgs
