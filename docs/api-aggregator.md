# API Aggregator Service

Express + TypeScript backend merges OpenAPI specs from registered microservices. The Vite + React UI browses the merged document or a single service, with Swagger UI or Redoc.

## Prerequisites

- Node.js 20+
- pnpm (workspace root)

## Install

From the repository root:

```bash
pnpm install
```

## Configuration

### Service list

1. **File (default):** `backend/config/services.json` — array of `{ "name", "url", "module?", "rules?" }`.
2. **Env override:** `SERVICES_CONFIG` — JSON string with the same shape as the file (`{ "services": [ ... ] }`).
3. **Path override:** `SERVICES_CONFIG_PATH` — absolute or relative path to a JSON file.

### Environment

| Variable | Description |
|----------|-------------|
| `PORT` | Backend port (default `4000`). |
| `APP_ENV` | `dev` \| `staging` \| `prod` — affects CORS defaults and log level. |
| `NODE_ENV` | `production` tightens defaults when `APP_ENV` is unset. |
| `CORS_ORIGINS` | Comma-separated allowed origins (e.g. `https://docs.example.com`). In `dev`, defaults include `http://localhost:5173`. |
| `LOG_LEVEL` | Pino log level (default `debug` in dev, `info` in prod). |

### Frontend

| Variable | Description |
|----------|-------------|
| `VITE_API_BASE_URL` | API base URL (no trailing slash). **Express aggregator (local):** leave unset; Vite proxies `/api` → `http://localhost:4000`. **Serverless `api-aggregator-registry`:** set to your API Gateway base URL (e.g. `https://xxxx.execute-api.us-east-1.amazonaws.com`). The UI calls `GET /health`, `GET /services`, `GET /specs`, `GET /specs/{service}`, and `POST /services` (register). |

See also `frontend/.env.example`.

**Quick connect to deployed `api-aggregator-registry`:** from repo root run `pnpm aggregator:frontend:dev:registry` (or in `frontend/`: `pnpm dev:registry`), which sets `VITE_API_BASE_URL` to the current API Gateway host used in that script—update the URL in `frontend/package.json` if your stage/API id changes.

## Run locally

**Terminal 1 — backend** (from repo root):

```bash
pnpm aggregator:backend:dev
```

Or:

```bash
cd backend && pnpm dev
```

Ensure microservice URLs in `config/services.json` are reachable, or temporarily point them at mock OpenAPI JSON.

**Terminal 2 — frontend:**

```bash
pnpm aggregator:frontend:dev
```

Open `http://localhost:5173`. The UI calls `/api/*`, which Vite proxies to the backend.

**Production build:**

```bash
pnpm aggregator:backend:build && pnpm aggregator:frontend:build
```

Start the backend after build:

```bash
cd backend && pnpm start
```

Serve `frontend/dist` with any static host; set `VITE_API_BASE_URL` at build time to the public API base URL.

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | `{ "status": "ok" }` |
| GET | `/services` | Registered services (from config) |
| GET | `/specs` | Merged OpenAPI (cached 60s) |
| GET | `/specs/:service` | Single service spec (cached 60s) |

If one service fails to fetch, others are still merged; failures are logged and `X-Aggregator-Warnings` may be set on `/specs`.

## Custom OpenAPI extensions

Merged and single-service specs annotate paths and operations with:

- `x-service-name`
- `x-module` (when set in config)
- `x-rules` (when set in config)
