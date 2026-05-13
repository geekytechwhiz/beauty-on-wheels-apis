# event-platform (`@api-hub/event-platform`)

Long-form developer guide (consumers, middleware, observability, retries, DLQ): [`docs/engineering/EVENT_PLATFORM_DEVELOPER_GUIDE.md`](../../docs/engineering/EVENT_PLATFORM_DEVELOPER_GUIDE.md).

Shared layer for **canonical domain events**: wire shape (`BaseEvent` / `EventEnvelope`), Zod payload schemas, consumer validation and versioning, idempotency hooks, retry/DLQ policy, and helpers for SNS publishing and Lambda-style consumers (SQS batch, DynamoDB Streams).

Public API entry: `src/index.ts`.

---

## Canonical event shape (`BaseEvent`)

| Field | Role |
|-------|------|
| `eventId` | Unique id per occurrence (generated in `createBaseEvent` if omitted on publish). |
| `eventType` | Stable name; **handler routing** registry key. |
| `eventVersion` | Semver (e.g. `1.0.0`); schema resolution and version checks. |
| `timestamp` | ISO time. |
| `source` | Owning service (e.g. `user-service`). |
| `idempotencyKey` | Defaults to `eventId`; used before handler execution. |
| `payload` | Domain data; validated with Zod when schemas are registered. |
| `meta` | **Requires `correlationId`** after normalization; optional `traceId`, `tenantId`, `retryCount`, etc. |

**Contract rule:** Treat `eventType` + `eventVersion` + payload schema as the contract. Breaking changes → new major `eventVersion` (or new `eventType`) and a consumer migration plan.

---

## Defining events

Use `defineEvent(schema, meta)` (`src/core/schema/define-event.ts`) so schemas carry `__meta` (`eventType`, `eventVersion`, `source`). `createEventHandler` requires `__meta` on each schema.

- **`onEvent(schema, handler)`** — single-event wrapper (`src/lib/define-event-handler.ts`).
- **`createEventHandler`** — multi-event registry + `@api-hub/middleware` pipeline (`src/lib/create-event-handler.ts`).

---

## Publishing

**SNS helper (typical):** `createSnsPublishEvent` (`src/sdk/publisher/create-sns-publish-event.ts`) reads topic ARN from env, builds the envelope via `EventPublisher`, optional outbound schema validation, structured logs. Skips publish with a warning if the env var is unset.

**Core:** `EventPublisher` + `EventPublishAdapter` (`src/sdk/publisher/event-publisher.ts`); sets `correlationId` from logger context when omitted; stamps `publishedAt` / `schemaRef`.

**Checklist:** stable `source`; explicit `correlationId` when possible; deliberate `idempotencyKey` for deduplicated business operations; register `payloadSchemas` on producers when you want emit-time validation.

---

## Consuming

1. **`createSqsEventHandler`** — **SQS Lambda** first-class handler: typed `SQSBatchResponse`, SNS→SQS unwrap, per-message ALS, `transportMode: 'sqs-native'` defaults (`src/lib/create-sqs-event-handler.ts`). See `docs/engineering/SQS_CREATE_SQS_EVENT_HANDLER.md`.
2. **`consumeEvent(deps, registry, beforeDispatch?, consumeOptions?)`** — low-level; batch SQS via `extractRecords`, per-record `processSingle`; optional `deps.batchConcurrency`; optional **`deps.sqsFifoGroupScheduling`** so the same FIFO `MessageGroupId` runs serially within a batch while different groups respect `batchConcurrency`; optional `consumeOptions.wrapProcessSingle` for per-record wrapping (`src/engine/executor/consume-event.ts`).
3. **`createDynamoStreamHandler` / `onDynamoEvent`** — **DynamoDB Streams** with the same stack as SQS: `consumeEvent` → `processBatch` / `processSingle` → `orchestratePreparedConsumerEvent`, `transportMode: 'dynamodb-stream'`, per-record ALS, partial batch failures (`eventID`). See `docs/engineering/DYNAMODB_STREAM_RUNTIME.md`, `src/lib/create-dynamo-stream-handler.ts`, `src/dynamo-stream/`.
4. **`createEventHandler`** — preferred for EventBridge / single logical events when using the middleware stack; default deps include domain idempotency, retry, DLQ enabled.
5. **`EventConsumer`** — parse → prepare → orchestrate in one call; structured `HandleResult` or throws `RETRY_EVENT` for transport retry (`src/sdk/consumer/event-consumer.ts`).
6. **`createStreamHandler`** — legacy Dynamo path using `EventConsumer` directly; **deprecated** in favor of `createDynamoStreamHandler`.

**Legacy payloads:** use `mapRawToBaseEvent` in `parseInboundEvent` options or `EventConsumerDeps.mapRawToBaseEvent` when the body is not yet a full `BaseEvent`.

**Pipeline:** normalize meta → require `correlationId` → optional version check → optional Zod parse (`prepareInboundBaseEvent`) → idempotency `before` → handler by `eventType` → idempotency `afterSuccess` → on failure, `evaluateDeliveryPolicy` (retry / DLQ / discard) (`orchestrate-consumer-message.ts`).

---

## Idempotency

Default **`DomainIdempotencyStrategy`**: `before` proceeds when `eventId` exists; `afterSuccess` is a no-op — **handlers must make domain writes idempotent** (conditional writes, uniqueness). For cross-instance dedupe, use **`StoreIdempotencyStrategy`** + `IdempotencyStore` (see `src/infra/dynamodb-idempotency-store.ts`).

Assume **at-least-once** delivery; treat duplicate outcomes as business success where applicable.

---

## Retries, DLQ, non-retryable errors

Policy: `src/core/policy/delivery-policy.ts`. **`isNonRetryableHandlerError`** includes `BaseError` with `retryable === false`, `ZodError`, and common validation errors.

- With SQS receive count, the framework may **fail the Lambda** for queue-driven redelivery vs in-process loops.
- **`transportRetry`** → framework-managed republish; see `effectiveTransportMode` (`src/typings/consumer.types.ts`).
- **`EventConsumer.handle`** throws **`RETRY_EVENT`** for `retry_scheduled` / `needs_transport_retry` — surface that for partial batch / SQS semantics.

Use **`BaseError`** with **`retryable: false`** for permanent failures; align `retry`, `dlq`, and queue **maxReceiveCount** in AWS.

---

## Versioning

`assertVersionCompatible` (`src/core/versioning/version-compatibility.ts`) enforces same **major** and `strict` | `backward` | `forward` vs `supportedVersion`. **Forward** implies additive payload changes only; optional `deprecatedVersions` + `onDeprecated` on consumer `versionCheck`.

---

## Observability

Publishers: set **`meta.correlationId`** (or rely on context); `createBaseEvent` falls back to `eventId`. Consumers: optional **`EventTracingHooks`** on `EventConsumerDeps`. Metrics via `@api-hub/observability` from the orchestrator.

---

## Team checklist

1. Envelope: full `BaseEvent`; document `eventType` and semver `eventVersion`.
2. Schemas: `defineEvent` + Zod; register every supported version consumers must handle.
3. Publish: `createSnsPublishEvent` or `EventPublisher` + adapter; validate outbound when feasible.
4. Consume: `createEventHandler` / `onEvent` where possible; `mapRawToBaseEvent` for legacy.
5. Idempotency: safe domain writes or store-backed strategy.
6. Errors: `BaseError.retryable`; do not swallow validation errors inappropriately.
7. Ops: retry/DLQ config matches queue redrive; handle `RETRY_EVENT` and partial batch responses.

---

## Building

Run `nx build event-platform` to build the library.

## Running unit tests

Run `nx test event-platform` to execute the unit tests via [Jest](https://jestjs.io).
