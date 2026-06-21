# LINKED_* template rules — separate `rules` object inside each `LINKED_*`

**Status:** design only (no code yet)  
**Reference response:** org rules GET for `CARE-PLAN-TEMPLATE-5` (Care plan Template 5)

---

## Goal

Keep **one top-level `rules` object** — same API flow and DynamoDB storage as today.  
For CARE_PLAN, each `LINKED_*` key is a **separate entry** at `rules` root.  
Inside every `LINKED_*` (and every array container), **container flags** and **child field rules** are split:

| Layer on the node | Keys |
|-------------------|------|
| **Container** (this `LINKED_*` or array) | `enable`, `orgedit`, `add`, `defaultedit`, `delete`, `metadataMode`, `min`, `max` |
| **Children** (fields from `fieldValues` item) | nested **`rules`** object → `id`, `description`, `subtitle`, … |

```
rules
├── CATEGORY, CONDITION, …                  → flat leaf (unchanged)
├── LINKED_TASK_TEMPLATE                    → container flags + rules { id, description, … }
├── LINKED_GOAL_TEMPLATE                    → container flags only (when null)
└── LINKED_MONITORING_TEMPLATE              → container flags only (when null)
```

**Not** mixed on one level — inner keys like `id` and `description` do **not** sit beside `enable` / `min` / `max` on the same object. They live under **`rules`**.

**No** separate top-level `linkedTemplateRules` API field. **No** new DynamoDB attribute.  
`fieldValues` shape is **unchanged**.

---

## Rejected shapes

### ❌ Flat at `rules` root

```
rules.subtitle
rules.workflowStage
rules.color
```

Inner linked fields as siblings of `LINKED_TASK_TEMPLATE` — rejected (collision, no parent context).

### ❌ Mixed container + children on same object

```json
"LINKED_TASK_TEMPLATE": {
  "enable": true,
  "min": 0,
  "max": 20,
  "id": { "enable": true, "min": 1, "max": 1 },
  "description": { "enable": true, "min": 1, "max": 1 }
}
```

`id` and `description` beside `enable` / `min` — rejected. Use nested **`rules`** instead.

---

## Proposed shape — `rules` inside each `LINKED_*`

### Node pattern (every container)

```json
{
  "enable": true,
  "orgedit": true,
  "add": true,
  "defaultedit": true,
  "delete": true,
  "metadataMode": "Fixed",
  "min": 0,
  "max": 20,
  "rules": {
    "<childKey>": { }
  }
}
```

- Top-level `LINKED_*` in `fieldValues` → one separate node at `rules.LINKED_*`.
- Keys inside `fieldValues.LINKED_*[0]` → entries in `rules.LINKED_*.rules`.
- Array of objects (`ruleBadges`) → container node with its own `rules` for `color`, `bg`, `label`.
- Nested `LINKED_*` inside an item → separate container node inside parent’s `rules`, with its own `rules` children.

When `fieldValues.LINKED_*` is `null` or `[]`, emit **container flags only** — omit `rules` (or use empty `{}`).

---

## Full example 1 — Care plan Template 5

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

### `rules` — target shape

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
      "rules": {
        "id": {
          "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
          "metadataMode": "Fixed", "min": 1, "max": 1
        },
        "description": {
          "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
          "metadataMode": "Fixed", "min": 1, "max": 1
        },
        "subtitle": {
          "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
          "metadataMode": "Fixed", "min": 1, "max": 1
        },
        "workflowStage": {
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
        "requiredForStageCompletion": {
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
        },
        "ruleBadges": {
          "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
          "metadataMode": "Fixed", "min": 0, "max": 10,
          "rules": {
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
          }
        }
      }
    },

    "LINKED_GOAL_TEMPLATE": {
      "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
      "metadataMode": "Fixed", "min": 0, "max": 20
    },
    "LINKED_MONITORING_TEMPLATE": {
      "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
      "metadataMode": "Fixed", "min": 0, "max": 20
    }
  }
}
```

### Mirror diagram

```
fieldValues.LINKED_TASK_TEMPLATE[0]          rules.LINKED_TASK_TEMPLATE
│ (container — separate at rules root)         ├── enable, orgedit, min: 0, max: 20
│                                              └── rules
├── id                                  →          ├── id: { leaf rule }
├── description                         →          ├── description: { leaf rule }
├── subtitle                            →          ├── subtitle: { leaf rule }
├── workflowStage                       →          ├── workflowStage: { leaf rule }
└── ruleBadges[0]                       →          └── ruleBadges: { container, rules: { color, bg, label } }
    ├── color                           →              └── color: { leaf rule }
    ├── bg                              →              └── bg: { leaf rule }
    └── label                           →              └── label: { leaf rule }
```

### Assertions

| Path | Expected |
|------|----------|
| `rules.LINKED_TASK_TEMPLATE.min` | `0` |
| `rules.LINKED_TASK_TEMPLATE.rules.id` | leaf rule object |
| `rules.LINKED_TASK_TEMPLATE.rules.description` | leaf rule object |
| `rules.LINKED_TASK_TEMPLATE.rules.ruleBadges.rules.color` | leaf rule object |
| `rules.LINKED_TASK_TEMPLATE.id` | **undefined** (not mixed on container) |
| `rules.id` | **undefined** (not at root) |
| `rules.subtitle` | **undefined** (not at root) |

---

## Full example 2 — three separate top-level `LINKED_*` keys

Each `LINKED_*` from `fieldValues` is its **own** entry under `rules` — never merged into one object.

### `fieldValues`

```json
{
  "fieldValues": {
    "LINKED_TASK_TEMPLATE": [
      { "id": "tasks-htn-care", "title": "HTN Care Tasks", "description": "Task pack" }
    ],
    "LINKED_GOAL_TEMPLATE": [
      { "id": "goal-htn-bp", "title": "BP goal", "description": "Target BP" }
    ],
    "LINKED_MONITORING_TEMPLATE": null,
    "CATEGORY": "CHRONIC_CARE"
  }
}
```

### `rules`

```json
{
  "rules": {
    "CATEGORY": {
      "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
      "metadataMode": "Fixed", "min": 1, "max": 1
    },
    "LINKED_TASK_TEMPLATE": {
      "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
      "metadataMode": "Fixed", "min": 0, "max": 20,
      "rules": {
        "id": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
        "title": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
        "description": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 }
      }
    },
    "LINKED_GOAL_TEMPLATE": {
      "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
      "metadataMode": "Fixed", "min": 0, "max": 20,
      "rules": {
        "id": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
        "title": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 },
        "description": { "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed", "min": 1, "max": 1 }
      }
    },
    "LINKED_MONITORING_TEMPLATE": {
      "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
      "metadataMode": "Fixed", "min": 0, "max": 20
    }
  }
}
```

---

## Full example 3 — nested `LINKED_*` inside a linked item

Inner `LINKED_*` follows the **same** pattern: container flags + `rules` for children, placed inside the parent’s `rules` map.

### `fieldValues`

```json
{
  "fieldValues": {
    "LINKED_TASK_TEMPLATE": [
      {
        "id": "tasks-htn-care",
        "description": "Main task pack",
        "LINKED_GOAL_TEMPLATE": [
          { "id": "goal-htn-bp", "description": "BP target", "targetValue": "130/80" }
        ]
      }
    ],
    "LINKED_GOAL_TEMPLATE": null,
    "CATEGORY": "CHRONIC_CARE"
  }
}
```

### `rules` (excerpt)

```json
{
  "rules": {
    "LINKED_TASK_TEMPLATE": {
      "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
      "metadataMode": "Fixed", "min": 0, "max": 20,
      "rules": {
        "id": {
          "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
          "metadataMode": "Fixed", "min": 1, "max": 1
        },
        "description": {
          "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
          "metadataMode": "Fixed", "min": 1, "max": 1
        },
        "LINKED_GOAL_TEMPLATE": {
          "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
          "metadataMode": "Fixed", "min": 0, "max": 20,
          "rules": {
            "id": {
              "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
              "metadataMode": "Fixed", "min": 1, "max": 1
            },
            "description": {
              "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
              "metadataMode": "Fixed", "min": 1, "max": 1
            },
            "targetValue": {
              "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
              "metadataMode": "Fixed", "min": 1, "max": 1
            }
          }
        }
      }
    },
    "LINKED_GOAL_TEMPLATE": {
      "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
      "metadataMode": "Fixed", "min": 0, "max": 20
    }
  }
}
```

Top-level `rules.LINKED_GOAL_TEMPLATE` = container only (`fieldValues` value is `null`).  
Nested `rules.LINKED_TASK_TEMPLATE.rules.LINKED_GOAL_TEMPLATE` = from the **item** JSON.

---

## Rule generation flow (`buildRulesFromFieldValues`)

```
buildRulesFromFieldValues(fieldValues, { templateType })
│
├─ For each non-LINKED key in fieldValues
│    → rules[key] = flat leaf rule (existing algorithm)
│
└─ When templateType === 'CARE_PLAN'
     For each top-level key where key.startsWith('LINKED_')
     │
     ├─ rules[linkingKey] = linked container rule (min: 0, max: 20)
     │
     └─ If value is non-empty array of objects
          rules[linkingKey].rules = buildLinkedItemRulesMap(value[0])
```

### `buildLinkedItemRulesMap(item)` — builds the inner `rules` object

```
for each [key, value] in item:
│
├─ key.startsWith('LINKED_') and isArrayOfObjects(value)
│    → rulesMap[key] = { ...linkedContainerRule(), rules: buildLinkedItemRulesMap(value[0]) }
│
├─ key.startsWith('LINKED_') and (null | [])
│    → rulesMap[key] = linkedContainerRule() only (no rules)
│
├─ Array of objects (e.g. ruleBadges)
│    → rulesMap[key] = { ...arrayContainerRule(min: 0, max: 10), rules: buildLinkedItemRulesMap(value[0]) }
│
├─ Plain object (not array)
│    → rulesMap[key] = { ...defaultContainerRule(), rules: buildLinkedItemRulesMap(value) }
│
└─ Scalar / boolean
     → rulesMap[key] = defaultLeafRule(min: 1, max: 1)
```

### Container `min` / `max`

| Node type | `min` | `max` |
|-----------|------:|------:|
| Top-level / nested `LINKED_*` | `0` | `20` |
| Array of objects (`ruleBadges`, …) | `0` | `10` |
| Scalar / boolean leaf | `1` | `1` |

### Stale key cleanup

On `fieldValues` update, **replace each top-level `LINKED_*` node** (container + entire `rules` subtree).  
Drop `rules` when linking array becomes `null` or `[]`.

---

## API contract

| API | `fieldValues` | `rules` |
|-----|---------------|---------|
| `POST /templates` (master create) | Yes | No (stripped) |
| `GET /templates` (master list) | Yes | No |
| `GET /templates/org/{templateId}/{orgId}` | Yes | Yes |
| `PUT /templates/org/{templateId}/{orgId}` | Yes | Partial patch |

### Org rules PUT examples

Patch container on `LINKED_TASK_TEMPLATE`:

```json
{
  "rules": {
    "LINKED_TASK_TEMPLATE": { "max": 5 }
  }
}
```

Patch inner `id` / `description` (under `rules`):

```json
{
  "rules": {
    "LINKED_TASK_TEMPLATE": {
      "rules": {
        "id": { "orgedit": false },
        "description": { "orgedit": false }
      }
    }
  }
}
```

Patch `ruleBadges` leaf:

```json
{
  "rules": {
    "LINKED_TASK_TEMPLATE": {
      "rules": {
        "ruleBadges": {
          "rules": {
            "label": { "orgedit": false }
          }
        }
      }
    }
  }
}
```

Patch nested inner `LINKED_GOAL_TEMPLATE`:

```json
{
  "rules": {
    "LINKED_TASK_TEMPLATE": {
      "rules": {
        "LINKED_GOAL_TEMPLATE": {
          "max": 3,
          "rules": {
            "description": { "orgedit": false }
          }
        }
      }
    }
  }
}
```

`mergeOrgRulesPartial` must deep-merge through **`rules`** paths under each `LINKED_*` key.

---

## Storage (DynamoDB) — unchanged

Single `rules` attribute on the VERSION row.

| Attribute | Content |
|-----------|---------|
| `rules` | Flat normal fields + separate `LINKED_*` nodes (each with optional nested `rules`) |

---

## TypeScript sketch

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

/** Leaf rule — no nested rules */
export type TemplateFieldRuleLeaf = TemplateFieldRule;

/** Container: rule flags + child field rules in separate rules map */
export interface TemplateFieldRuleContainer extends TemplateFieldRule {
  rules?: Record<string, TemplateFieldRuleNode>;
}

export type TemplateFieldRuleNode = TemplateFieldRuleLeaf | TemplateFieldRuleContainer;

export type TemplateRulesMap = Record<string, TemplateFieldRuleNode>;
```

```typescript
function buildLinkedItemRulesMap(
  item: Record<string, unknown>,
): Record<string, TemplateFieldRuleNode> {
  const rulesMap: Record<string, TemplateFieldRuleNode> = {};

  for (const [key, value] of Object.entries(item)) {
    if (isLinkedTemplateFieldKey(key)) {
      const container = linkedTemplateContainerRule();
      if (Array.isArray(value) && value[0] && typeof value[0] === 'object') {
        rulesMap[key] = {
          ...container,
          rules: buildLinkedItemRulesMap(value[0] as Record<string, unknown>),
        };
      } else {
        rulesMap[key] = container;
      }
      continue;
    }

    if (Array.isArray(value) && value[0] && typeof value[0] === 'object') {
      rulesMap[key] = {
        ...linkedArrayContainerRule(),
        rules: buildLinkedItemRulesMap(value[0] as Record<string, unknown>),
      };
      continue;
    }

    if (value !== null && typeof value === 'object') {
      rulesMap[key] = {
        ...defaultContainerRule(),
        rules: buildLinkedItemRulesMap(value as Record<string, unknown>),
      };
      continue;
    }

    rulesMap[key] = defaultLeafRule();
  }

  return rulesMap;
}
```

---

## Gap vs other approaches

| Area | Flat at root | Mixed on container | **This plan** |
|------|--------------|-------------------|---------------|
| `LINKED_*` at `rules` root | N/A | One per key ✓ | One per key ✓ |
| `id`, `description` location | `rules.id` | `rules.LINKED_*.id` | `rules.LINKED_*.rules.id` |
| Container vs children | Mixed | Mixed | **Separated** via `rules` |
| `ruleBadges.color` | `rules.color` | `rules.LINKED_*.ruleBadges.color` | `rules.LINKED_*.rules.ruleBadges.rules.color` |

---

## Implementation checklist (later)

1. `buildRulesFromFieldValues()` — CARE_PLAN: each top-level `LINKED_*` → container + `.rules = buildLinkedItemRulesMap(firstElement)`
2. `buildLinkedItemRulesMap()` — recursive; same `rules` wrapper for arrays and inner `LINKED_*`
3. `mergeOrgRulesPartial()` — deep-merge through `.rules` under `LINKED_*`
4. `mergeRulesAfterFieldValuesChange()` — replace full `LINKED_*` subtree; clear `.rules` when array empty
5. Tests — Template 5:
   - `rules.LINKED_TASK_TEMPLATE.rules.id` exists
   - `rules.LINKED_TASK_TEMPLATE.rules.description` exists
   - `rules.LINKED_TASK_TEMPLATE.id` is **undefined**
   - `rules.id` / `rules.description` are **undefined**
   - `rules.LINKED_TASK_TEMPLATE.rules.ruleBadges.rules.color` exists
6. Tests — three separate top-level `LINKED_*` (example 2)
7. Tests — nested inner `LINKED_*` (example 3)

---

## Related docs

- `CARE_PLAN_LINKED_TEMPLATE_RULES_PLAN.md` — prior nested-without-`rules`-wrapper approach (differs on inner shape)
- `services-json/care-plan-api-rules.json` — update after implementation to match this structure
