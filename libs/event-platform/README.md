# event-platform (`@api-hub/event-platform`)

**Handbook:** [`docs/engineering/EVENT_PLATFORM_TRANSPORTS_GUIDE.md`](../../docs/engineering/EVENT_PLATFORM_TRANSPORTS_GUIDE.md) — step-by-step EventBridge, SQS, DynamoDB Streams, publish, idempotency, observability.

Full developer guide: [`docs/engineering/EVENT_PLATFORM_DEVELOPER_GUIDE.md`](../../docs/engineering/EVENT_PLATFORM_DEVELOPER_GUIDE.md).

Shared layer for **canonical domain events**: wire shape (`BaseEvent` / `EventEnvelope`), Zod payload schemas, consumer validation and versioning, idempotency hooks, retry/DLQ policy, and Lambda consumer factories (EventBridge, SQS, DynamoDB Streams).

Public API entry: `src/index.ts`.

---

## Handler entry points

| Transport | API |
|-----------|-----|
| EventBridge | **`onEvent({ operation, events, consumer? })`** |
| SQS | **`onQueue({ operation, events, consumer? })`** |
| DynamoDB Streams | **`onDynamoEvent`** / **`createDynamoStreamHandler`** |

All use **`createConsumerRuntime`** + transport profile + **`buildEventExecutionPipeline`** from `@api-hub/middleware`.

---

## Canonical event shape (`BaseEvent`)

| Field | Role |
|-------|------|
| `eventId` | Unique id per occurrence |
| `eventType` | Stable name; handler routing key |
| `eventVersion` | Semver; schema resolution |
| `timestamp` | ISO time |
| `source` | Owning service |
| `idempotencyKey` | Defaults to `eventId` on publish |
| `payload` | Domain data (Zod via `defineEvent`) |
| `meta` | **`correlationId` required** after normalization |

---

## Defining events

```typescript
import { defineEvent } from '@api-hub/event-platform';

export const MyEventSchema = defineEvent(payloadSchema, {
  eventType: 'My.Event',
  eventVersion: '1.0.0',
  source: 'my-service',
  transport: 'eventbridge', // or sns | sqs
});
```

---

## Publishing

| Pattern | API |
|---------|-----|
| SNS topic | `createSnsPublishEvent({ topicArnEnvKey, source })` |
| EventBridge | `configureEventPlatform({ publishers })` + `publishEvent(schema, payload)` |

Use `recordPublishFailure` from `@api-hub/observability` for non-critical outbound errors.

---

## Consuming

1. **`onEvent`** — EventBridge; `eventBridgeTransportProfile` unwraps `detail`.
2. **`onQueue`** — SQS batch + partial failures; see [SQS guide](../../docs/engineering/SQS_CREATE_SQS_EVENT_HANDLER.md).
3. **`createDynamoStreamHandler` / `onDynamoEvent`** — DynamoDB Streams; see [Streams guide](../../docs/engineering/DYNAMODB_STREAM_RUNTIME.md).

**Deprecated:** `createStreamHandler`, DX consume `onEvent(schema)`.

---

## Idempotency

Default **`DomainIdempotencyStrategy`**: handlers must use conditional domain writes or explicit duplicate handling. Optional **`StoreIdempotencyStrategy`** + `DynamoDbIdempotencyStore` for cross-instance dedupe.

Reference: alert-service — `EVENT#` conditional put + `{ duplicate: true }` in domain service.

---

## DLQ

- **AWS:** SQS redrive, EventBridge `destinations.onFailure`, stream on-failure destination.
- **App:** `createDefaultSqsDlqStrategy()` + `dlq.enabled: true`.

---

## Observability

- Middleware: logger, tracer, performance, `correlationId` ALS.
- Consumers: per-record ALS + metrics from `@api-hub/observability`.
- Publishers: `meta.correlationId`; `recordPublishFailure` / `recordPublishSuccess`.

---

## Build & test

```bash
nx build event-platform
nx test event-platform
```
