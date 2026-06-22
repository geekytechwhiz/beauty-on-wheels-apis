# Org-derived templates — API plan

**Status:** implemented  
**Depends on:** `CONSOLE_CARE_PLAN_PAYLOAD_BACKEND_PLAN.md`, `LINKED_TEMPLATE_RULES_SEPARATE_STRUCTURE_PLAN.md`

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
│       ├── GET  /templates?templateLevel=ORG_DERIVED&organizationId=…  │
│       └── PUT  /templates/org-derived/{orgTemplateId}                   │
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
| **3** | `GET /templates?templateLevel=ORG_DERIVED&organizationId=…` | List variants (or get one with `orgTemplateId`) |
| **4** | `PUT /templates/org-derived/{orgTemplateId}` | Patch variant rules / fieldValues / enable |

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

## New APIs (2 write + 1 list via existing GET)

| # | Method | Path | Does |
|---|--------|------|------|
| 1 | **GET** | `/templates?templateLevel=ORG_DERIVED&organizationId=…` | List org-derived **variants**, or get one when `orgTemplateId` query is set |
| 2 | **POST** | `/templates/org-derived` | Copy **canonical org template** → new variant + set `templateEnabled` |
| 3 | **PUT** | `/templates/org-derived/{orgTemplateId}` | Update variant `rules` / `fieldValues` / `templateEnabled` |

### `templateLevel` values on GET `/templates`

| Value | Returns |
|-------|---------|
| `MASTER` (default) | Published master catalog |
| `ORG` | Canonical org enablement catalog (excludes `derivationKind: orgDerive`) |
| `ORG_DERIVED` | Org-derived variants only (`derivationKind === orgDerive`) |

---

## API 1 — GET list (or get one) via `/templates`

### `GET /templates?templateLevel=ORG_DERIVED`

Returns **variants only** (`derivationKind === orgDerive`). Same query filters as `templateLevel=ORG` where applicable.

#### Query parameters

| Param | Required | Notes |
|-------|----------|-------|
| `templateLevel` | **Yes** | Must be `ORG_DERIVED` |
| `organizationId` | **Yes** | Org scope |
| `orgTemplateId` | No | If set → **single item** with full `fieldValues` + `rules`; if omitted → **list** |
| `categoryCode` | No | Filter (`category` alias OK) |
| `conditionCode` | No | Filter (`condition` alias OK) |
| `specialty` | No | Filter |
| `templateType` | No | e.g. `CARE_PLAN` |
| `templateName` | No | Substring |
| `templateEnabled` | No | `true` / `false` |
| `country` | No | Pass-through (e.g. `all`) |
| `nextPaginationKey` | No | Pagination (list mode only) |

#### List example

```http
GET /templates?templateLevel=ORG_DERIVED&organizationId=ROSEWOOD&categoryCode=CHRONIC_DISEASE&conditionCode=HYPERTENSION&country=all
```

#### Single-item example

```http
GET /templates?templateLevel=ORG_DERIVED&organizationId=ROSEWOOD&orgTemplateId=HTN-VARIANT-A-a1b2c3d4
```

Response shapes unchanged from the original org-derived list/get design (see git history or service mappers).

---

## API 2 — POST create variant from canonical org template

### `POST /templates/org-derived`

Copy the **canonical org template** (from derive) into a new variant `orgTemplateId`. Enable/disable on create via `templateEnabled` (no separate enable API for variants).

#### Preconditions

| Check | On failure |
|-------|------------|
| `sourceOrgTemplateId` exists for `organizationId` | `404` |
| Source is canonical (not `derivationKind: orgDerive`) | `409` — must derive from canonical first |
| `newTemplateName` unique among variants in org | `409` |

#### Request

```json
{
  "organizationId": "ROSEWOOD",
  "sourceOrgTemplateId": "TEST-TEMPLATE-ORG-ROSEWOOD",
  "newTemplateName": "HTN Care Plan — Variant A",
  "templateEnabled": true
}
```

#### Response `201`

```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "organizationId": "ROSEWOOD",
    "sourceOrgTemplateId": "TEST-TEMPLATE-ORG-ROSEWOOD",
    "orgTemplateId": "HTN-VARIANT-A-a1b2c3d4",
    "templateVersionId": "HTN-VARIANT-A-a1b2c3d4-V01",
    "templateName": "HTN Care Plan — Variant A",
    "templateEnabled": true,
    "version": 1
  }
}
```

---

## API 3 — PUT update variant (rules + enable + version)

### `PUT /templates/org-derived/{orgTemplateId}?organizationId=ROSEWOOD`

One endpoint for variant lifecycle:

- partial **`rules`** patch
- partial **`fieldValues`** patch
- **`templateEnabled`** enable / disable
- **version bump** when `rules` or `fieldValues` change (`1` → `1.1`, same as canonical org rules PUT)

#### Versioning rules

| Change | Version bump? |
|--------|----------------|
| `rules` and/or `fieldValues` | **Yes** |
| `templateEnabled` only | **No** |

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
orgTemplateId: string; // slug(newTemplateName) + short uuid
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

---

## Implementation checklist

**`libs/template-core`**

- [x] `createOrgDerived()`, `getOrgDerived()` (list + single), `updateOrgDerived()`
- [x] `buildDerivedOrgTemplateId()`, variant meta lineage fields
- [x] `listOrgEnabled()` excludes `derivationKind: orgDerive` rows

**`apps/template-service`**

- [x] Handlers: `createOrgDerived`, `updateOrgDerived`; list via `listTemplates` + `templateLevel=ORG_DERIVED`
- [x] Zod: `orgDerivedCreateBody`, `orgDerivedUpdateBody`; `templateLevel` includes `ORG_DERIVED`
- [x] `serverless.yml`: POST + PUT under `/templates/org-derived` only
- [x] `org-derived.postman_collection.json`
