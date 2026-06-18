# LINKED_* template rules — flat structure in `rules`

**Status:** design only (no code yet)  
**Replaces:** nested children inside `rules.LINKED_*` (see `CARE_PLAN_LINKED_TEMPLATE_RULES_PLAN.md`)  
**Reference response:** org rules GET for `CARE-PLAN-TEMPLATE-5` (Care plan Template 5)

---

## Goal

Keep **one `rules` object** — same API flow and DynamoDB storage as today.  
Change only the **shape** for CARE_PLAN linking keys:

1. `rules.LINKED_*` = **container rule only** (`min: 0`, `max: 20`) — no nested children inside the object.
2. Inner linked-item field rules (`subtitle`, `workflowStage`, `ruleBadges`, `color`, …) = **flat siblings** at `rules` root, same level as `CATEGORY` and `LINKED_TASK_TEMPLATE`.

| What | Where |
|------|--------|
| Normal fields (`CATEGORY`, `CONDITION`, `RPM_DEVICES`, …) | `rules.<key>` — unchanged |
| `LINKED_*` array container | `rules.LINKED_TASK_TEMPLATE` — rule flags only |
| Inner keys from `fieldValues.LINKED_TASK_TEMPLATE[0]` | `rules.subtitle`, `rules.workflowStage`, `rules.ruleBadges`, `rules.color`, … |

**No** separate `linkedTemplateRules` JSON. **No** new API field. **No** new DynamoDB attribute.

`fieldValues` shape is **unchanged**.

---

## Current (today) — nested inside `rules.LINKED_*`

Inner task fields live **inside** `rules.LINKED_TASK_TEMPLATE` on the same object as the container flags:

```json
{
  "rules": {
    "CATEGORY": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },

    "LINKED_TASK_TEMPLATE": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 0,
      "max": 20,
      "subtitle": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
      "workflowStage": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
      "id": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 }
    },

    "LINKED_GOAL_TEMPLATE": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 0, "max": 20 },
    "LINKED_MONITORING_TEMPLATE": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 0, "max": 20 }
  }
}
```

**Problem:** inner field rules are nested inside `rules.LINKED_TASK_TEMPLATE` instead of flat siblings.

---

## Proposed — flat siblings inside `rules`

### Top-level response shape (org rules GET) — unchanged

```json
{
  "organizationId": "mlepbaj40dac678b",
  "masterTemplateId": "CARE-PLAN-TEMPLATE-5",
  "orgTemplateId": "CARE-PLAN-TEMPLATE-5-ORG-MLEPBAJ40DAC678B",
  "templateVersionId": "CARE-PLAN-TEMPLATE-5-ORG-MLEPBAJ40DAC678B-V01",
  "templateType": "CARE_PLAN",
  "fieldValues": { },
  "rules": { }
}
```

### Flat layout inside `rules`

```
rules
├── CATEGORY, CONDITION, RPM_DEVICES, …     → normal flat rules (unchanged)
├── LINKED_TASK_TEMPLATE                    → container only (min: 0, max: 20)
├── LINKED_GOAL_TEMPLATE                    → container only
├── LINKED_MONITORING_TEMPLATE              → container only
├── ruleBadges                              → array container (min: 0, max: 10)
├── color, bg, label                        → leaf rules (from ruleBadges[0])
├── description, subtitle, workflowStage    → leaf rules (from LINKED_TASK_TEMPLATE[0])
├── id, title, version, generationTrigger   → leaf rules
└── requiredForStageCompletion, displayAsChecklistItem → leaf rules
```

`rules.LINKED_TASK_TEMPLATE` holds **only** its own rule flags — inner keys are **siblings** at `rules` root, not children.

---

## Full example (from Care plan Template 5)

### `fieldValues` — unchanged

```json
{
  "fieldValues": {
    "LINKED_TASK_TEMPLATE": [
      {
        "subtitle": "Description",
        "workflowStage": "ONBOARDING",
        "description": "Description",
        "ruleBadges": [
          { "color": "^#B54708", "bg": "^#FFF6ED", "label": "Monitoring" }
        ],
        "id": "tasks-htn-care",
        "requiredForStageCompletion": true,
        "title": "HTN Care Tasks",
        "version": "1.0",
        "displayAsChecklistItem": false,
        "generationTrigger": "AT_REVIEW_DUE"
      }
    ],
    "LINKED_GOAL_TEMPLATE": null,
    "LINKED_MONITORING_TEMPLATE": null,
    "CATEGORY": "CHRONIC_CARE",
    "CONDITION": "HYPERTENSION"
  }
}
```

### `rules` — single object, flat siblings (target shape)

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
      "max": 20
    },
    "LINKED_GOAL_TEMPLATE": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 0,
      "max": 20
    },
    "LINKED_MONITORING_TEMPLATE": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 0,
      "max": 20
    },
    "ruleBadges": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 0,
      "max": 10
    },
    "color": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 1,
      "max": 1
    },
    "bg": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 1,
      "max": 1
    },
    "label": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 1,
      "max": 1
    },
    "description": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 1,
      "max": 1
    },
    "requiredForStageCompletion": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 1,
      "max": 1
    },
    "title": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 1,
      "max": 1
    },
    "version": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 1,
      "max": 1
    },
    "displayAsChecklistItem": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 1,
      "max": 1
    },
    "generationTrigger": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 1,
      "max": 1
    },
    "subtitle": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 1,
      "max": 1
    },
    "workflowStage": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 1,
      "max": 1
    },
    "id": {
      "enable": true,
      "orgedit": true,
      "add": true,
      "defaultedit": true,
      "delete": true,
      "metadataMode": "Fixed",
      "min": 1,
      "max": 1
    }
  }
}
```

When `LINKED_GOAL_TEMPLATE` / `LINKED_MONITORING_TEMPLATE` are `null` in `fieldValues`, only their container rule is generated (no inner field keys from those links).

---

## Rule generation flow (`buildRulesFromFieldValues`)

Same entry point as today — one function builds the full `rules` map.

```
buildRulesFromFieldValues(fieldValues, { templateType })
│
├─ For each non-LINKED key in fieldValues
│    → rules[key] = flat rule (existing algorithm)
│
└─ When templateType === 'CARE_PLAN'
     For each key where key.startsWith('LINKED_')
     │
     ├─ rules[linkingKey] = container rule (min: 0, max: 20)
     │
     └─ If value is non-empty array of objects
          Walk first element → emit flat rules at rules root:
          • scalar/boolean  → rules[key] = leaf rule
          • array of objects (ruleBadges) → rules.ruleBadges = container (min: 0, max: 10)
            then keys in array[0] → rules.color, rules.bg, rules.label
```

### `LINKED_*` container keys

| `fieldValues` value | `rules[linkingKey]` |
|---------------------|---------------------|
| Non-empty array, `null`, or `[]` | Container rule only (`min: 0`, `max: 20`) |
| Key omitted | Key omitted from `rules` |

Container rule = standard defaults. **No nested children on this object.**

### Inner keys from linked array items (flat at `rules` root)

| Value in `fieldValues` item | Rule emitted |
|-----------------------------|--------------|
| Scalar / boolean (`subtitle`, `id`, `title`) | `rules.<key>` — leaf rule (`min: 1`, `max: 1`) |
| Array of objects (`ruleBadges`) | `rules.ruleBadges` — container (`min: 0`, `max: 10`) |
| Keys inside `ruleBadges[0]` | `rules.color`, `rules.bg`, `rules.label` — leaf rules |

**Scope:** `templateType === 'CARE_PLAN'` only. Other template types keep existing flat walk.

### Collision note

Inner field names (`id`, `title`, `subtitle`, …) are flat at `rules` root alongside `CATEGORY`, etc. If two `LINKED_*` arrays both define the same inner key, last-writer wins during generation. Acceptable for current CARE_PLAN UI (only one link type populated per template today).

### Stale key cleanup

On master/org **fieldValues** update, regenerate linking-related flat keys from scratch:
- Remove old inner keys (`subtitle`, `color`, …) if `LINKED_TASK_TEMPLATE` becomes `null` or `[]`
- Keep non-linking keys (`CATEGORY`, …) via existing additive merge

---

## API contract — same as today

| API | `fieldValues` | `rules` |
|-----|---------------|---------|
| `POST /templates` (master create) | Yes | No (stripped) |
| `GET /templates` (master list) | Yes | No |
| `GET /templates/org/{templateId}/{orgId}` | Yes | Yes (flat, includes LINKED_* + inner keys) |
| `PUT /templates/org/{templateId}/{orgId}` | Yes | Partial patch on `rules` |

No new response field. Clients keep reading/writing `rules` only.

### Org rules PUT — patch flat keys in `rules`

Patch inner linked field rules:

```json
{
  "rules": {
    "workflowStage": { "orgedit": false },
    "generationTrigger": { "enable": false },
    "CATEGORY": { "orgedit": false }
  }
}
```

Patch `LINKED_*` container:

```json
{
  "rules": {
    "LINKED_TASK_TEMPLATE": { "max": 5 }
  }
}
```

Patch badge leaf:

```json
{
  "rules": {
    "label": { "orgedit": false }
  }
}
```

Patch badge array container:

```json
{
  "rules": {
    "ruleBadges": { "max": 3 }
  }
}
```

`mergeOrgRulesPartial` stays **flat key lookup** — no nested path merge needed.

---

## Storage (DynamoDB) — unchanged

Single `rules` attribute on the VERSION row (same as today).

| Attribute | Content |
|-----------|---------|
| `rules` | All field rules: normal keys + `LINKED_*` containers + flat inner linked-item keys |

No `linkedTemplateRules` column. No mapper split/join layer.

---

## TypeScript sketch (for implementation)

```typescript
export interface TemplateFieldRule {
  enable: boolean;
  orgedit: boolean;
  add: boolean;
  defaultedit: boolean;
  delete: boolean;
  metadataMode: string;
  min: number;
  max: number;
}

/** All rules flat at root — LINKED_* containers and inner item keys are siblings */
export type TemplateRulesMap = Record<string, TemplateFieldRule>;

export interface OrgTemplateRulesPayload {
  fieldValues: Record<string, unknown>;
  rules: TemplateRulesMap;
}
```

```typescript
export const LINKED_TEMPLATE_FIELD_KEY_PREFIX = 'LINKED_' as const;

export function isLinkedTemplateFieldKey(key: string): boolean {
  return key.startsWith(LINKED_TEMPLATE_FIELD_KEY_PREFIX);
}

/** Keys emitted from walking LINKED_* array items — not nested under LINKED_* in rules */
function emitFlatLinkedItemRules(
  item: Record<string, unknown>,
  rules: TemplateRulesMap,
): void {
  for (const [key, value] of Object.entries(item)) {
    if (Array.isArray(value) && value[0] && typeof value[0] === 'object') {
      rules[key] = linkedArrayContainerRule(); // min: 0, max: 10
      for (const [childKey] of Object.entries(value[0] as Record<string, unknown>)) {
        rules[childKey] = defaultLeafRule();
      }
    } else {
      rules[key] = defaultLeafRule();
    }
  }
}
```

---

## Migration from nested-in-`rules.LINKED_*` shape

| From (current code) | To (this plan) |
|---------------------|----------------|
| `rules.LINKED_TASK_TEMPLATE.subtitle` | `rules.subtitle` |
| `rules.LINKED_TASK_TEMPLATE.workflowStage` | `rules.workflowStage` |
| `rules.LINKED_TASK_TEMPLATE.ruleBadges` (container) | `rules.ruleBadges` |
| `rules.LINKED_TASK_TEMPLATE.ruleBadges.color` | `rules.color` |
| `rules.LINKED_TASK_TEMPLATE.enable` … `max` | `rules.LINKED_TASK_TEMPLATE` (unchanged key, container only) |

On read, optionally hoist nested children out of `rules.LINKED_*` until stored data is backfilled.

---

## Gap vs current code

| Area | Today | This plan |
|------|-------|-----------|
| `rules` storage | Single attribute ✓ | Single attribute ✓ |
| `LINKED_*` inner keys | Nested inside `rules.LINKED_TASK_TEMPLATE` | Flat at `rules` root |
| `mergeOrgRulesPartial` | Nested path merge under `LINKED_*` | Flat key merge only |
| API response | `fieldValues` + `rules` | Same — no new field |
| `TemplateFieldRuleNode` | Nested type for LINKED children | Not needed — flat `TemplateFieldRule` everywhere |

---

## Implementation checklist (later)

1. `buildRulesFromFieldValues()` — for CARE_PLAN `LINKED_*`: container at `rules[linkingKey]`, inner keys flat at `rules` root
2. Remove nested `buildNestedRulesFromLinkedItem` / `TemplateFieldRuleNode` if present
3. `mergeOrgRulesPartial()` — revert to flat merge only (remove nested `LINKED_*` branch)
4. `mergeRulesAfterFieldValuesChange()` — drop stale flat inner keys when linking arrays empty
5. Repository — no schema change; still store `rules` only
6. `toOrgTemplateRulesResponse()` — no change; returns `rules` as-is
7. Tests — Care plan Template 5 fixture:
   - `rules.LINKED_TASK_TEMPLATE.subtitle` is **undefined**
   - `rules.subtitle`, `rules.workflowStage` exist as flat siblings
   - `rules.LINKED_TASK_TEMPLATE` has only rule flags (`enable`, `min`, `max`, …)
   - `rules.ruleBadges`, `rules.color`, `rules.label` exist as flat siblings

---

## Related docs

- `CARE_PLAN_LINKED_TEMPLATE_RULES_PLAN.md` — prior nested-in-`rules.LINKED_*` approach (superseded by this doc)
- `services-json/care-plan-api-rules.json` — reference rules snapshot (update after implementation)
