# Org-derived templates — API plan

**Status:** phase 1 + phase 2 implemented  
**Depends on:** `CONSOLE_CARE_PLAN_PAYLOAD_BACKEND_PLAN.md`, `LINKED_TEMPLATE_RULES_SEPARATE_STRUCTURE_PLAN.md`, `Template_Hierarchy_and_Structure_Change_Addendum.md` (ChangeSet / adopt)

---

## Summary

Org templates exist at **two levels**:

| Level | How it is created | `orgTemplateId` pattern | Managed by |
|-------|-------------------|-------------------------|------------|
| **Canonical org template** | `POST /templates/derive` (master → org) | `{masterTemplateId}-ORG-{orgSlug}` | **Existing** derive + org rules APIs |
| **Org-derived variant** | `POST /templates/org-derived` (canonical → variant) | `{slug(newTemplateName)}-{shortUuid}` | **New** org-derived APIs (this plan) |

**Rule:** You never copy from master directly for variants. Always:

1. Run **derive** once per org + master → canonical org template.
2. Optionally edit the canonical copy via existing org rules APIs.
3. **Copy from that canonical org template** to create one or more named variants.

The existing derive flow is **unchanged**. This plan adds **2 write routes** under `/templates/org-derived` and reuses **GET `/templates`** with `templateLevel=ORG_DERIVED` for listing.

---

## End-to-end flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE A — EXISTING (unchanged)                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Master template (platform)                                             │
│       │                                                                 │
│       │  POST /templates/derive                                         │
│       ▼                                                                 │
│  Canonical org template                                                 │
│       orgTemplateId: TEST-TEMPLATE-ORG-ROSEWOOD                         │
│       │                                                                 │
│       ├── GET  /templates/org/{masterTemplateId}/{orgId}   (rules GET)  │
│       ├── PUT  /templates/org/{masterTemplateId}/{orgId}   (rules PUT)  │
│       └── PUT  /templates/derive              (enable/disable canonical)│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ sourceOrgTemplateId = canonical orgTemplateId
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE B — NEW (this plan)                                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  POST /templates/org-derived                                            │
│       ▼                                                                 │
│  Org-derived variant(s)                                                 │
│       orgTemplateId: HTN-VARIANT-A-a1b2c3d4                             │
│       derivationKind: orgDerive                                         │
│       │                                                                 │
│       ├── GET  /templates?templateLevel=ORG_DERIVED&organizationId=…  (list + history)
│       ├── GET  /templates?…&orgTemplateId=…          (single + adopt preview)
│       ├── PUT  /templates/org-derived/{orgTemplateId}
│       └── POST /templates/org-derived/{orgTemplateId}/adopt   (phase 2)
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Numbered console sequence

| Step | API | Purpose |
|------|-----|---------|
| **0** | `POST /templates` (master) | Publish master CARE_PLAN (existing) |
| **1** | `POST /templates/derive` | Create **canonical** org copy + enablement |
| **1b** *(optional)* | `GET/PUT /templates/org/{masterTemplateId}/{orgId}` | Tune canonical `fieldValues` / `rules` before branching |
| **2** | `POST /templates/org-derived` | Copy canonical → **variant** + enable |
| **3** | `GET /templates?templateLevel=ORG_DERIVED&organizationId=…` | **List** variants — each item includes `history` + `upgrade` |
| **3b** | `GET /templates?templateLevel=ORG_DERIVED&…&orgTemplateId=…` | **Get one** — full `fieldValues` + `rules` + `adopt` preview when `upgrade: true` |
| **4** | `PUT /templates/org-derived/{orgTemplateId}` | Patch variant rules / fieldValues / status / active / enable |
| **5** | `POST /templates/org-derived/{orgTemplateId}/adopt` | Apply canonical upgrade to variant (phase 2 — after user confirms modal) |

---

## Where `sourceOrgTemplateId` comes from

After **Step 1** (`POST /templates/derive`), use the canonical id from the response:

```json
{
  "data": {
    "orgTemplate": {
      "templateId": "TEST-TEMPLATE-ORG-ROSEWOOD"
    }
  }
}
```

Or from **GET** `/templates/org/{masterTemplateId}/{orgId}`:

```json
{
  "data": {
    "orgTemplateId": "TEST-TEMPLATE-ORG-ROSEWOOD",
    "templateVersionId": "TEST-TEMPLATE-ORG-ROSEWOOD-V01"
  }
}
```

That value is **`sourceOrgTemplateId`** in `POST /templates/org-derived`.

> **Phase 1:** `sourceOrgTemplateId` must be the **canonical** org template from derive (no `derivationKind: orgDerive`). Copying org-derived → org-derived is out of scope unless added later.

---

## Existing APIs (unchanged)

| Method | Path | Role in flow |
|--------|------|--------------|
| `POST` | `/templates/derive` | Master → canonical org template + enablement |
| `PUT` | `/templates/derive` | Enable/disable **canonical** subscription by master `templateId` |
| `GET` | `/templates/org/{masterTemplateId}/{orgId}` | Read canonical `fieldValues` + `rules` |
| `PUT` | `/templates/org/{masterTemplateId}/{orgId}` | Update canonical rules (version bump) |
| `GET` | `/templates?templateLevel=ORG` | Org enable catalog — **canonical copies only** (variants excluded) |

Do **not** route variant list/edit through the canonical org rules URLs. Variants use `templateLevel=ORG_DERIVED` for list and `/templates/org-derived` for write.

---

## New APIs (2 write + 2 read modes + 1 adopt)

| # | Method | Path | Does |
|---|--------|------|------|
| 1a | **GET** | `/templates?templateLevel=ORG_DERIVED&organizationId=…` | **List** variants — `history` + `upgrade` per item |
| 1b | **GET** | `/templates?templateLevel=ORG_DERIVED&organizationId=…&orgTemplateId=…` | **Get one** — `fieldValues`, `rules`, `adopt` preview |
| 2 | **POST** | `/templates/org-derived` | Copy canonical → variant |
| 3 | **PUT** | `/templates/org-derived/{orgTemplateId}` | Update variant |
| 4 | **POST** | `/templates/org-derived/{orgTemplateId}/adopt` | Confirm adopt (phase 2) |

### `templateLevel` values on GET `/templates`

| Value | Returns |
|-------|---------|
| `MASTER` (default) | Published master catalog |
| `ORG` | Canonical org enablement catalog (excludes `derivationKind: orgDerive`) |
| `ORG_DERIVED` | Org-derived variants only (`derivationKind === orgDerive`) |

---

## API 1a — GET list variants

### `GET /templates?templateLevel=ORG_DERIVED` (no `orgTemplateId`)

Returns **variants only** (`derivationKind === orgDerive`). Same query filters as `templateLevel=ORG` where applicable.

Each list item includes:

| Field | Purpose |
|-------|---------|
| `upgrade` | `true` when canonical org version > variant snapshot |
| `history` | Version timeline for **this variant** (same shape as master list) |

`history` is **not** included on the single-item GET (use list or a dedicated versions API if full timeline needed elsewhere). List mode loads VERSION rows / `versionHistory` per variant the same way `GET /templates?templateLevel=MASTER` does for masters.

#### Query parameters

| Param | Required | Notes |
|-------|----------|-------|
| `templateLevel` | **Yes** | Must be `ORG_DERIVED` |
| `organizationId` | **Yes** | Org scope |
| `orgTemplateId` | **No** | Omit for **list**; set for **single** (API 1b) |
| `categoryCode` | No | Filter (`category` alias OK) |
| `conditionCode` | No | Filter (`condition` alias OK) |
| `specialty` | No | Filter |
| `templateType` | No | e.g. `CARE_PLAN` |
| `templateName` | No | Substring |
| `templateEnabled` | No | `true` / `false` |
| `country` | No | Pass-through (e.g. `all`) |
| `nextPaginationKey` | No | Pagination (list mode only) |

#### List request

```http
GET /templates?templateLevel=ORG_DERIVED&organizationId=mqf0agcd0aa65849&categoryCode=CHRONIC_DISEASE&conditionCode=HYPERTENSION&country=all
```

#### List response (full example)

```json
{
  "success": true,
  "data": {
    "organizationMeta": {
      "id": "mqf0agcd0aa65849",
      "name": "Rosewood"
    },
    "items": [
      {
        "orgTemplateId": "HTN-CARE-PLAN-VARIANT-A-546d8483",
        "templateName": "HTN Care Plan — Variant A",
        "templateType": "CARE_PLAN",
        "masterTemplateId": "HTN-CARE-PLAN-MASTER",
        "categoryCode": "CHRONIC_DISEASE",
        "conditionCode": "HYPERTENSION",
        "version": 1.1,
        "templateVersionId": "HTN-CARE-PLAN-VARIANT-A-546d8483-V01",
        "derivedFromOrgTemplateId": "ROSEWOOD-ORG-MQF0AGCD0AA65849",
        "derivedFromOrgTemplateVersion": 1,
        "derivedFromOrgTemplateVersionId": "ROSEWOOD-ORG-MQF0AGCD0AA65849-V01",
        "status": "DRAFT",
        "active": true,
        "templateEnabled": true,
        "upgrade": true,
        "lastModifiedAt": "2026-06-23T10:15:00.000Z",
        "history": [
          {
            "version": 1.1,
            "templateVersionId": "HTN-CARE-PLAN-VARIANT-A-546d8483-V01",
            "status": "DRAFT",
            "action": "UPDATED",
            "title": "Template Updated",
            "isActive": true,
            "isLatestVersion": true,
            "updatedAt": "2026-06-23T10:15:00.000Z",
            "updatedBy": {
              "userId": "88a9a6e052092188660a404a303ca34c99ccaafcfcfc184ca2121fcac2d84e7f",
              "email": "rootadmin@yopmail.com",
              "name": "Root Admin"
            },
            "changes": [
              "Category.orgedit: true → false",
              "version: 1 → 1.1"
            ]
          },
          {
            "version": 1,
            "templateVersionId": "HTN-CARE-PLAN-VARIANT-A-546d8483-V01",
            "status": "DRAFT",
            "action": "CREATED",
            "title": "Template Created",
            "isActive": true,
            "isLatestVersion": false,
            "updatedAt": "2026-06-22T08:00:00.000Z",
            "updatedBy": {
              "userId": "88a9a6e052092188660a404a303ca34c99ccaafcfcfc184ca2121fcac2d84e7f",
              "email": "rootadmin@yopmail.com",
              "name": "Root Admin"
            },
            "changes": []
          }
        ]
      }
    ],
    "filterOptions": { "categoryCode": [], "conditionCode": [], "specialty": [] },
    "pagination": { "limit": 20, "count": 1, "total": 1, "hasMore": false }
  }
}
```

#### `history` rules (same as master)

| Source | Behavior |
|--------|----------|
| `versionHistory` on VERSION row | Preferred — appended on each in-place save |
| All VERSION rows for template | Fallback — built timeline newest-first |
| `updatedBy` | From JWT actor on create/update (`lastModifiedBy`) |
| `changes` | Field-level diff strings vs previous history entry (e.g. `Category.orgedit: true → false`) |

---

## API 1b — GET single variant (+ `adopt` preview)

### `GET /templates?templateLevel=ORG_DERIVED&organizationId=…&orgTemplateId=…`

Returns **one** variant with full `fieldValues` + `rules`.

When `upgrade: true`, response also includes an **`adopt`** object — the data for the console modal (“What’s new in HTN Care Plan **v1 → v2**”). When `upgrade: false`, `adopt` is `null`.

#### Single request

```http
GET /templates?templateLevel=ORG_DERIVED&organizationId=mqf0agcd0aa65849&orgTemplateId=HTN-CARE-PLAN-VARIANT-A-546d8483
```

#### Single response (upgrade available — full example)

```json
{
  "success": true,
  "data": {
    "organizationId": "mqf0agcd0aa65849",
    "orgTemplateId": "HTN-CARE-PLAN-VARIANT-A-546d8483",
    "templateName": "HTN Care Plan — Variant A",
    "templateType": "CARE_PLAN",
    "templateVersionId": "HTN-CARE-PLAN-VARIANT-A-546d8483-V01",
    "version": 1,
    "derivedFromOrgTemplateId": "ROSEWOOD-ORG-MQF0AGCD0AA65849",
    "derivedFromOrgTemplateVersion": 1,
    "derivedFromOrgTemplateVersionId": "ROSEWOOD-ORG-MQF0AGCD0AA65849-V01",
    "status": "DRAFT",
    "active": true,
    "templateEnabled": true,
    "upgrade": true,
    "fieldValues": { "Category": { "value": "CHRONIC_DISEASE" } },
    "rules": { "Category": { "enable": true, "orgedit": false } },
    "adopt": {
      "available": true,
      "title": "What's new in HTN Care Plan",
      "fromVersion": 1,
      "fromVersionLabel": "v1",
      "toVersion": 2,
      "toVersionLabel": "v2",
      "sourceOrgTemplateId": "ROSEWOOD-ORG-MQF0AGCD0AA65849",
      "fromOrgTemplateVersionId": "ROSEWOOD-ORG-MQF0AGCD0AA65849-V01",
      "toOrgTemplateVersionId": "ROSEWOOD-ORG-MQF0AGCD0AA65849-V02",
      "localChangesPresent": true,
      "localChangesLabel": "Present",
      "footerNote": "Your existing Org Templates and Care Plans are unchanged — adoption only updates this variant record.",
      "changes": {
        "added": [
          {
            "key": "Onboarding.CaregiverTasks",
            "label": "Caregiver Tasks",
            "message": "A new optional 'Caregiver Tasks' section has been added to Onboarding. Your existing task config is preserved.",
            "preserved": true
          },
          {
            "key": "EducationHub",
            "label": "Education Hub",
            "message": "New 'Education Hub' section with structured learning modules and completion tracking.",
            "preserved": false
          }
        ],
        "changed": [
          {
            "key": "ReviewCadence",
            "label": "Review cadence",
            "message": "Default review cadence changed from 30D to 15D. Your org override (15D) will be preserved.",
            "before": "30D",
            "after": "15D",
            "preserved": true
          },
          {
            "key": "DeviceReadings.maxPerSession",
            "label": "Max device readings per session",
            "message": "Max device readings per session increased from 3 to 5.",
            "before": "3",
            "after": "5",
            "preserved": false
          }
        ],
        "removed": [
          {
            "key": "PatientEducationV1",
            "label": "Patient Education v1",
            "message": "The legacy 'Patient Education v1' section was removed. You have customisations here.",
            "severity": "warning",
            "requiresReview": true,
            "preserved": false
          }
        ]
      }
    }
  }
}
```

#### Single response (no upgrade)

```json
{
  "success": true,
  "data": {
    "orgTemplateId": "HTN-CARE-PLAN-VARIANT-A-546d8483",
    "upgrade": false,
    "adopt": null,
    "fieldValues": {},
    "rules": {}
  }
}
```

#### How `adopt` is built

Compare two canonical org template snapshots:

| Side | Source |
|------|--------|
| **From** (variant snapshot) | `derivedFromOrgTemplateVersionId` at variant copy time |
| **To** (latest canonical) | Current META / VERSION on `derivedFromOrgTemplateId` |

Diff `fieldValues`, `rules`, and linked sections → classify as `added` / `changed` / `removed`.

| Check | Sets |
|-------|------|
| Variant `fieldValues`/`rules` differ from canonical **at copy time** | `localChangesPresent: true` |
| Org override on a changed field | `preserved: true` on that change row |
| Removed section with variant edits | `requiresReview: true`, `severity: warning` |

UI maps `adopt.changes.*` to the green / blue / red sections in the modal. **Adopt v2** button calls API 4.

---

## Upgrade + adopt flow (variant level)

```
1. POST /templates/org-derived
      variant derivedFromOrgTemplateVersion: 1
      upgrade: false

2. PUT /templates/org/{master}/{org}     ← canonical org template edited
      canonical version 1 → 2

3. GET list … ORG_DERIVED
      upgrade: true on affected variants
      history shows variant's own edits

4. GET single …&orgTemplateId=…
      adopt: { available: true, fromVersionLabel: "v1", toVersionLabel: "v2", changes: {…} }
      → console shows "What's new" modal

5. POST /templates/org-derived/{orgTemplateId}/adopt   (phase 2)
      merges canonical v2 into variant, preserves local overrides
      derivedFromOrgTemplateVersion → 2
      upgrade: false
      history entry: "Adopted org template v2"
```

Parallel at **canonical** level (existing):

```
Master v1.3 published → GET templateLevel=ORG → upgrade: true
→ GET /templates/org-version-status → adopt master (existing derive/adopt paths)
```

Variant `adopt` compares **canonical org → canonical org**, not master → variant directly.

---

## API 2 — POST create variant from canonical org template

### `POST /templates/org-derived`

Copy the **canonical org template** (from derive) into a new variant `orgTemplateId`.

#### Defaults on create (no need to pass)

| Field | Default |
|-------|---------|
| `templateEnabled` | `true` |
| `status` | `DRAFT` |
| `active` | `true` |
| `version` | `1` |

#### Preconditions

| Check | On failure |
|-------|------------|
| `sourceOrgTemplateId` exists for `organizationId` | `404` |
| Source is canonical (not `derivationKind: orgDerive`) | `409` — must derive from canonical first |
| `newTemplateName` unique among variants in org | `409` |

#### Request (minimal — defaults apply)

```json
{
  "organizationId": "mqf0agcd0aa65849",
  "sourceOrgTemplateId": "ROSEWOOD-ORG-MQF0AGCD0AA65849",
  "newTemplateName": "HTN Care Plan — Variant A"
}
```

Optional: `"templateEnabled": false` to create disabled.

#### Response `201`

```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "organizationId": "mqf0agcd0aa65849",
    "sourceOrgTemplateId": "ROSEWOOD-ORG-MQF0AGCD0AA65849",
    "orgTemplateId": "HTN-CARE-PLAN-VARIANT-A-546d8483",
    "templateVersionId": "HTN-CARE-PLAN-VARIANT-A-546d8483-V01",
    "templateName": "HTN Care Plan — Variant A",
    "status": "DRAFT",
    "active": true,
    "templateEnabled": true,
    "version": 1
  }
}
```

---

## API 3 — PUT update variant (rules + status + active + enable)

### `PUT /templates/org-derived/{orgTemplateId}?organizationId=mqf0agcd0aa65849`

One endpoint for variant lifecycle:

- partial **`rules`** patch
- partial **`fieldValues`** patch (merged into existing `fieldValues`)
- **`status`**: `DRAFT` or `PUBLISHED` (`PUBLISH` accepted as alias)
- **`active`**: `true` / `false` (maps to template `isActive`)
- **`templateEnabled`**: enable / disable subscription row

#### Example — rules + status + active

```json
{
  "rules": {
    "Category": { "orgedit": false }
  },
  "fieldValues": {
    "Category": { "value": "CHRONIC_DISEASE" }
  },
  "status": "DRAFT",
  "active": true
}
```

- To edit `rules` / `fieldValues`, variant must be in an editable status (`DRAFT`, `SAVED`, or `IN_REVIEW`). Pass `"status": "DRAFT"` in the same request if currently `PUBLISHED`.
- `fieldValues` keys are **merged** (partial patch). Empty `{}` is ignored.
- `active: false` marks the template inactive without disabling org enablement (`templateEnabled`).

#### Example — publish variant

```json
{
  "status": "PUBLISH"
}
```

Response includes `"status": "PUBLISHED"`.

#### Versioning rules

| Change | Version bump? |
|--------|----------------|
| `rules` and/or `fieldValues` | **Yes** (`1` → `1.1`) |
| `status` and/or `active` only | **No** |
| `templateEnabled` only | **No** |

---

## API 4 — POST adopt canonical upgrade into variant (phase 2)

### `POST /templates/org-derived/{orgTemplateId}/adopt?organizationId=mqf0agcd0aa65849`

Called when the user clicks **Adopt v2** in the modal (after reviewing `adopt` from GET single).

#### Preconditions

| Check | On failure |
|-------|------------|
| Variant exists | `404` |
| `upgrade: true` (canonical ahead of snapshot) | `409` — nothing to adopt |
| Variant in editable status (`DRAFT` / `SAVED` / `IN_REVIEW`) | `409` |

#### Request

```json
{
  "confirm": true
}
```

Optional future: `"preserveLocalOverrides": true` (default `true`).

#### Response `200`

```json
{
  "success": true,
  "data": {
    "orgTemplateId": "HTN-CARE-PLAN-VARIANT-A-546d8483",
    "templateVersionId": "HTN-CARE-PLAN-VARIANT-A-546d8483-V01",
    "version": 2,
    "derivedFromOrgTemplateVersion": 2,
    "derivedFromOrgTemplateVersionId": "ROSEWOOD-ORG-MQF0AGCD0AA65849-V02",
    "upgrade": false,
    "adopt": null,
    "history": [
      {
        "version": 2,
        "action": "ADOPTED",
        "title": "Adopted org template v2",
        "updatedBy": { "userId": "…", "email": "rootadmin@yopmail.com" },
        "changes": ["adopted: ROSEWOOD-ORG-MQF0AGCD0AA65849 v1 → v2"]
      }
    ]
  }
}
```

#### Adopt behaviour

1. Load canonical org template at **latest** version (`derivedFromOrgTemplateId`).
2. Merge into variant: platform/canonical changes apply; variant-local overrides marked `preserved: true` in preview are kept.
3. Update lineage: `derivedFromOrgTemplateVersion`, `derivedFromOrgTemplateVersionId`.
4. Bump variant display version; append `versionHistory` entry with actor + change summary.
5. `upgrade` becomes `false`; `adopt` becomes `null` on subsequent GET.

---

## Postman

Import `apps/template-service/org-derived.postman_collection.json` for the three API calls (list, create, update).

---

## Data model

### Canonical org template (derive — existing)

```typescript
orgTemplateId: buildOrgTemplateId(masterTemplateId, organizationId);
// e.g. TEST-TEMPLATE-ORG-ROSEWOOD
masterTemplateId: string;
```

### Org-derived variant (new)

```typescript
derivationKind: 'orgDerive';
derivedFromOrgTemplateId: string;
derivedFromOrgTemplateVersionId: string;
derivedFromOrgTemplateVersion: number; // snapshot at copy time — used for upgrade
orgTemplateId: string; // slug(newTemplateName) + short uuid
status: 'DRAFT' | 'PUBLISHED' | ...;
isActive: boolean; // exposed as `active` on API
versionHistory?: TemplateHistoryEntry[]; // on VERSION row — powers list history
```

### Adopt preview (`adopt` on single GET — phase 2)

```typescript
type OrgDerivedAdoptPreview = {
  available: boolean;
  title: string; // e.g. "What's new in HTN Care Plan"
  fromVersion: number;
  fromVersionLabel: string; // "v1"
  toVersion: number;
  toVersionLabel: string; // "v2"
  sourceOrgTemplateId: string;
  fromOrgTemplateVersionId: string;
  toOrgTemplateVersionId: string;
  localChangesPresent: boolean;
  localChangesLabel: 'None' | 'Present';
  footerNote: string;
  changes: {
    added: OrgDerivedAdoptChangeRow[];
    changed: OrgDerivedAdoptChangeRow[];
    removed: OrgDerivedAdoptChangeRow[];
  };
};

type OrgDerivedAdoptChangeRow = {
  key: string;
  label: string;
  message: string; // human text for UI bullet
  before?: string;
  after?: string;
  preserved?: boolean;
  severity?: 'info' | 'warning';
  requiresReview?: boolean;
};
```

**List query:** GSI1 org index + filter `derivationKind === 'orgDerive'`.

**Enablement:** Canonical and each variant have **separate** enablement rows.

---

## Decisions (resolved)

| Question | Decision |
|----------|----------|
| List variants | **GET `/templates?templateLevel=ORG_DERIVED`** — no separate `/templates/org-derived` GET route |
| Canonical org catalog | **GET `/templates?templateLevel=ORG`** excludes variants |
| Copy when canonical is disabled? | **Yes** |
| Duplicate `newTemplateName` in same org? | **409** |
| `sourceOrgTemplateId` for POST | **Canonical only** in phase 1 |
| Enum wire values | camelCase: `orgDerive` |
| Create defaults | `templateEnabled: true`, `status: DRAFT`, `active: true` |
| Variant upgrade flag | `upgrade` on list/get — canonical org version > variant snapshot |
| List `history` | Same `TemplateHistoryEntry` shape as master list — **phase 2** |
| Single `adopt` preview | Populated when `upgrade: true`; `null` otherwise — **phase 2** |
| Adopt action | `POST …/adopt` after modal confirm — **phase 2** |

---

## Implementation checklist

### Phase 1 — done

**`libs/template-core`**

- [x] `createOrgDerived()`, `getOrgDerived()` (list + single), `updateOrgDerived()`
- [x] `buildDerivedOrgTemplateId()`, variant meta lineage fields
- [x] `listOrgEnabled()` excludes `derivationKind: orgDerive` rows
- [x] `upgrade` flag on list/get (canonical version compare)
- [x] Create defaults: `templateEnabled`, `status`, `active`
- [x] PUT: `status`, `active`, `fieldValues`, `rules`

**`apps/template-service`**

- [x] Handlers: `createOrgDerived`, `updateOrgDerived`; list via `listTemplates` + `templateLevel=ORG_DERIVED`
- [x] Zod: `orgDerivedCreateBody`, `orgDerivedUpdateBody`; `templateLevel` includes `ORG_DERIVED`
- [x] `serverless.yml`: POST + PUT under `/templates/org-derived`
- [x] `org-derived.postman_collection.json`

### Phase 2 — done

**`libs/template-core`**

- [x] `history` on list items — reuse `resolveTemplateHistory` / `buildVersionHistory` from `template-http.dto.ts`
- [x] Append `versionHistory` on variant create and PUT (via `saveOrgTemplateInPlace`)
- [x] `buildOrgDerivedAdoptPreview()` — diff canonical from-snapshot vs to-latest → `adopt.changes`
- [x] `localChangesPresent` — compare variant body vs canonical at copy snapshot
- [x] `adoptOrgDerived()` service method for POST adopt

**`apps/template-service`**

- [x] Single GET returns `adopt` object (or `null`)
- [x] List GET returns `history[]` per item
- [x] `POST /templates/org-derived/{orgTemplateId}/adopt` handler + Zod + serverless route
- [x] Update Postman collection (list, single, adopt)
