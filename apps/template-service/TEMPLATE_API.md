# Template Service API (quick reference)

OpenAPI source: `template-service-care-plan.openapi.yaml`  
Validate locally: `npx @redocly/cli lint template-service-care-plan.openapi.yaml` (uses `redocly.yaml`)  
UI form schemas: `services-json/*-api-response.json`

## Canonical routes

| Method | Path | Notes |
|--------|------|--------|
| POST | `/templates` | Create **master** template |
| GET | `/templates?templateLevel=MASTER\|ORG` | List; org needs `organizationId` or JWT org |
| GET | `/templates/{templateId}/versions?version=latest\|meta\|{id}` | Read; replaces `/templates/master/{id}/meta` |
| PUT | `/templates/{templateId}/versions/{versionId}` | Update master or org version |
| POST | `/templates/{templateId}/derive` | Org copy from published master |
| POST | `/templates/{templateId}/versions/{versionId}/status` | Lifecycle |
| GET | `/templates/compatible` | Published templates for linking |
| * | `/org-enablements` | Enablement CRUD |
| * | `/template-configs` | UI form JSON (not template CRUD) |

Legacy `/templates/master`, `/templates/org`, and `/templates/organizations/.../clone` remain for backward compatibility.

## Storage model (current)

- **Create** writes one row: `SK=VERSION#001` with full payload (`fieldValues`, `templateProfile`, …) and service `meta` on the same item.
- **No separate `SK=META` row** on create (legacy META rows in DynamoDB are ignored by list; use `GET .../versions?version=latest`).
- **List** with `templateType=TASK` searches all statuses (DRAFT/SAVED/PUBLISHED) via GSI5 — not GSI2 (published-only).

## Create master (Task example)

```json
{
  "templateCode": "TASK_BP_MONITORING",
  "templateType": "TASK",
  "templateMetadata": {},
  "templateProfile": {},
  "fieldValues": {
    "TASK_NAME": "Record Blood Pressure",
    "TASK_DESCRIPTION": "Measure BP daily",
    "ASSIGNED_TO_ROLE": "PATIENT",
    "TASK_CATEGORY": "MONITORING",
    "TASK_TYPE": "MEASUREMENT",
    "TASK_SUBTYPE": "BLOOD_PRESSURE",
    "ACTION_SUBMISSION_TYPE": "DEVICE_SYNC",
    "COMPARISON_METHOD": "RANGE",
    "SCHEDULE_TYPE": "RECURRING",
    "RECURRENCE_PATTERN": "DAILY",
    "REMINDERS_ENABLED": true,
    "REMINDER_CHANNELS": ["IN_APP", "PUSH"],
    "DISPLAY_TO_PATIENT": true
  }
}
```

`templateName` is taken from `fieldValues.TASK_NAME` when omitted.

## List / get

```http
GET /templates?templateLevel=MASTER&templateType=TASK
GET /templates?templateLevel=MASTER&templateType=TASK&status=DRAFT
GET /templates/{templateId}/versions?version=latest
```

List returns **full VERSION documents** (`meta`, `fieldValues`, `templateProfile`, …).

## Derive org template (copy master → org)

`POST /templates/{masterTemplateId}/derive`

| Who provides | Field | Example |
|--------------|-------|---------|
| **URL path** | `masterTemplateId` | `GOAL-CODE` (from master create: `templateCode` `GOAL_CODE`) |
| **Body** (optional) | `organizationId` | `org-apollo-001` (or use JWT org) |
| **Body** (optional) | `sourceVersionId` | Omit → server picks **latest PUBLISHED** master version |
| **Body** (optional) | `newTemplateName`, `inheritLinks` | Display name for org copy |
| **Response `data`** (generated) | `templateId`, `templateVersionId` | e.g. `GOAL-CODE-ORG-ORG-APOLLO-001`, `GOAL-CODE-ORG-ORG-APOLLO-001-V01` |

**Do not** send a new org template id from the frontend.

Minimal body (master must be **PUBLISHED** first):

```json
{
  "newTemplateName": "Apollo – Goal Program",
  "inheritLinks": true
}
```

```bash
curl -X POST "http://localhost:3000/templates/GOAL-CODE/derive" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"organizationId":"org-apollo-001","newTemplateName":"Apollo – Goal Program","inheritLinks":true}'
```

## Postman

Import `template-service.postman_collection.json`. Set collection variables: `baseUrl`, `authToken`, `organizationId`, `templateId`, `versionId`.
