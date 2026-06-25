# Metadata registry seed — CI/CD

Optional CodeBuild jobs seed the metadata catalog from an Excel file in S3. Deploy buildspecs are unchanged; seed uses **separate** buildspecs so seed never runs on every deployment.

## Files

| File | Purpose |
|------|---------|
| `scripts/metadata-registry-seed/run-seed-ci.sh` | Shared CI entrypoint (S3 download, health check, guards, seed) |
| `apps/metadata-registry-service/seed-dev-buildspec.yml` | Dev seed job |
| `apps/metadata-registry-service/seed-stg-buildspec.yml` | Stg seed job (preview + apply via env vars) |
| `apps/metadata-registry-service/seed-prd-buildspec.yml` | Prd seed job (preview + apply via env vars) |

Deploy buildspecs (`buildspec.yml`, `stg-buildspec.yml`, `prd-buildspec.yml`) are **not** modified.

## Pipeline shape

### Dev

```text
Build → Deploy dev → Seed dev (optional)
```

Seed runs only when `RUN_METADATA_SEED=true`. Default `DRY_RUN=true`. Set `DRY_RUN=false` only for a real dev seed.

### Staging / production

```text
Build → Deploy → Seed preview (DRY_RUN=true) → Manual approval → Seed apply (DRY_RUN=false)
```

Real seed on stg/prd **never** runs in the deploy buildspec. Use two CodePipeline stages (or two CodeBuild projects) with the same seed buildspec and different environment variables.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RUN_METADATA_SEED` | Yes | `true` to run seed; anything else skips (exit 0) |
| `METADATA_CATALOG_S3_BUCKET` | When seed runs | S3 bucket for Excel; **defaults to `DEPLOYMENT_BUCKET`** (same as `serverless.yml` `custom.deploymentBucket`) |
| `METADATA_CATALOG_S3_KEY` | When seed runs | Object key, e.g. `metadata/Complete-metadata.xlsx` |
| `METADATA_EXCEL_PATH` | When seed runs | Local path after download, e.g. `/tmp/Complete-metadata.xlsx` |
| `BASE_URL` | When seed runs | Metadata registry API base **including stage**, e.g. `https://…/stg` |
| `DRY_RUN` | No | `true` (default) = validate Excel/payloads only; `false` = HTTP draft/publish |
| `AUTH_TOKEN` | Optional | Real Cognito JWT — **Secrets Manager only** if used. Takes precedence over `SEED_ACTOR_USER_ID` |
| `SEED_ACTOR_USER_ID` | Optional | Platform user id for **script-only** actor attribution (no JWT). Used when `AUTH_TOKEN` is unset. Set in `seed-*-buildspec.yml` `env.variables` or CodeBuild project env |
| `METADATA_TYPE_CODES` | No | Scoped seed, e.g. `TestingScript` or `Country,Language`. **Buildspec default:** `TestingScript`. Unset = full catalog |
| `ALLOW_FULL_METADATA_SEED` | stg/prd full seed | Must be `true` when `METADATA_TYPE_CODES` is unset |
| `CONFIRM_METADATA_SEED` | stg/prd real seed | Must be `true` when `DRY_RUN=false` on stg/prd |
| `METADATA_CATALOG_S3_VERSION_ID` | No | Pin a specific S3 object version |
| `CONCURRENCY` | No | Parallel value creates (default `5`) |
| `TREAT_CONFLICT_AS_SUCCESS` | No | Default `true` |
| `CONFIRMATION_ACKNOWLEDGED` | No | API publish gate (default `true`) |

`METADATA_SEED_STAGE` is set in each seed buildspec (`dev` / `stg` / `prd`) for logging and safety rules.

### Seed actor attribution (script-only)

Long-running bulk seeds should not rely on expiring Cognito JWTs. Use **`SEED_ACTOR_USER_ID`** instead of `AUTH_TOKEN` in CI/CD.

**Precedence:**

```text
1. AUTH_TOKEN set        → Metadata seed auth source: AUTH_TOKEN
2. SEED_ACTOR_USER_ID    → Metadata seed auth source: SEED_ACTOR_USER_ID
3. Neither set           → Metadata seed auth source: system
```

**How it works (no metadata-registry code changes):**

- The seed script (`helpers/metadata-api.ts`) builds an unsigned `Authorization: Bearer …` token whose payload contains `custom:userID`.
- The registry already decodes JWT payloads from `Authorization` without signature verification (`libs/utils` `buildRequestContext`).
- `createdBy` / `lastModifiedBy` are stored as that user id; GET/list resolves display name from `USER_TABLE`.

**Scope:** seed scripts and CI/CD only — not for dashboard or public API clients.

**Configuration:** `SEED_ACTOR_USER_ID` is set in each `seed-*-buildspec.yml` under `env.variables` (per-stage platform user id). CodeBuild project env can override. `run-seed-ci.sh` exports it before `pnpm seed:metadata`.

### Excel catalog bucket (= deployment bucket)

From `apps/metadata-registry-service/serverless.yml` → `custom.deploymentBucket`:

| Stage | `DEPLOYMENT_BUCKET` / `METADATA_CATALOG_S3_BUCKET` |
|-------|-----------------------------------------------------|
| **dev** | `dev-mvx-metadata-registry-service-bucket` |
| **stg** | `nvstg-mvx-metadata-registry-service-bucket` |
| **prd** | `nvprd-mvx-metadata-registry-service-bucket` |

Upload Excel under a **prefix** (not mixed with Lambda zip keys), e.g. `metadata/Complete-metadata.xlsx`.

**Note:** `deploymentBucket` is **S3** (Excel + Lambda artifacts). **Secrets Manager** is optional (only if using `AUTH_TOKEN`).

## Sample CodeBuild environment (actor via user id — recommended for bulk seed)

Set in the **CodeBuild project** or **CodePipeline action** environment (not in git):

| Name | Value | Type |
|------|-------|------|
| `RUN_METADATA_SEED` | `true` | Plaintext |
| `DRY_RUN` | `false` | Plaintext |
| `SEED_ACTOR_USER_ID` | `<platform-user-id>` | Plaintext |
| `BASE_URL` | `https://…/dev` (or stg/prd) | Plaintext |
| `METADATA_TYPE_CODES` | `TestingScript` (optional) | Plaintext |

Do **not** store JWTs in Secrets Manager when using `SEED_ACTOR_USER_ID`.

## Sample pipeline variables

### Dev — dry-run (default)

```bash
RUN_METADATA_SEED=true
METADATA_CATALOG_S3_BUCKET=dev-mvx-metadata-registry-service-bucket
METADATA_CATALOG_S3_KEY=metadata/Complete-metadata.xlsx
METADATA_EXCEL_PATH=/tmp/Complete-metadata.xlsx
BASE_URL=https://244vhkoib0.execute-api.us-east-1.amazonaws.com/dev
DRY_RUN=true
METADATA_TYPE_CODES=TestingScript
```

### Dev — real scoped seed (with actor user id)

```bash
RUN_METADATA_SEED=true
METADATA_CATALOG_S3_BUCKET=dev-mvx-metadata-registry-service-bucket
METADATA_CATALOG_S3_KEY=metadata/Complete-metadata.xlsx
METADATA_EXCEL_PATH=/tmp/Complete-metadata.xlsx
BASE_URL=https://244vhkoib0.execute-api.us-east-1.amazonaws.com/dev
DRY_RUN=false
METADATA_TYPE_CODES=TestingScript
SEED_ACTOR_USER_ID=<platform-user-id>
```

Without `SEED_ACTOR_USER_ID` or `AUTH_TOKEN`, dev allows real seed with actor `system`.

### Stg — preview (before approval)

```bash
RUN_METADATA_SEED=true
METADATA_CATALOG_S3_BUCKET=nvstg-mvx-metadata-registry-service-bucket
METADATA_CATALOG_S3_KEY=metadata/Complete-metadata.xlsx
METADATA_EXCEL_PATH=/tmp/Complete-metadata.xlsx
BASE_URL=https://esrmlb4oh6.execute-api.us-east-1.amazonaws.com/stg
DRY_RUN=true
METADATA_TYPE_CODES=TestingScript
```

### Stg — apply (after manual approval)

```bash
RUN_METADATA_SEED=true
METADATA_CATALOG_S3_BUCKET=nvstg-mvx-metadata-registry-service-bucket
METADATA_CATALOG_S3_KEY=metadata/Complete-metadata.xlsx
METADATA_EXCEL_PATH=/tmp/Complete-metadata.xlsx
BASE_URL=https://esrmlb4oh6.execute-api.us-east-1.amazonaws.com/stg
DRY_RUN=false
CONFIRM_METADATA_SEED=true
METADATA_TYPE_CODES=TestingScript
TREAT_CONFLICT_AS_SUCCESS=true
CONCURRENCY=5
SEED_ACTOR_USER_ID=<platform-user-id>
```

### Prd — preview

```bash
RUN_METADATA_SEED=true
METADATA_CATALOG_S3_BUCKET=nvprd-mvx-metadata-registry-service-bucket
METADATA_CATALOG_S3_KEY=metadata/Complete-metadata.xlsx
METADATA_EXCEL_PATH=/tmp/Complete-metadata.xlsx
BASE_URL=https://jc1l3fgzi2.execute-api.us-east-1.amazonaws.com/prd
DRY_RUN=true
METADATA_TYPE_CODES=TestingScript
```

### Prd — apply

```bash
RUN_METADATA_SEED=true
METADATA_CATALOG_S3_BUCKET=nvprd-mvx-metadata-registry-service-bucket
METADATA_CATALOG_S3_KEY=metadata/Complete-metadata.xlsx
METADATA_EXCEL_PATH=/tmp/Complete-metadata.xlsx
BASE_URL=https://jc1l3fgzi2.execute-api.us-east-1.amazonaws.com/prd
DRY_RUN=false
CONFIRM_METADATA_SEED=true
METADATA_TYPE_CODES=TestingScript
SEED_ACTOR_USER_ID=<platform-user-id>
```

## Upload Excel to S3 (manual)

Excel is not in Git. Upload before running seed:

```bash
aws s3 cp "Complete metadata (1).xlsx" \
  s3://nvstg-mvx-metadata-registry-service-bucket/metadata/Complete-metadata.xlsx
```

Use a **versioned** bucket. Optional: set `METADATA_CATALOG_S3_VERSION_ID` in the pipeline to pin an approved version.

## CodeBuild secrets (AUTH_TOKEN — optional)

Only needed if you prefer a real JWT over `SEED_ACTOR_USER_ID`. Uncomment in the seed buildspec and set ARN:

```yaml
env:
  secrets-manager:
    AUTH_TOKEN: arn:aws:secretsmanager:us-east-1:<account>:secret:metadata-seed/stg-auth-token
```

The script never prints `AUTH_TOKEN` or `SEED_ACTOR_USER_ID` values.

## IAM (CodeBuild role)

Grant read access to the catalog bucket:

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:GetObject",
    "s3:GetObjectVersion"
  ],
  "Resource": "arn:aws:s3:::<deployment-bucket-name>/metadata/*"
}
```

For Secrets Manager (only if using `AUTH_TOKEN`):

```json
{
  "Effect": "Allow",
  "Action": "secretsmanager:GetSecretValue",
  "Resource": "arn:aws:secretsmanager:us-east-1:<account>:secret:metadata-seed/*"
}
```

## Artifacts

Successful runs upload `scripts/metadata-registry-seed/reports/**` as CodeBuild artifacts (JSON + CSV seed reports).

## Local dry-run (without CI)

```bash
export METADATA_EXCEL_PATH="helpers/metadata/Complete metadata (1).xlsx"
export SEED_ACTOR_USER_ID="<platform-user-id>"
export DRY_RUN=true
pnpm seed:metadata
```

## Notes

- **JWT expiry**: prefer `SEED_ACTOR_USER_ID` for long bulk seeds; `AUTH_TOKEN` optional and takes precedence when set.
- **Dry-run** does not call the registry API (only Excel validation). Health check runs before seed when `RUN_METADATA_SEED=true`.
- **Business logic** in `seed-metadata.ts` is unchanged; CI only adds `run-seed-ci.sh` and buildspec wiring.
