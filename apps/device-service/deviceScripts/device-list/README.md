# Root-level device list (DEVICE_LIST)

Seed data for **pk=DEVICE_LIST**, **sk=CATEGORY#&lt;Category&gt;#&lt;DeviceId&gt;** (e.g. `CATEGORY#GlucoseMonitor#Contour7922H`) into `device-table-{env}` so all stages (dev/stg/prd) have the same canonical list.

## Source of truth

- **`src/utils/devices.json`** – hierarchical structure with categories, manufacturers, and devices. The script transforms this into DynamoDB items automatically using efficient batch writes.

## Seed into an environment

From repo root (or with `DEVICE_TABLE` set):

```bash
cd apps/device-service/deviceScripts/device-list

# Using tsx (TypeScript execute) - recommended
npx tsx index.ts --env dev    # or stg, prd

# Or compile first, then run
npx tsc index.ts
node index.js --env dev
```

### Command-line options

- `--env <env>` - Environment name (dev|stg|prd). If not provided, uses `DEVICE_TABLE` env var or `STAGE`/`SERVERLESS_STAGE`
- `--table <tableName>` - Override table name (default: `device-table-<env>`)
- `--upload-s3` - Upload devices.json to S3 after insertion (optional)
- `--dry-run` - Preview what would be written without actually writing

### Environment variables

- `DEVICE_TABLE` - DynamoDB table name (required if --env not provided)
- `STAGE` or `SERVERLESS_STAGE` - Used to determine table name if --env not provided
- `UPLOAD_TO_S3=true` - Enable S3 upload (alternative to --upload-s3 flag)
- `S3_BUCKET` - S3 bucket name (required for S3 upload)
- `REGION` - AWS region (default: us-east-1)

## Features

- **Efficient batch writes**: Uses `BatchWriteCommand` to write 25 items at a time (much faster than individual writes)
- **Single source of truth**: Reads directly from `src/utils/devices.json`
- **Type-safe**: Written in TypeScript with full type definitions
- **Optional S3 upload**: Can upload the JSON file to S3 after insertion

## Deployment (flag-controlled)

The seed runs in **post_build** only when **`SEED_META=true`** is set for that build. By default it is not set, so the seed is skipped on normal pipeline runs.

To seed via pipeline, set the environment variable when starting the build (e.g. in CodePipeline as an override for the CodeBuild project, or in CodeBuild console):

- **`SEED_META`** = `true` → run device list seed for that stage.

If the table does not exist yet (first deploy), the step may fail; run the insert script manually or re-run with the flag after the table exists.
