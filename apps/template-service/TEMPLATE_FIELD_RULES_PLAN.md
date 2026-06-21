# Template field rules — plan

Store org-manageability **rules** in DynamoDB when creating/updating a master template.  
**API request and response stay the same** — clients never send or receive `rules`.

---

## What we store

On the VERSION row (next to `fieldValues`):

```json
{
  "pk": "MASTER_TMPL#CARE-PLAN-7",
  "sk": "VERSION#001",
  "meta": { ... },
  "fieldValues": { ... },
  "rules": { ... }
}
```

`rules` is **not** returned on `POST /templates`, `GET /templates`, or list APIs.

---

## Core idea — only `fieldValues`, nothing else

When **`POST /templates`** (create master) runs:

1. Read **`fieldValues`** from the request (plus `TEMPLATE_NAME` from body root if merged by validator).
2. Walk **`fieldValues` only** — no `*-api-response.json`, no `*-api-rules.json`, no hardcoded field lists.
3. For each field path found, **generate** one flat rule with all booleans `true`.
4. Save `rules` on the VERSION row.

| Source | Used at runtime? |
|--------|------------------|
| Request `fieldValues` | **Yes — only source** |
| `*-api-response.json` | **No** |
| `*-api-rules.json` | **No** |

---

## Default rule object (every field)

Every generated rule has **eight** keys — five booleans plus cardinality/metadata:

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

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `enable` | boolean | `true` | Field visible / usable |
| `orgedit` | boolean | `true` | Org may edit values |
| `add` | boolean | `true` | Org may add instances |
| `defaultedit` | boolean | `true` | Org may edit defaults |
| `delete` | boolean | `true` | Org may remove instances |
| `metadataMode` | string | `"Fixed"` | How org manages metadata for this path (see below) |
| `min` | number | `1` | Minimum instances (0 = optional) |
| `max` | number | `1` | Maximum instances |

### `metadataMode` values

| Value | Meaning |
|-------|---------|
| `"Fixed"` | Default — org follows master-defined metadata constraints |
| *(future)* | Additional modes (e.g. variable catalog) may be added later |

At create time, **every** path from the `fieldValues` walk gets the full default object above (`metadataMode: "Fixed"`, `min: 1`, `max: 1`). Generation does **not** read `*-api-rules.json`; orgs customize `min` / `max` / `metadataMode` later via org rules PUT (Phase 2).

---

## Rules shape — always flat (single level)

One field name → one rule object. No nesting inside `rules`.

```json
{
  "rules": {
    "CATEGORY": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "goalName": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "measurements": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "appliesToType": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 }
  }
}
```

---

## How paths are collected — walk `fieldValues` only

### Simple values (string, number, boolean, null)

Key in `fieldValues` → one rule with that key name.

```
"CATEGORY": "CHRONIC_CARE"     →  rules.CATEGORY
"CUSTOM_DURATION_ALLOWED": true →  rules.CUSTOM_DURATION_ALLOWED
```

### Objects (not arrays)

Each **child key** becomes a flat rule path. The parent object key itself also gets a rule if it is a direct `fieldValues` key.

```
"WORK_STRESS_LEVEL": { "item1": null, "item2": null }
  →  rules.WORK_STRESS_LEVEL
  →  rules.item1
  →  rules.item2
```

### Arrays of objects (e.g. `GOALS`, `THRESHOLD_BANDS`, `LINKED_TASK_TEMPLATE`)

1. **Skip** the parent array key — no `GOALS`, no `THRESHOLD_BANDS` rule.
2. Look at the **first element** shape (structure only, values ignored).
3. Each key in that object → flat rule path.
4. If a key is a **nested array of objects** (e.g. `measurements`), add a rule for that key (`measurements`) plus flat rules for keys inside the first nested item.

```
"GOALS": [
  {
    "goalName": "Reduce BP",
    "goalType": "CLINICAL",
    "measurements": [
      { "appliesToType": "METRICS", "linkedEntityCode": "BP_SYS" }
    ]
  }
]

→  goalName, goalType, measurements, appliesToType, linkedEntityCode
    (NOT GOALS)
```

```
"THRESHOLD_BANDS": [
  {
    "alertRequired": true,
    "evaluationType": "ROLLING_AVERAGE",
    "comparisonOperator": "LESS_THAN",
    "thresholdValue": "120",
    "severityLevel": "CRITICAL"
  }
]

→  alertRequired, evaluationType, comparisonOperator, thresholdValue, severityLevel, ...
    (NOT THRESHOLD_BANDS)
```

### Arrays of primitives or empty arrays

Treat like a simple field — one rule for the array key.

```
"REVIEW_CADENCE": ["15_DAYS"]  →  rules.REVIEW_CADENCE
"LINKED_GOAL_TEMPLATE": null    →  rules.LINKED_GOAL_TEMPLATE
```

---

## Walk algorithm (pseudocode)

```
function collectRulePaths(fieldValues):
  paths = set()

  for each key, value in fieldValues:
    if value is array and value[0] is object:
      expandObjectKeys(value[0], paths)   // skip parent key
    else if value is object and not array:
      paths.add(key)
      for each childKey in value:
        paths.add(childKey)
    else:
      paths.add(key)

  return paths

function expandObjectKeys(obj, paths):
  for each key, value in obj:
    if value is array and value[0] is object:
      paths.add(key)                      // e.g. measurements
      expandObjectKeys(value[0], paths)   // e.g. appliesToType
    else if value is object and not array:
      paths.add(key)
      expandObjectKeys(value, paths)
    else:
      paths.add(key)
```

For each path → `generateDefaultRule()` = full eight-key object (booleans all `true`, `metadataMode: "Fixed"`, `min: 1`, `max: 1`).

---

## Example 1 — CARE_PLAN create

### Request

```json
{
  "templateType": "CARE_PLAN",
  "TEMPLATE_NAME": "Care plan Template 4",
  "fieldValues": {
    "CATEGORY": "CHRONIC_CARE",
    "CONDITION": "HYPERTENSION",
    "DURATION_TYPES": ["15_DAYS", "60_DAYS"],
    "RPM_DEVICES": { "primary": { "devices": [] }, "secondary": { "devices": [] } },
    "LINKED_TASK_TEMPLATE": [ { "id": "tasks-htn-care", "workflowStage": "ONBOARDING" } ],
    "WORK_STRESS_LEVEL": { "item1": null, "item2": null },
    "REVIEW_CADENCE": ["15_DAYS"]
  }
}
```

### Generated `rules` (stored in DynamoDB)

```json
{
  "rules": {
    "TEMPLATE_NAME": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "CATEGORY": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "CONDITION": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "DURATION_TYPES": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "RPM_DEVICES": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "primary": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "secondary": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "id": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "workflowStage": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "WORK_STRESS_LEVEL": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "item1": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "item2": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
    "REVIEW_CADENCE": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 }
  }
}
```

*(No `LINKED_TASK_TEMPLATE` rule — array of objects → inner keys only.)*

### API response

Unchanged — **no `rules`**.

---

## Example 2 — GOAL with `GOALS`

### Request `fieldValues`

```json
{
  "CATEGORY": "CHRONIC_CARE",
  "GOALS": [
    {
      "goalName": "Reduce BP",
      "goalType": "CLINICAL",
      "measurements": [
        { "appliesToType": "METRICS", "linkedEntityCode": "BP_SYS" }
      ]
    }
  ]
}
```

### Generated `rules`

```json
{
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

All paths come from walking `fieldValues.GOALS[0]` and `fieldValues.GOALS[0].measurements[0]`. No external files.

---

## Example 3 — THRESHOLD with `THRESHOLD_BANDS`

### Request `fieldValues`

```json
{
  "APPLIES_TO_TYPE": "METRIC",
  "THRESHOLD_BANDS": [
    {
      "alertRequired": true,
      "evaluationType": "ROLLING_AVERAGE",
      "comparisonOperator": "LESS_THAN",
      "thresholdValue": "120",
      "severityLevel": "CRITICAL"
    }
  ]
}
```

### Generated `rules`

```json
{
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

---

## Create vs update

| Action | Rules behaviour |
|--------|-----------------|
| **POST /templates** (create) | Walk `fieldValues` → generate flat `rules` with full default object (booleans `true`, `metadataMode: "Fixed"`, `min: 1`, `max: 1`). |
| **POST /templates/{id}** with new `fieldValues` keys | Walk merged `fieldValues` → add rules for **new paths only** (full default object). Never overwrite or remove existing paths. |
| **POST /templates/{id}** with `{ "active": true }` only | `fieldValues` unchanged → `rules` unchanged. |

---

## Implementation (short)

1. **`collectRulePathsFromFieldValues(fieldValues)`** — recursive walk, returns flat path set.
2. **`generateDefaultRule()`** — returns full rule: booleans all `true`, `metadataMode: "Fixed"`, `min: 1`, `max: 1`.
3. **`buildRulesFromFieldValues(fieldValues)`** — map paths → rules.
4. **Create** — attach `rules` to VERSION row.
5. **Update** — merge new paths into existing `rules` (additive only).
6. **`toMasterFullRecord`** — strip `rules` before HTTP response.

Single file in `libs/template-core`:

- `utils/template-rules.utils.ts`

No JSON file loading. No `templateType` needed for rule generation (only `fieldValues` shape matters).
