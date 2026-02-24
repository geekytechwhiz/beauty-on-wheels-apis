# Root-level device list (DEVICE_LIST)

Seed data for **pk=DEVICE_LIST**, **sk=CATEGORY#&lt;Category&gt;#&lt;DeviceId&gt;** (e.g. `CATEGORY#GlucoseMonitor#Contour7922H`) into `device-table-{env}` so all stages (dev/stg/prd) have the same canonical list.

## Source of truth

- **`data/device-list.json`** – array of DynamoDB items (pk, sk, sk3, sk4, category, deviceId, and all device attributes). Same payload for all envs.

## Regenerate from CSV

If you have an export CSV (e.g. from DynamoDB or the attached `results-7.csv`):

```bash
cd apps/device-service/scripts/device-list
node csv-to-json.js --input /path/to/results-7.csv --output data/device-list.json
```

Commit the updated `data/device-list.json`.

## Seed into an environment

From repo root (or with `DEVICE_TABLE` set):

```bash
cd apps/device-service/scripts/device-list
node insert-device-list.js --env dev    # or stg, prd
```

Optional:

- `--data path/to/device-list.json` (default: `data/device-list.json`)
- `--dry-run` – no DynamoDB writes
- `--region us-east-1`

## Deployment (flag-controlled)

The seed runs in **post_build** only when **`SEED_DEVICE_LIST=true`** is set for that build. By default it is not set, so the seed is skipped on normal pipeline runs.

To seed via pipeline, set the environment variable when starting the build (e.g. in CodePipeline as an override for the CodeBuild project, or in CodeBuild console):

- **`SEED_DEVICE_LIST`** = `true` → run device list seed for that stage.

If the table does not exist yet (first deploy), the step may fail; run the insert script manually or re-run with the flag after the table exists.
