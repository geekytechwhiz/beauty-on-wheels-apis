# Engineering — Event platform & async messaging

Documentation for **`@api-hub/event-platform`**, **`@api-hub/middleware`**, and **`@api-hub/observability`** as used together for publish/consume, retries, DLQ, and metrics.

---

## Start here

| Document | Read when |
|----------|-----------|
| **[EVENT_PLATFORM_TRANSPORTS_GUIDE.md](./EVENT_PLATFORM_TRANSPORTS_GUIDE.md)** | **Primary handbook** — step-by-step EventBridge, SQS, DynamoDB Streams, publish, **correlation ID**, idempotency, observability |
| **[IDEMPOTENCY_EVENT_PLATFORM_VS_MIDDLEWARE.md](./IDEMPOTENCY_EVENT_PLATFORM_VS_MIDDLEWARE.md)** | **Idempotency split** — layer table: async (`event-platform`) vs HTTP (`middleware`) |
| [EVENT_PLATFORM_DEVELOPER_GUIDE.md](./EVENT_PLATFORM_DEVELOPER_GUIDE.md) | Deep dive: orchestration internals, versioning, troubleshooting |
| [EVENT_DRIVEN_DEVELOPMENT_GUIDE.md](./EVENT_DRIVEN_DEVELOPMENT_GUIDE.md) | Narrative EDD guide and migration patterns |
| [SQS_CREATE_SQS_EVENT_HANDLER.md](./SQS_CREATE_SQS_EVENT_HANDLER.md) | SQS: visibility heartbeat, FIFO, partial batch |
| [DYNAMODB_STREAM_RUNTIME.md](./DYNAMODB_STREAM_RUNTIME.md) | Streams: normalization, routing, filtered records |
| [SQS_PRODUCTION_READINESS.md](./SQS_PRODUCTION_READINESS.md) | SQS ops checklist |

Package overview: [`libs/event-platform/README.md`](../../libs/event-platform/README.md).

---

## Unified consumer API (2025+ runtime)

All Lambda consumers use **`createConsumerRuntime`** + a **transport profile** + **`buildEventExecutionPipeline`** (middleware).

| Transport | Handler factory |
|-----------|-----------------|
| EventBridge | **`onEvent`** (`createEventHandler`) |
| SQS | **`onQueue`** (`createSqsEventHandler`) |
| DynamoDB Streams | **`onDynamoEvent`** / **`createDynamoStreamHandler`** |

**Removed / deprecated:** DX consume `onEvent(schema)` (EventConsumer singleton), `createStreamHandler`, separate idempotency-only tables when domain conditional writes suffice.

---

## Publishing

| Pattern | Services | Entry |
|---------|----------|--------|
| SNS topic | user-service, device-service | `createSnsPublishEvent` |
| EventBridge bus | alert-service | `configureEventPlatform` + `publishEvent` |

---

## Cross-cutting standards

### Idempotency

- **Comparison table:** [IDEMPOTENCY_EVENT_PLATFORM_VS_MIDDLEWARE.md](./IDEMPOTENCY_EVENT_PLATFORM_VS_MIDDLEWARE.md)
- **Async (event-platform):** default **`DomainIdempotencyStrategy`** — handler/domain must dedupe (conditional DynamoDB writes, `{ duplicate: true }`). Optional **`StoreIdempotencyStrategy`** + `DynamoDbIdempotencyStore` for cross-instance pre-handler dedupe.
- **HTTP:** **no** idempotency middleware in `@api-hub/middleware` — use **domain conditional writes** (no HTTP `IDEMPOTENCY_TABLE`).

### Observability

- **Middleware:** logger, tracer, performance, `correlationId` ALS on every Lambda.
- **Consumers:** per-record ALS + metrics (`TotalEventsProcessed`, `DuplicateEvents`, `ProcessingFailures`, …).
- **Publishers:** pass `meta.correlationId`; use `recordPublishFailure` on non-fatal publish errors.

### DLQ

- **AWS layer:** SQS redrive, EventBridge `onFailure`, stream mapping on-failure destination.
- **App layer:** `createDefaultSqsDlqStrategy()` + `dlq.enabled: true` for explicit terminal DLQ sends.

---

## Reference implementation

**alert-service** (EventBridge consume + EventBridge publish):

- Consumer: [`createAlertConsumer.ts`](../../apps/alert-service/src/handlers/events/consumer/event-bridge/createAlertConsumer.ts) — `onEvent` + domain idempotency + `SqsDlqStrategy`
- Publish bootstrap: [`event-runtime.ts`](../../apps/alert-service/src/handlers/events/bootstrap/event-runtime.ts)
- Publisher: [`alert-publisher.ts`](../../apps/alert-service/src/handlers/events/publisher/alert-publisher.ts) — `publishEvent` + `recordPublishFailure`
- Infra: [`serverless.yml`](../../apps/alert-service/serverless.yml) — `maximumRetryAttempts`, `destinations.onFailure`, DLQ queue

---

## Build & test

```bash
nx build event-platform
nx test event-platform
```
