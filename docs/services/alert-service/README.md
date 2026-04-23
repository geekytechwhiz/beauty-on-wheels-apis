# Alert Service

Deployable app under `apps/alert-service`: HTTP APIs for alert lifecycle plus **SQS-driven ingest** for async producers (aligned with `services/sso-integration` queue patterns and `apps/user-service` Serverless layout).

## Documentation

| Topic | Location |
|--------|----------|
| DynamoDB access patterns & business views | [ALERT_SERVICE_DATABASE.md](./requirements/ALERT_SERVICE_DATABASE.md) |
| API summary | This README |

## Responsibilities

- **REST**: create/list/get/patch alerts (patient timeline, org queue, user queue).
- **Idempotency**: `inputEventId` maps to `EVENT#<id>` + `ALERT` row; duplicate creates return the existing alert.
- **Async**: `processAlertIngest` Lambda consumes `alert-service-ingest-<stage>` (same payload shape as `POST /alerts` body).

## External services (optional)

Mirrors `sso-integration` style env wiring:

- `USER_SERVICE_PATIENT_LOOKUP_URL` — template with `{userId}`; if unset, HTTP patient validation is skipped.
- `ORGANIZATION_SERVICE_LOOKUP_URL` — template with `{organizationId}`; if unset, org validation is skipped.

## Build & deploy

- **Local**: from repo root `cd apps/alert-service && npx serverless offline --stage dev`
- **Package (CI)**: `apps/alert-service/buildspec.yml` runs `serverless package` then `aws cloudformation package` (same flow as `user-service` / `template-service`).
- **Nx**: `nx build alert-service` runs `tsc` for typecheck; Lambda bundles use **serverless-esbuild** (`esbuild-plugins.js`).

## Source layout

**App** (`apps/alert-service`): Lambda handlers only (HTTP + SQS); Serverless config and CI buildspecs.

**Libraries**:

- `libs/alert-repository` — DynamoDB entity types and `AlertRepository` (single-table keys + GSIs).
- `libs/alert-integration` — `AlertService`, optional user/org HTTP validation clients, `toPublicAlert` DTO mapping.

```
apps/alert-service/
├── src/
│   ├── handlers/          # API + health
│   └── handlers/sqs/      # SQS ingest
├── serverless.yml
├── swagger.json
└── buildspec.yml
```

## Related

- DB design export: `apps/alert-service/Alert+Service+Table+DB+design-3.doc` (Confluence HTML) — see markdown mapping in `requirements/ALERT_SERVICE_DATABASE.md`.
