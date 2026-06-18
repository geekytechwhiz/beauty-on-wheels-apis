# Console CARE_PLAN payload — backend adaptation plan

**Status:** implemented  
**Goal:** Support the **new console `fieldValues` shape** end-to-end with **no frontend changes**.  
Query params stay **`categoryCode`**, **`conditionCode`**, **`templateType`**, **`country`**, etc.

**Reference create payload:** console CARE_PLAN master (Untitled-1 — `test template`).

---

## Principles

| Rule | Detail |
|------|--------|
| **Store what the UI sends** | `fieldValues` saved **verbatim** on VERSION row (round-trip GET = same JSON keys/shape). |
| **Derive catalog codes in backend** | `categoryCode` / `conditionCode` for meta, GSI, `filterOptions`, derive matching — extracted from UI fields, not required from frontend. |
| **No new query params** | List/derive APIs keep existing param names. |
| **Rules from UI keys** | Rule generation walks **console keys** (`Category`, `LinkedTaskTemplate`, `baselineSections`, …), not legacy `CATEGORY` / `LINKED_*` only. |
| **Name aliases** | Accept `templateName`, `TEMPLATE_NAME`, `TemplateName`, and `fieldValues.TEMPLATE_NAME` / `fieldValues.TemplateName`. |

---

## Console payload shape (what frontend sends)

### Top-level create body

```json
{
  "templateLevel": "MASTER",
  "templateType": "CARE_PLAN",
  "TEMPLATE_NAME": "test template",
  "status": "PUBLISHED",
  "fieldValues": { }
}
```

Also valid at top level: `"TemplateName": "test template"` or `"templateName": "test template"`.

### `fieldValues` — console CARE_PLAN (full example)

```json
{
  "fieldValues": {
    "Category": {
      "labelKey": "Chronic Disease",
      "value": "CHRONIC_DISEASE"
    },
    "Condition": {
      "labelKey": "Hypertension",
      "value": "HYPERTENSION"
    },
    "Country": {
      "labelKey": "India",
      "value": "IN"
    },
    "Language": {
      "labelKey": "English",
      "value": "ENGLISH"
    },
    "Specialty": {
      "labelKey": "Cardiology",
      "value": "CARDIOLOGY"
    },
    "SelectScope": {
      "labelKey": "Private",
      "value": "PRIVATE"
    },
    "DurationType": [
      { "labelKey": "30 Days", "value": "30D" },
      { "labelKey": "90 Days", "value": "90D" },
      { "labelKey": "6 Months", "value": "6M" }
    ],
    "DefaultDurationType": {
      "labelKey": "30 Days",
      "value": "30D"
    },
    "CustomDurationAllowed": true,
    "GoalsEnabled": true,
    "MaxGoalsAllowed": "10",
    "BillingProgramTypes": [
      { "labelKey": "None", "value": "NONE" }
    ],
    "TaskTemplateIntro": "",
    "LinkedTaskTemplate": [],
    "baselineSections": [
      {
        "sectionName": "test baseline",
        "parameters": [
          {
            "parameterName": "test parameter",
            "dataType": { "labelKey": "Multi-Select", "value": "MULTI_SELECT" },
            "mandatory": false,
            "dataSourceTypes": [
              { "labelKey": "Manual", "value": "MANUAL" },
              { "labelKey": "Device", "value": "DEVICE" },
              { "labelKey": "HMS", "value": "HMS" }
            ],
            "allowedValues": "1",
            "minValue": "",
            "maxValue": "",
            "decimalAllowed": false,
            "defaultValue": "test default"
          }
        ]
      }
    ],
    "GoalTemplateIntro": "",
    "LinkedGoalTemplate": {
      "id": "TEST-GOAL-45",
      "title": "TEST goal 45",
      "version": "1",
      "subtitle": "v1 - Diabetes - 1 goals",
      "conditionBadge": {
        "label": "Diabetes",
        "color": "^#B54708",
        "bg": "^#FFF6ED"
      },
      "entriesLabel": "Entries: 1",
      "summaryTags": [{ "label": "Key results: 1" }],
      "detailItems": [
        {
          "id": "goal-1",
          "title": "Drink more Water",
          "description": "drink water to regulate",
          "badge": {
            "label": "Engagement",
            "color": "^#667085",
            "bg": "^#F2F4F7"
          }
        }
      ]
    },
    "MonitoringTemplateIntro": "",
    "LinkedMonitoringTemplate": {
      "id": "OXYGEN",
      "title": "OXY",
      "version": "1.2",
      "description": "Oxygen Reading",
      "subtitle": "v1.2 - HYPERTENSION",
      "conditionBadge": {
        "label": "HYPERTENSION",
        "color": "^#B54708",
        "bg": "^#FFF6ED"
      }
    },
    "ReviewCadence": [
      { "labelKey": "15 Days", "value": "15_DAYS" },
      { "labelKey": "30 Days", "value": "30_DAYS" }
    ],
    "ReviewOwnerType": {
      "labelKey": "CareTeam",
      "value": "CARE_TEAM"
    },
    "ProviderReviewRequired": true,
    "ReviewNotesRequired": true,
    "BillingRuleProfile": {
      "labelKey": "RPM STANDARD (CPT 99453 - 99458)",
      "value": "RPM_STANDARD"
    },
    "IcdCode": [
      { "labelKey": "I10 - Essential Hypertension", "value": "I10" },
      { "labelKey": "E11 - Type 2 Diabetes Mellitus", "value": "E11" },
      { "labelKey": "J44 - COPD", "value": "J44" }
    ],
    "BillingRuntimeAllowed": true
  }
}
```

### Value patterns in console payload

| Pattern | Example | Backend use |
|---------|---------|-------------|
| Select field | `{ "labelKey": "…", "value": "CHRONIC_DISEASE" }` | **Filter/catalog:** use `.value` |
| Multi-select | `[{ "labelKey": "…", "value": "30D" }, …]` | Rules: container + leaf per array item shape |
| Scalar / boolean | `true`, `"10"`, `""` | Leaf rule |
| Linked template **card** | `LinkedGoalTemplate`: single object | Treat as link present (not `null` / not `[]`) |
| Linked template **list** | `LinkedTaskTemplate`: `[]` or array | Container rule; inner rules from first element when non-empty |
| Nested sections | `baselineSections[].parameters[]` | Walk for rule paths |

---

## Catalog codes — how filters work (no frontend change)

List API query params **unchanged**:

```
GET /templates?templateLevel=ORG&categoryCode=CHRONIC_DISEASE&conditionCode=HYPERTENSION
```

Backend **derives** codes from stored `fieldValues` when building meta / `filterOptions`:

| Console `fieldValues` key | Extract for catalog | Example |
|---------------------------|---------------------|---------|
| `Category.value` | `categoryCode` | `CHRONIC_DISEASE` |
| `Condition.value` | `conditionCode` | `HYPERTENSION` |
| `Country.value` | `meta.countries[]` | `IN` |
| `Language.value` | `meta.languages[]` | `ENGLISH` |
| `Specialty.value` | `meta.specialty[]` | `CARDIOLOGY` |
| `SelectScope.value` | `meta.shareScope` | `PRIVATE` |

Legacy keys still supported (backward compatible):

| Legacy key | Maps to |
|------------|---------|
| `fieldValues.CATEGORY` (string) | `categoryCode` |
| `fieldValues.CONDITION` (string) | `conditionCode` |
| `fieldValues.categoryCode` | `categoryCode` |
| `fieldValues.conditionCode` | `conditionCode` |

### `filterOptions` after create

For the example payload above, a **PUBLISHED** master contributes:

```json
{
  "filterOptions": {
    "conditionCode": ["HYPERTENSION", "…existing…"],
    "categoryCode": ["CHRONIC_DISEASE", "…existing…"],
    "templateType": ["CARE_PLAN", "…"],
    "templateName": [{ "key": "TEST-TEMPLATE", "value": "test template" }],
    "country": ["US", "UK", "Australia"]
  }
}
```

`country` in filterOptions stays the **static dropdown list** (unchanged).  
`Category` / `Condition` **values** drive `categoryCode` / `conditionCode` options.

---

## Template name resolution

On **create** and **update**, resolve display name from first non-empty (case-insensitive where noted):

```
body.templateName
body.TEMPLATE_NAME
body.TemplateName
fieldValues.TEMPLATE_NAME
fieldValues.TemplateName
fieldValues.templateName
fieldValues.TASK_NAME          (task templates)
templateMetadata.templateName
```

`templateCode` / `templateId` — if omitted, derive from name: `"test template"` → `TEST-TEMPLATE`.

---

## End-to-end flow (step by step)

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ 1. POST master  │────▶│ 2. List / filter │────▶│ 3. POST derive  │
│    (console FV) │     │    (query codes) │     │    (enable org) │
└────────┬────────┘     └──────────────────┘     └────────┬────────┘
         │                                                  │
         ▼                                                  ▼
┌─────────────────┐                              ┌─────────────────┐
│ rules generated │                              │ 4. GET org rules│
│ meta + GSI set  │                              │ 5. PUT org rules│
└─────────────────┘                              └─────────────────┘
```

### Step 1 — Create master (`POST /templates`)

**Request:** console payload (Untitled-1).

**Backend steps:**

1. Validate body (`fieldValues` = open record).
2. Resolve `templateName` (aliases above).
3. **Persist `fieldValues` verbatim** on VERSION row.
4. **Extract catalog profile** → write `meta.category`, `meta.condition`, countries, languages, specialty, shareScope.
5. **Also write** derived `fieldValues.categoryCode` + `fieldValues.conditionCode` (optional denormalized copy for existing readers) — *or* teach all readers to use extractor (preferred: single extractor utility).
6. If `status: PUBLISHED` → GSI2 catalog row; template appears in `filterOptions`.
7. **Generate `rules`** from console-shaped `fieldValues` (see Rules section). Rules stored on VERSION; **stripped from create response** (unchanged).

**Create response:** `fieldValues` round-trips console shape; no `rules`.

---

### Step 2 — List org-enabled masters (`GET /templates?templateLevel=ORG`)

**Query (unchanged):**

```
templateLevel=ORG
categoryCode=CHRONIC_DISEASE
conditionCode=HYPERTENSION
templateType=CARE_PLAN        (optional)
country=all                   (optional)
organizationId=<orgId>        (optional — single org mode)
```

**Backend steps:**

1. Load all **PUBLISHED** masters from catalog.
2. For each item, `extractCatalogCodes(fieldValues)` → compare to query params (case-insensitive).
3. Build `filterOptions` from **all** published masters (not only filtered page).
4. Return `organizations[]` / `items[]` only when org **enablement** exists.

**Important:** Empty `organizations` after create-only is expected until **derive/enable**.

---

### Step 3 — Enable org copy (`POST /templates/derive`)

**Request (unchanged):**

```json
{
  "organizationMeta": {
    "id": "mlepbaj40dac678b",
    "name": "Acme Health"
  },
  "templateType": "CARE_PLAN",
  "categoryCode": "CHRONIC_DISEASE",
  "conditionCode": "HYPERTENSION",
  "templateId": "TEST-TEMPLATE"
}
```

`templateId` = master id from `filterOptions.templateName[].key`.

**Backend steps:**

1. Resolve published master from catalog.
2. Assert `categoryCode` / `conditionCode` match extracted codes from master `fieldValues`.
3. Create org META + VERSION; copy **verbatim** `fieldValues` + **rules** from master.
4. Upsert enablement with `categoryCode` / `conditionCode` on enablement meta.

**Response:** org + master summary (no full `rules` on derive — unchanged).

---

### Step 4 — Get org rules (`GET /templates/org/{templateId}/{orgId}`)

**Response shape (unchanged top-level):**

```json
{
  "organizationId": "mlepbaj40dac678b",
  "masterTemplateId": "TEST-TEMPLATE",
  "orgTemplateId": "TEST-TEMPLATE-ORG-MLEPBAJ40DAC678B",
  "templateVersionId": "TEST-TEMPLATE-ORG-MLEPBAJ40DAC678B-V01",
  "templateType": "CARE_PLAN",
  "fieldValues": { },
  "rules": { }
}
```

- `fieldValues` = **console shape** (same as create).
- `rules` = generated tree with **LINKED_* separate `rules` map** (see `LINKED_TEMPLATE_RULES_SEPARATE_STRUCTURE_PLAN.md`).

**Example `rules` excerpt** for this payload:

```json
{
  "rules": {
    "Category": {
      "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
      "metadataMode": "Fixed", "min": 1, "max": 1
    },
    "Condition": {
      "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
      "metadataMode": "Fixed", "min": 1, "max": 1
    },
    "LinkedTaskTemplate": {
      "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
      "metadataMode": "Fixed", "min": 0, "max": 20
    },
    "LinkedGoalTemplate": {
      "enable": true, "orgedit": true, "add": true, "defaultedit": true, "delete": true,
      "metadataMode": "Fixed", "min": 0, "max": 20,
      "rules": {
        "id": { "enable": true, "min": 1, "max": 1, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed" },
        "title": { "enable": true, "min": 1, "max": 1, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed" },
        "subtitle": { "enable": true, "min": 1, "max": 1, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed" },
        "conditionBadge": {
          "enable": true, "min": 0, "max": 10, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed",
          "rules": {
            "label": { "enable": true, "min": 1, "max": 1, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed" },
            "color": { "enable": true, "min": 1, "max": 1, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed" },
            "bg": { "enable": true, "min": 1, "max": 1, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed" }
          }
        },
        "detailItems": {
          "enable": true, "min": 0, "max": 10, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed",
          "rules": {
            "id": { "enable": true, "min": 1, "max": 1, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed" },
            "title": { "enable": true, "min": 1, "max": 1, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed" },
            "description": { "enable": true, "min": 1, "max": 1, "orgedit": true, "add": true, "defaultedit": true, "delete": true, "metadataMode": "Fixed" }
          }
        }
      }
    },
    "LinkedMonitoringTemplate": {
      "enable": true, "min": 0, "max": 20,
      "rules": {
        "id": { "enable": true, "min": 1, "max": 1, "metadataMode": "Fixed", "orgedit": true, "add": true, "defaultedit": true, "delete": true },
        "title": { "enable": true, "min": 1, "max": 1, "metadataMode": "Fixed", "orgedit": true, "add": true, "defaultedit": true, "delete": true }
      }
    },
    "baselineSections": {
      "enable": true, "min": 0, "max": 10,
      "rules": {
        "sectionName": { "enable": true, "min": 1, "max": 1, "metadataMode": "Fixed", "orgedit": true, "add": true, "defaultedit": true, "delete": true },
        "parameters": { "enable": true, "min": 0, "max": 20, "metadataMode": "Fixed", "orgedit": true, "add": true, "defaultedit": true, "delete": true }
      }
    }
  }
}
```

---

### Step 5 — Update org rules (`PUT /templates/org/{templateId}/{orgId}`)

**Partial patch (unchanged pattern):**

```json
{
  "rules": {
    "LinkedGoalTemplate": {
      "max": 5,
      "rules": {
        "title": { "orgedit": false }
      }
    },
    "Condition": { "orgedit": false }
  }
}
```

Optional `fieldValues` patch merges into stored console shape; rules regenerated/merged per existing org-rules logic.

---

## New utility module (single source of truth)

**File:** `libs/template-core/src/lib/utils/field-values-profile.utils.ts`

### `extractLabelValue(raw): string | undefined`

```typescript
// { labelKey, value } → value
// plain string → string
// null/undefined → undefined
```

### `extractCatalogCodes(fieldValues)`

```typescript
{
  categoryCode: extractLabelValue(fv.Category) ?? fv.CATEGORY ?? fv.categoryCode,
  conditionCode: extractLabelValue(fv.Condition) ?? fv.CONDITION ?? fv.conditionCode,
  country: extractLabelValue(fv.Country) ?? fv.COUNTRY,
  language: extractLabelValue(fv.Language) ?? fv.LANGUAGE,
  specialty: extractLabelValue(fv.Specialty) ?? fv.SPECIALITY,
  shareScope: extractLabelValue(fv.SelectScope) ?? fv.SELECT_SCOPE,
}
```

### `resolveTemplateDisplayName(body, fieldValues)`

All name aliases (see above).

### `isLinkedTemplateFieldKey(key)` — extend

Recognize console keys:

| Console key | Legacy equivalent | Rules container |
|-------------|-------------------|-----------------|
| `LinkedTaskTemplate` | `LINKED_TASK_TEMPLATE` | yes |
| `LinkedGoalTemplate` | `LINKED_GOAL_TEMPLATE` | yes |
| `LinkedMonitoringTemplate` | `LINKED_MONITORING_TEMPLATE` | yes |

### `normalizeLinkValueForRules(value)`

| Stored value | Rules walk input |
|--------------|------------------|
| `null` / `[]` | container only |
| `[{ … }]` | first array element |
| `{ id, title, … }` (single card) | wrap as one item object |
| `""` / missing | omit inner rules |

---

## Rules generation updates

**Entry:** `buildRulesFromFieldValues(fieldValues, { templateType })`

For `CARE_PLAN`:

1. Walk **actual keys** in `fieldValues` (console PascalCase).
2. **Linked* keys** → separate container + nested `rules` map (`LINKED_TEMPLATE_RULES_SEPARATE_STRUCTURE_PLAN.md`).
3. **`{ labelKey, value }`** → leaf rule on that key name (`Category`, `Condition`, …).
4. **Arrays of `{ labelKey, value }`** → container (`min: 0`, `max: n`) — no inner rules unless array items are objects with more keys.
5. **Arrays of objects** (`baselineSections`, `detailItems`, `parameters`) → container + `rules` from **first element** (same as today).
6. Skip generating duplicate rules for derived `categoryCode` / `conditionCode` if also present as sibling keys.

---

## Touch points (implementation checklist)

| # | Area | Change |
|---|------|--------|
| 1 | `field-values-profile.utils.ts` | **New** — extractors + name resolver + link normalizer |
| 2 | `request.validators.ts` | Use name resolver; call catalog extractor on create/update |
| 3 | `template-entity.builder.ts` `buildMeta` | `category` / `condition` from `extractCatalogCodes` |
| 4 | `template-master-ops.service.ts` | Meta overrides from extractor on save |
| 5 | `org-template.service.ts` `masterCodesFromItem` | Use `extractCatalogCodes` |
| 6 | `enablement-entity.builder.ts` | Enablement meta codes from extractor |
| 7 | `template-rules.utils.ts` | Console key walk + `Linked*` + `{labelKey,value}` leaves |
| 8 | `template.constants.ts` | `LINKED_TEMPLATE_CONSOLE_KEYS` map |
| 9 | Tests | Fixture = Untitled-1 payload; assert filter codes + rules shape |
| 10 | Swagger | Document that `categoryCode`/`conditionCode` query params match `Category.value` / `Condition.value` |

**No changes:** frontend, query param names, derive body shape, org rules URL paths, DynamoDB table schema.

---

## Acceptance criteria

1. **Create** with Untitled-1 payload → `fieldValues` stored and returned **unchanged** on GET.
2. **filterOptions** includes `CHRONIC_DISEASE` and `HYPERTENSION` after publish.
3. **List** with `categoryCode=CHRONIC_DISEASE&conditionCode=HYPERTENSION` finds the template.
4. **Derive** succeeds with same `categoryCode` / `conditionCode` / `templateId`.
5. **Org rules GET** returns console `fieldValues` + `rules` with `LinkedGoalTemplate.rules.*` nested structure.
6. **Org rules PUT** partial patch under `rules.LinkedGoalTemplate.rules` works.
7. **Legacy templates** (`CATEGORY` / `LINKED_TASK_TEMPLATE`) still work via extractor fallbacks.

---

## Related docs

- `LINKED_TEMPLATE_RULES_SEPARATE_STRUCTURE_PLAN.md` — `rules` nested under each `Linked*` key
- `TEMPLATE_ORG_FIELD_RULES_PLAN.md` — org GET/PUT rules APIs
- `services-json/care-plan-api-response.json` — legacy UI schema (SCREAMING_SNAKE); console uses PascalCase — both supported via extractor
