# Alert Template Service Flow (UI payload injection)

This doc describes the runtime flow for **Alert templates** in `template-service`.
The goal is: when the client requests an Alert template (single version read), the API also returns the **UI structure** from `alert-api-response.json`.

## 1. Data stored in DynamoDB

When you create an Alert master template via:

- `POST /templates/master`

the request body includes `templateType: "ALERT"`.
`template-service` stores:

1. `META` row (`SK = META`) with `meta.templateType = ALERT`
2. `VERSION#...` row with the rest of the template document fields

## 2. What the UI needs

The frontend uses `apps/template-service/alert-api-response.json` as the **UI schema** (form configuration).
For runtime, this UI schema must be fetched from S3 and returned with the Alert template read response.

## 3. API read behavior (single version)

When the client calls either of these endpoints in **single-read mode** (not list mode):

- `GET /templates/master/{templateId}/versions?version=latest` (or `version=V01`, `resolve=...`)
- `GET /templates/organizations/{organizationId}/{templateId}/versions?version=latest` (or `version=V01`, `resolve=...`)

`template-service` performs the following:

1. Reads the template record from DynamoDB.
2. Checks `record.meta.templateType`.
3. If `record.meta.templateType === "ALERT"`, it fetches:
   - `s3://templates/alert-api-response.json`
4. The API returns the DynamoDB record and includes the UI payload:
   - response field: `uiApiResponse` (parsed JSON from S3)

### List mode note

If `version` is omitted and the endpoint returns the **list** of versions/templates, `template-service` does **not** fetch/attach the UI payload.

## 4. Error / fallback behavior

If the UI JSON object is missing/unreachable/unparseable, the API still returns the DynamoDB template record (without `uiApiResponse`), so template CRUD is not blocked by UI payload availability.

## 5. Required IAM permissions

`template-service` Lambda must have:

- `s3:GetObject` on:
  - `arn:aws:s3:::templates/alert-api-response.json`
  - `arn:aws:s3:::templates/monitoring-api-response.json`

(Monitoring is included for completeness; alert is the required first case.)

