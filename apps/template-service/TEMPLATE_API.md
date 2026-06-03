# Template Service API (quick reference)

OpenAPI source: `template-service-care-plan.openapi.yaml`  
Validate locally: `npx @redocly/cli lint template-service-care-plan.openapi.yaml` (uses `redocly.yaml`)  
UI form schemas: `services-json/*-api-response.json`

## Master template — one POST API

| Action | Method | Path |
|--------|--------|------|
| **Create** | `POST` | `/templates` |
| **Update / lifecycle** | `POST` | `/templates/{templateId}` |

Same request body shape for both. `templateId` in the path is the normalized id from create (e.g. `task-code` → `TASK-CODE`).

**Lifecycle** on update: include `lifecycleAction` (`PUBLISH`, `SUBMIT_REVIEW`, `REJECT`, `ARCHIVE`, `DEPRECATE`) instead of a separate status URL.

## Create master (example)

`shareScope`: **Private** | **Organization** | **Public** (case-insensitive).

```http
POST /templates
```

```json
{
  "templateLevel": "MASTER",
  "templateType": "TASK",
  "templateCode": "task-code",
  "templateName": "Task Monitoring Master",
  "categoryCode": "CHRONIC_CARE",
  "shareScope": "private",
  "active": true,
  "conditionCode": "DIABETES",
  "countryCodes": ["US"],
  "languageCodes": ["EN"],
  "version": 1,
  "status": "DRAFT",
  "measurementType": "NUMERIC",
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

## Update master (example)

```http
POST /templates/TASK-CODE
```

Edit:

```json
{
  "shareScope": "Organization",
  "fieldValues": { "TASK_NAME": "Updated name" }
}
```

Publish:

```json
{
  "lifecycleAction": "PUBLISH",
  "comment": "Approved"
}
```

## Other routes

| Method | Path | Notes |
|--------|------|--------|
| GET | `/templates?templateLevel=MASTER\|ORG` | List |
| GET | `/templates/{templateId}/versions?version=latest` | Read |
| PUT | `/templates/{templateId}/versions/{versionId}?templateLevel=ORG` | Org version update |
| POST | `/templates/{templateId}/derive` | Org copy from published master |
| POST | `/templates/{templateId}/versions/{versionId}/status?organizationId=…` | Org lifecycle only |

## Postman

Import `template-service.postman_collection.json`. Variables: `baseUrl`, `authToken`, `templateId` (set after create).
