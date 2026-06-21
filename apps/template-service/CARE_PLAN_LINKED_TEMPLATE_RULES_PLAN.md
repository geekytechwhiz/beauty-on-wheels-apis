# CARE_PLAN linked-template rules — plan

Generate **field rules** from `LINKED_*` keys when creating a **master** care plan (`templateType: CARE_PLAN`).  
**GET APIs return the same `fieldValues` shape as create** — rules are stored internally and only exposed on org rules APIs.

**Depends on:** `TEMPLATE_FIELD_RULES_PLAN.md`, `TEMPLATE_ORG_FIELD_RULES_PLAN.md`  
**Reference UI schema:** `services-json/care-plan-api-response.json`  
**Reference rules snapshot:** `services-json/care-plan-api-rules.json`

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| `templateType === CARE_PLAN` only | GOAL, THRESHOLD, TASK, MONITORING master templates (keep generic walk) |
| Master **create** + **update** when `fieldValues` changes | Reading `*-api-rules.json` at runtime |
| Keys below in `fieldValues` | `LINKED_THRESHOLD_TEMPLATE` on care plan (not in UI today; see note) |

### CARE_PLAN linking keys

| Keys in `fieldValues` starting with `LINKED_` | Linkable type | In UI schema |
|-------------------|---------------|--------------|
| `LINKED_TASK_TEMPLATE` | TASK | Yes — `templateLinking.linkableTemplateType: TASK` |
| `LINKED_GOAL_TEMPLATE` | GOAL | Yes |
| `LINKED_MONITORING_TEMPLATE` | MONITORING | Yes |
| `LINKED_THRESHOLD_TEMPLATE` | THRESHOLD | **No** on care plan today — same algorithm when present |
| Any future `LINKED_*` key | Per product | Detected by prefix, not a hardcoded list |

---

## Trigger — your create example

`POST http://localhost:3000/templates` with:

```json
{
  "templateLevel": "MASTER",
  "templateType": "CARE_PLAN",
  "TEMPLATE_NAME": "Care plan Template 4",
  "fieldValues": {
    "LINKED_TASK_TEMPLATE": [
      {
        "subtitle": "Description",
        "workflowStage": "ONBOARDING",
        "description": "Description",
        "ruleBadges": [{ "color": "^#B54708", "bg": "^#FFF6ED", "label": "Monitoring" }],
        "id": "tasks-htn-care",
        "requiredForStageCompletion": true,
        "title": "HTN Care Tasks",
        "version": "1.0",
        "displayAsChecklistItem": false,
        "generationTrigger": "AT_REVIEW_DUE"
      }
    ]
  }
}
```

When `templateType` is `CARE_PLAN` and `fieldValues` contains any linking key above, rules generation uses the **linked-template algorithm** (section 3) instead of the generic “skip parent array” rule.

---

## Rules shape — nested under `LINKED_*` keys (CARE_PLAN only)

| `rules` area | Shape |
|--------------|--------|
| Normal fields (`CATEGORY`, `CONDITION`, `RPM_DEVICES`, …) | **Flat** — one key → one rule object (unchanged) |
| `LINKED_*` keys (prefix `LINKED_`) | **Nested** — mirrors the JSON inside the linked array item |

Inner keys from `fieldValues.LINKED_TASK_TEMPLATE[0]` become **child rule objects inside** `rules.LINKED_TASK_TEMPLATE`, not top-level keys in `rules`.

```
fieldValues.LINKED_TASK_TEMPLATE[0]          rules.LINKED_TASK_TEMPLATE
├── subtitle                          →      ├── subtitle: { enable, orgedit, … }
├── workflowStage                     →      ├── workflowStage: { … }
├── ruleBadges[0]                     →      ├── ruleBadges: { color, bg, label }
│   ├── color                         →      │   ├── color: { … }
│   ├── bg                            →      │   ├── bg: { … }
│   └── label                         →      │   └── label: { … }
└── id                                →      └── id: { … }
```

---

## Rule generation — CARE_PLAN linked keys

### Step 1 — Build nested rule tree from array item

For each present `fieldValues` key where `key.startsWith('LINKED_')`:

1. Start `rules[linkingKey]` with the **container** rule (booleans + `metadataMode` + `min` / `max` for how many links org may add).
2. If value is a **non-empty array of objects**, walk **first element** and attach **nested** child rules under the same object (same key names as `fieldValues` item JSON).
3. If value is `null` or `[]`, container rule only — no nested children.

| Parent key | Container `min` | Container `max` |
|------------|----------------:|----------------:|
| Any `LINKED_*` key | `0` | `20` |

### Step 2 — Nested walk (inside `rules.LINKED_TASK_TEMPLATE`)

For each key in the first array item:

| `fieldValues` value type | Nested `rules` shape |
|--------------------------|------------------------|
| Scalar / boolean / null | `"workflowStage": { enable, orgedit, add, defaultedit, delete, metadataMode, min, max }` |
| Object (not array) | Parent key gets container rule + nested children for each object key |
| Array of objects (e.g. `ruleBadges`) | Parent key gets container rule + nested children from **first** array element |

**From your `LINKED_TASK_TEMPLATE[0]` — nested keys under `rules.LINKED_TASK_TEMPLATE`:**

| Nested rule key | Source in `fieldValues` |
|-----------------|-------------------------|
| `subtitle` | item scalar |
| `workflowStage` | item scalar |
| `description` | item scalar |
| `id` | item scalar |
| `title` | item scalar |
| `version` | item scalar |
| `requiredForStageCompletion` | item boolean |
| `displayAsChecklistItem` | item boolean |
| `generationTrigger` | item scalar |
| `ruleBadges` | nested object with `color`, `bg`, `label` from `ruleBadges[0]` |

Each **leaf** nested rule uses standard defaults (`min: 1`, `max: 1`).  
`ruleBadges` is a **nested container** (not a flat key at `rules` root).

### Step 3 — Other `fieldValues` keys (same request)

All non-linking keys (`CATEGORY`, `RPM_DEVICES`, `REVIEW_CADENCE`, baseline fields, etc.) stay **flat** at `rules` root (existing algorithm).

### Step 4 — Empty / null linking values

| `fieldValues` value | `rules` generated |
|---------------------|-------------------|
| `LINKED_GOAL_TEMPLATE: null` | `rules.LINKED_GOAL_TEMPLATE` container only (`min: 0`) |
| `LINKED_TASK_TEMPLATE: []` | `rules.LINKED_TASK_TEMPLATE` container only |
| Key omitted | No rule for that key |

---

## Expected `rules` stored (DynamoDB VERSION row)

Excerpt for your curl — **`LINKED_TASK_TEMPLATE` rules are nested**, other fields stay flat at root:

```json
{
  "rules": {
    "CATEGORY": {
      "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
      "metadataMode": "Fixed", "min": 1, "max": 1
    },
    "CONDITION": {
      "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
      "metadataMode": "Fixed", "min": 1, "max": 1
    },
    "LINKED_TASK_TEMPLATE": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 0,
      "max": 20,
      "subtitle": {
        "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
        "metadataMode": "Fixed", "min": 1, "max": 1
      },
      "workflowStage": {
        "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
        "metadataMode": "Fixed", "min": 1, "max": 1
      },
      "description": {
        "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
        "metadataMode": "Fixed", "min": 1, "max": 1
      },
      "ruleBadges": {
        "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
        "metadataMode": "Fixed", "min": 0, "max": 10,
        "color": {
          "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
          "metadataMode": "Fixed", "min": 1, "max": 1
        },
        "bg": {
          "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
          "metadataMode": "Fixed", "min": 1, "max": 1
        },
        "label": {
          "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
          "metadataMode": "Fixed", "min": 1, "max": 1
        }
      },
      "id": {
        "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
        "metadataMode": "Fixed", "min": 1, "max": 1
      },
      "requiredForStageCompletion": {
        "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
        "metadataMode": "Fixed", "min": 1, "max": 1
      },
      "title": {
        "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
        "metadataMode": "Fixed", "min": 1, "max": 1
      },
      "version": {
        "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
        "metadataMode": "Fixed", "min": 1, "max": 1
      },
      "displayAsChecklistItem": {
        "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
        "metadataMode": "Fixed", "min": 1, "max": 1
      },
      "generationTrigger": {
        "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
        "metadataMode": "Fixed", "min": 1, "max": 1
      }
    }
  }
}
```

`fieldValues.LINKED_TASK_TEMPLATE` is stored **verbatim** (full array with nested `ruleBadges`).  
`rules.LINKED_TASK_TEMPLATE` mirrors that item’s **key structure** — not flattened to `rules.subtitle`, `rules.workflowStage`, etc.

Same pattern for `LINKED_GOAL_TEMPLATE` and `LINKED_MONITORING_TEMPLATE` when present.

---

## API contract — create vs GET (same `fieldValues`)

| API | Returns `fieldValues`? | Returns `rules`? | Shape |
|-----|------------------------|------------------|-------|
| `POST /templates` (create master) | **Yes** — full VERSION doc via `toMasterFullRecord` | **No** — stripped | `LINKED_TASK_TEMPLATE` array identical to request |
| `GET /templates` (list master) | **Yes** — per list item | **No** | Same stored `fieldValues` |
| `POST /templates/{templateId}` (update master) | **Yes** on response | **No** | Merged `fieldValues`; rules additive merge |
| `GET /templates/org/{templateId}/{orgId}` | **Yes** | **Yes** | Org copy: `fieldValues` + `rules` (nested under `LINKED_*`) |
| `PUT /templates/org/{templateId}/{orgId}` | **Yes** | **Yes** | Partial `rules` patch — supports nested paths under `LINKED_*` |

**Round-trip rule:** Whatever the client sends in `fieldValues.LINKED_TASK_TEMPLATE` on create must come back unchanged on GET (master list/detail and org rules GET).

---

**Org rules PUT example** (nested patch):

```json
{
  "rules": {
    "LINKED_TASK_TEMPLATE": {
      "workflowStage": { "orgedit": false },
      "generationTrigger": { "enable": false }
    },
    "CATEGORY": { "orgedit": false }
  }
}
```

---

## Gap vs current code

| Area | Today | This plan |
|------|-------|-----------|
| `rules` shape | **Always flat** at root | CARE_PLAN `LINKED_*` → **nested** tree matching item JSON |
| `LINKED_TASK_TEMPLATE` inner keys | Flattened to `rules.subtitle`, `rules.workflowStage`, … | Live under `rules.LINKED_TASK_TEMPLATE.subtitle`, … |
| `mergeOrgRulesPartial` | Flat path lookup only | Must support **one-level nested** merge under `LINKED_*` keys |
| `TemplateFieldRule` type | Single interface | `TemplateFieldRuleNode` = rule fields + optional nested child keys |
| `templateType` guard | None | CARE_PLAN-only branch for linking keys |

---

## Implementation checklist

### 1. Constants (`libs/template-core`)

```typescript
export const LINKED_TEMPLATE_FIELD_KEY_PREFIX = 'LINKED_' as const;

export function isLinkedTemplateFieldKey(key: string): boolean {
  return key.startsWith(LINKED_TEMPLATE_FIELD_KEY_PREFIX);
}
```

### 2. Rules utils (`template-rules.utils.ts`)

- Add `TemplateFieldRuleNode` type: `TemplateFieldRule` + optional nested keys (each child is `TemplateFieldRule` or another node).
- Add `buildNestedRulesFromLinkedItem(item: Record<string, unknown>): TemplateFieldRuleNode`.
- Add `buildRulesFromFieldValues(fieldValues, options?: { templateType?: string })`.
- When `templateType === 'CARE_PLAN'`:
  - For each `fieldValues` key matching `isLinkedTemplateFieldKey`:
    - Set `rules[linkingKey]` = container rule + `buildNestedRulesFromLinkedItem(firstArrayElement)` when non-empty array.
    - Container-only when `null` / `[]`.
  - All other keys → existing **flat** walk at `rules` root.
- Update `mergeOrgRulesPartial` to deep-merge nested children under `LINKED_*` keys.
- On master/org **fieldValues** update, `mergeRulesAfterFieldValuesChange` **replaces** each `LINKED_*` rule subtree (no stale nested keys).
- Wire callers:
  - `template.repository.ts` → `createMasterTemplate` (pass `input.templateType`)
  - `template-master-ops.service.ts` / `org-template-ops.service.ts` → updates (pass `meta.templateType`)

### 3. Tests (`template-rules.utils.spec.ts`)

- CARE_PLAN create with curl `LINKED_TASK_TEMPLATE` payload:
  - `rules.LINKED_TASK_TEMPLATE.min === 0`
  - `rules.LINKED_TASK_TEMPLATE.workflowStage` exists (nested, **not** `rules.workflowStage`)
  - `rules.LINKED_TASK_TEMPLATE.ruleBadges.color` exists (nested under `ruleBadges`)
  - `rules.subtitle` is **undefined** (not flattened)
- `LINKED_GOAL_TEMPLATE: null` → `rules.LINKED_GOAL_TEMPLATE` container only
- `templateType: GOAL` with `GOALS` array → flat inner keys only (unchanged)

### 4. API / mapper (no response shape change)

- `toMasterFullRecord` — already returns `fieldValues`, hides `rules` ✓
- `toOrgTemplateRulesResponse` — already returns `fieldValues` + `rules` ✓
- Add integration test: create CARE_PLAN → GET list → `fieldValues.LINKED_TASK_TEMPLATE` deep-equal to create body

### 5. Optional doc sync

- Update `TEMPLATE_FIELD_RULES_PLAN.md` Example 1 to note CARE_PLAN exception for linking keys.

---

## Pseudocode

```
function buildNestedRulesFromLinkedItem(item):
  node = {}
  for key, value in item:
    if value is array and value[0] is object:
      node[key] = { ...generateDefaultRule(), min: 0, ...buildNestedRulesFromLinkedItem(value[0]) }
    else if value is object and not array:
      node[key] = { ...generateDefaultRule(), ...buildNestedRulesFromLinkedItem(value) }
    else:
      node[key] = generateDefaultRule()
  return node

function buildRulesFromFieldValues(fieldValues, { templateType }):
  rules = {}

  if templateType === 'CARE_PLAN':
    for linkingKey in fieldValues keys where isLinkedTemplateFieldKey(linkingKey):
      if linkingKey not in fieldValues: continue
      value = fieldValues[linkingKey]
      container = generateLinkedTemplateContainerRule(linkingKey)
      if isArrayOfObjects(value):
        rules[linkingKey] = { ...container, ...buildNestedRulesFromLinkedItem(value[0]) }
      else:
        rules[linkingKey] = container

  for key, value in fieldValues:
    if templateType === 'CARE_PLAN' and isLinkedTemplateFieldKey(key):
      continue
    // existing flat walk for all other keys → rules[key] = generateDefaultRule()

  return rules
```

---

## Acceptance criteria

1. `POST /templates` with `templateType: CARE_PLAN` stores **nested** rules under `rules.LINKED_TASK_TEMPLATE` matching item JSON keys.
2. No flattening — `rules.workflowStage` must **not** exist; `rules.LINKED_TASK_TEMPLATE.workflowStage` must exist.
3. Create / GET `fieldValues.LINKED_TASK_TEMPLATE` round-trips identical to request.
4. `GET /templates/org/{templateId}/{orgId}` returns same nested `rules` tree.
5. Non–care-plan templates keep flat `rules` only.
