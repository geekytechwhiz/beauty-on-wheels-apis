# @api-hub/observability

Enterprise-focused logging, metrics, and request context for Node.js and AWS Lambda. Designed to **cut CloudWatch volume**, **enforce structured logging**, and **avoid PII / full payload leaks** without coupling to any remote configuration service.

## Installation

```bash
pnpm add @api-hub/observability
```

Peer: `aws-lambda` (types for handlers).

Requires **Node.js ≥ 18** (uses `AsyncLocalStorage`, `crypto.randomUUID()`).

## Bootstrap (required)

Call **`initObservability()` once** per runtime (typically cold start) before `createLogger()` or metrics helpers. The library **does not read `process.env`**; map environment or remote config in your app:

```ts
import { initObservability, createLogger } from '@api-hub/observability';

initObservability({
  serviceName: process.env.SERVICE_NAME ?? 'local-dev-service',
  logLevel: 'INFO',
  sampling: { info: 0.25, debug: 0 },
  redactPII: true,
  enforceLogPolicy: true,
  metricsNamespace: 'ApiHub',
});
```

In this repo, **`ensureObservabilityInitialized()`** from `@api-hub/middleware` performs the env → config mapping for shared services.

Use **`updateObservabilityConfig(partial)`** to change behavior at runtime when your app loads new settings (AppConfig, SSM, etc.); the library does **not** fetch config from AWS.

## Logger

```ts
const log = createLogger();

log.info({
  event: 'order_placed',
  message: 'Order accepted',
  orderId: '…',
});

const child = createChildLogger(log, { tenantId: orgId });
```

- **Levels**: logs below the configured minimum level are dropped before sampling.
- **Sampling**: `ERROR` / `WARN` always pass; `INFO` / `DEBUG` use `Math.random()` against `sampling.info` / `sampling.debug` (after level filter).
- **Cold start**: first log on a Powertools logger instance includes `coldStart: true`.
- **Policy** (`enforceLogPolicy`): requires non-empty **`event`** and **`message`**. Top-level **`request`** / **`response`** fields are replaced with `[BLOCKED]` and a short warning — full HTTP dumps are not allowed.

String overloads (`log.info('hello')`) default `event` to `application_log`.

## Controlled logging (preferred)

Use these instead of ad-hoc structured logs for cross-cutting concerns:

- `logHttpRequest(logger, { method, path, statusCode, durationMs | duration, … })`
- `logDbQuery(logger, { operation, resource?, durationMs, … })` — do not pass raw SQL
- `logExternalCall(logger, { target, operation, durationMs, statusCode?, outcome?, … })` — no secrets in `target`

## Context

```ts
import { withLoggerContext, getLoggerContext } from '@api-hub/observability';

await withLoggerContext({ correlationId, tenantId }, async () => {
  // getLoggerContext() merges tenant/org aliases
});
```

## Lambda / HTTP wrappers

```ts
import { withLambdaObservability, withHttpObservability } from '@api-hub/observability';

export const handler = withLambdaObservability(async (event, context) => {
  // correlationId + awsRequestId in ALS (UUID if not on event)
});
```

`withHttpObservability` expects API Gateway–style `headers` / `requestContext`.

## Metrics (Powertools EMF)

`publishMiddlewarePipelineMetrics`, `recordConsumerEventProcessed`, etc. allocate a **new `Metrics` instance per call** (no global singleton). They read namespace and service name from config.

## PII

When `redactPII` is true, known sensitive keys are redacted recursively and common patterns (email, JWT-like strings, phones, Bearer tokens) are scrubbed in string values.

## Cost strategy

- Raise the **minimum log level** in production (`ERROR` or `WARN`).
- Lower **`sampling.info`** (e.g. `0.1`) for high-traffic success paths; keep `ERROR`/`WARN` unsampled.
- Rely on **`logHttpRequest`** / **`logExternalCall`** with small fields instead of logging full payloads.
- Avoid `DEBUG` in hot paths unless `sampling.debug` is non-zero.

## Public API surface

Exports are intentionally small: config, logger factory, context helpers, `serializeError`, controlled logging helpers, metrics publishers, and middleware wrappers. Internal utilities and Powertools instances are not exposed.

## Building

From the package root:

```bash
pnpm run build   # tsup → dist/*.js, *.cjs, *.d.ts
pnpm test        # Jest in test/
```
