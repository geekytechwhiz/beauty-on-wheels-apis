# Testing FHIR Gateway (Patient API)

## 1. Local run with your patient API

From repo root (or `services/fhir-gateway`):

```bash
cd services/fhir-gateway
cp .env.example .env
# Edit .env: set USER_SERVICE_URL to your get-user-details base URL, keep FHIR_GATEWAY_LOCAL_DEV=true
pnpm install   # or npm install
pnpm run offline:dev
```

**Hot reload (restart on file changes):**

```bash
pnpm run offline:dev:watch
```

This runs `nodemon` watching `src/` and `serverless.yml`; any change to `.ts`, `.js`, `.yml`, or `.json` restarts serverless offline.

Or with env inline:

```bash
USER_SERVICE_URL=https://v1w4b4vunl.execute-api.us-east-1.amazonaws.com/dev \
FHIR_GATEWAY_LOCAL_DEV=true \
pnpm run offline
```

Serverless-offline will print the base URL (e.g. `http://localhost:3000`). Stage is usually `dev`, so paths are under `/dev`.

## 2. Call GET /fhir/Patient/{id}

With **local dev** (`FHIR_GATEWAY_LOCAL_DEV=true`), any `Authorization: Bearer <token>` is accepted and given stub scopes + tenant.

```bash
# Replace PORT if different (often 3000) and use a real patient id from your API
curl -s -H "Authorization: Bearer local-test-token" \
  "http://localhost:3000/dev/fhir/Patient/01KGHK1MEGDMT1NJVYNK9YTRC7"
```

Expected: `200` and a FHIR Patient JSON (from your get-user-details response, mapped to FHIR). All keys in the response are in FHIR format (e.g. `resourceType`, `name[].family`, `name[].given`, `gender`, `birthDate`, `address`, etc.); the gateway does not return your domain keys—only the FHIR representation.

- **401** → Missing or invalid `Authorization: Bearer ...`
- **404** → Adapter returned null (wrong URL, wrong id, or get-user-details error)
- **403** → Scope/consent/tenant (unlikely when `FHIR_GATEWAY_LOCAL_DEV=true`)

### Why am I getting stub data ("Stub Patient") instead of real data?

The patient source is chosen **once at startup**. If `USER_SERVICE_URL` is empty when serverless offline starts, the **stub adapter** is used and you will always get stub data until you restart.

1. **Use a `.env` file** (the gateway uses `serverless-dotenv-plugin`, so `.env` is loaded when you run `serverless offline`):
   ```bash
   cp .env.example .env
   # Set USER_SERVICE_URL to your API base (e.g. https://v1w4b4vunl.execute-api.us-east-1.amazonaws.com/dev)
   ```
2. **Restart** the serverless process so the registry picks the user-service adapter:
   ```bash
   pnpm run offline:dev
   ```
3. Call `GET /dev/fhir/Patient/{id}` again; you should get FHIR built from your domain API (all FHIR keys in FHIR format).

## 3. Test with stub adapter (no backend)

To test without calling your real API:

```bash
# Unset USER_SERVICE_URL so the registry picks the stub adapter
USER_SERVICE_URL= \
PATIENT_SOURCE=stub \
FHIR_GATEWAY_LOCAL_DEV=true \
pnpm run offline
```

Then:

```bash
curl -s -H "Authorization: Bearer x" "http://localhost:3000/dev/fhir/Patient/any-id"
```

You should get a minimal FHIR Patient (stub data).

## 4. Unit tests (adapter / mapper)

From repo root, run tests for the fhir-gateway or the adapter (if you add specs):

```bash
pnpm test -- fhir-gateway
# or
pnpm test -- adapters/patient
```

To test the **mapper** only (your API response → canonical), you can add a small spec in `services/fhir-gateway/src/adapters/patient/user-service.patient.adapter.spec.ts` that calls `mapUserServiceResponseToCanonical` with a sample get-user-details payload.
