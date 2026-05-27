# Template Service — What Changes (Addendum Summary)

**Source:** Team direction email (Platform Program Master → Org Program Master → Org Care Plan → Package → Runtime snapshot).  
**Today:** 16 OpenAPI routes are **built and working**. This doc says what must **change** vs **reuse**.

---

## Bottom line (simple)

| Question | Answer |
|----------|--------|
| Is this a huge rewrite? | **No** — same service, same DynamoDB table pattern, mostly **extend** what you have. |
| Is it still a real project? | **Yes** — new **levels** on records, **fix** package linking query, **org** status lifecycle, and a few **new** upgrade/diff endpoints. |
| Can we reuse existing APIs? | **Mostly yes** — ~**10 routes stay**, ~**6 need behavior/field updates**, ~**2–4 new** routes for upgrade/diff and clearer lists. |
| Who owns Org Capability Profile? | **Org/Admin Configuration service** (not Template Service). Template Service only stores templates and answers “is this care plan published and linkable?”. |

---

## What the email wants vs what we have now

| Email concept | What we have today | Gap |
|---------------|-------------------|-----|
| **Platform Program Master** | `MASTER_TEMPLATE` | Same idea — add `templateLevel = PLATFORM_PROGRAM_MASTER` (name TBD) |
| **Org Program Master** | `POST /org-enablements` + clone creates generic `ORG_TEMPLATE` | Enablement is a **link**, not a full **Org Master** row; clone goes straight to one org copy |
| **Org Care Plan** (30d / 90d, package-ready) | Same `ORG_TEMPLATE` bucket as everything else | No separate level; no `isPackageLinkable` flag |
| **Only published Org Care Plans in packages** | `GET /templates/compatible` lists **platform** published masters | **Wrong filter today** — must change |
| **Single Care Plan Builder (UX)** | `PUT /templates/org/...` can save full document | **No new API required** — UI uses existing org update + publish |
| **Metadata from registry** | Hardcoded enums in OpenAPI | Separate plan: `METADATA_REGISTRY_INTEGRATION_PLAN.md` |
| **Upgrade / diff when new master** | Not built | **New** APIs (or one “compare versions” API) |
| **Org Capability readiness** | Not in Template Service | Package/Org services call profile **before** linking; template only returns linkable care plans |

---

## API impact (reuse first)

### No change (4) — keep as-is

| API | Why |
|-----|-----|
| `GET /health` | Unrelated |
| `GET /templates/master/{id}/meta` | Still valid for platform master |
| `GET /org-enablements/id/{id}` | Still valid |
| `PATCH /org-enablements/id/{id}` | Still valid |

### Extend same route (6) — same URL, new rules/fields

| API | What to add |
|-----|-------------|
| `POST /templates/master` | Set `templateLevel`; validate codes via Metadata Registry (later) |
| `PUT /templates/master/.../versions/{versionId}` | Same |
| `POST /templates/.../status` | Support **org** care plans (today mostly **master** only) |
| `POST /org-enablements` | After enable → **create Org Program Master** row (or align enablement + master creation) |
| `POST .../clone` | Clone **Org Master → Org Care Plan** (not only platform → org) |
| `PUT /templates/org/.../versions/{versionId}` | Care Plan Builder saves here; set `templateLevel`, goals/tasks/etc. in body |

### Fix behavior (4) — same route, wrong logic today

| API | Fix |
|-----|-----|
| `GET /templates/compatible` | Return **org** published care plans with `isPackageLinkable=true`, not platform GSI2 masters |
| `GET /templates/org` | Filter by `templateLevel` (masters vs care plans) |
| `GET /templates/organizations/.../versions` | Same filters |
| `GET /templates/master` | Super Admin only; org users should not use this for daily work |

### Small extend (4) — query params or response shape

| API | What to add |
|-----|-------------|
| `GET /templates/master` | Optional `templateLevel` filter |
| `GET /org-enablements` | Already fine for “what’s enabled” |
| `GET /org-enablements/{orgId}` | Same |
| List responses | Add `templateLevel`, `isPackageLinkable`, `publishedAt` on summary DTOs |

### New APIs (2–4) — only where existing routes are not enough

| New API (proposed) | Why |
|--------------------|-----|
| `GET /templates/org/care-plans` (or `?templateLevel=ORG_CARE_PLAN`) | Package UI: list **only** linkable care plans — can be **query on existing** `GET /templates/org` instead of new path |
| `GET /templates/.../versions/{id}/diff?from=&to=` | ChangeSet for “upgrade available” UX |
| `POST /templates/.../adopt-version` (optional) | Explicit adopt new master → new org version (future-facing) |

**Prefer:** add `templateLevel` + `isPackageLinkable` query params on **`GET /templates/org`** and **`GET /templates/compatible`** instead of many new paths.

---

## Count (for planning)

| Category | Count (of 16 + health) |
|----------|-------------------------|
| No change | **4** |
| Extend / fix (same paths) | **~10** |
| New routes (only if query params are not enough) | **0–2** (diff + optional adopt) |

**Rough effort:** **medium** (weeks, not months) if OpenAPI and `templateLevel` are agreed first. Biggest pieces: data model fields, fix compatible list, org status transitions, enable → org master flow.

---

## What is NOT Template Service work

| Area | Owner |
|------|--------|
| Org Capability Profile (`TemplateReady`, `CarePlanReady`, `PackageReady`, …) | Org/Admin Configuration |
| Metadata publish impact & change events | Metadata Registry |
| Package UI “blocked / setup pending” messages | Package service + Org profile |
| Runtime snapshot (patient assignment) | Runtime / Package (already stores linked version) |
| Care Plan Builder screens | Frontend (calls existing `PUT` org + `POST` status) |

Template Service should **expose** linkable published org care plans. Other services **decide** if org is allowed to use them.

---

## Suggested order of work

1. **Agree enums** — `templateLevel` values + `isPackageLinkable` rules (only published org care plan = true).  
2. **DynamoDB meta fields** — add to `template-core` entity builder (no new table).  
3. **Fix** `GET /templates/compatible` + `GET /templates/org` filters.  
4. **Wire** `POST .../status` for org partition.  
5. **Align** enablement + clone with Org Program Master → Org Care Plan flow.  
6. **Metadata registry** validation (separate plan).  
7. **Diff/adopt** APIs when UX is ready.

---

## One-sentence summary for the team

**We keep almost all current Template Service APIs; we add level + linkable flags on stored templates, fix the compatible/list filters for package linking, turn on org publish/status, and add optional diff/adopt later — Org Capability Profile lives outside this service.**
