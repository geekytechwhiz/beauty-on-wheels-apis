# DynamoDB Streams runtime (`createDynamoStreamHandler` / `onDynamoEvent`)

This document describes the **first-class DynamoDB Streams** consumer in `@api-hub/event-platform`. It mirrors the **SQS** path (`onQueue` / `createSqsEventHandler`): same **middleware pipeline**, **`createConsumerRuntime`**, **`consumeEvent` → `processBatch` → `processSingle` → `orchestratePreparedConsumerEvent`**, idempotency, delivery policy, DLQ, tracing, and **per-record AsyncLocalStorage**.

See also [EVENT_PLATFORM_TRANSPORTS_GUIDE.md](./EVENT_PLATFORM_TRANSPORTS_GUIDE.md) §6.

## Developer API

```typescript
import { defineEvent } from '@api-hub/event-platform';
import { createDynamoStreamHandler } from '@api-hub/event-platform';
import { z } from 'zod';

const PatientUpdatedSchema = defineEvent(
  z.object({ patientId: z.string() }),
  { eventType: 'Patient.Updated', eventVersion: '1.0.0', source: 'patients-svc', transport: 'sqs' },
);

export const handler = createDynamoStreamHandler({
  operation: 'patient.updated',
  consumer: { batchConcurrency: 10 },
  events: [
    {
      table: 'patients',
      eventName: ['MODIFY'],
      schema: PatientUpdatedSchema,
      handler: async (event) => {
        // event.patientId + event.meta — business only
      },
    },
  ],
});
```

```typescript
import { onDynamoEvent } from '@api-hub/event-platform';

export const handler = onDynamoEvent(PatientUpdatedSchema, async (event) => {
  // optional route: { table: /orders/, eventName: ['INSERT'] }
});
```

## Architecture (reuse)

| Piece | Role |
|-------|------|
| `buildEventExecutionPipeline` | `asyncError`, `context`, `invocationContext`, `logger`, `tracer`, `performance` middleware — same as SQS/EventBridge. |
| `consumeEvent` | Batch `Records` extraction; `wrapProcessSingle` for per-record ALS. |
| `processBatch` | Concurrency + partial batch aggregation (`eventID` identifiers). |
| `processSingle` | `mapRawToBaseEvent` → `prepareInboundBaseEvent` → `orchestratePreparedConsumerEvent`. |
| `transportMode: 'dynamodb-stream'` | Enables **surface retry** path (`runSingleHandlerAttempt`) like SQS-native: handler failures map to `needs_transport_retry` without in-process retry **sleeps** (redelivery via Lambda partial batch). |
| `StreamRecordFilteredError` | No matching route → **acked success** (no `batchItemFailure`); metric `DynamoStreamRecordsFiltered`. |

## Normalized record

`NormalizedDynamoStreamEvent` (`src/dynamo-stream/normalized-dynamo-stream-event.ts`) holds unmarshalled **keys / oldImage / newImage**, stream metadata, optional **correlationId / traceId / causationId** from item fields, and **`rawRecord`** for DLQ.

`normalizeDynamoStreamRecord` (`normalize-dynamo-stream-record.ts`) uses **`@aws-sdk/util-dynamodb` `unmarshall`** — AttributeValue maps are not passed to business handlers.

## Routing

- **`table`**: substring (case-insensitive), `RegExp`, or predicate on the name parsed from `eventSourceARN`.
- **`eventName`**: single operation, array, or predicate (`INSERT` / `MODIFY` / `REMOVE`).
- First matching route wins (declare more specific routes first).

## Payload → `BaseEvent.payload`

- **INSERT / MODIFY**: prefer **NewImage**, then OldImage, then keys.
- **REMOVE**: **OldImage**, then keys.

## Observability

- **`DynamoStreamBatchRecordsReceived`** — batch size per invoke.
- **`DynamoStreamRecordsFiltered`** — routed-away records.
- Existing **consumer** metrics (`TotalEventsProcessed`, retries, DLQ, etc.) from orchestration.

## Transport mode

`TransportMode` includes **`dynamodb-stream`** (`delivery-policy.ts`). `effectiveTransportMode` unchanged unless set explicitly (streams handler sets it by default).

## Risks & follow-ups (P0 / P1 / P2)

| Tier | Item |
|------|------|
| **P0** | **Cross-invoke `retry.maxAttempts`** still does not increment like SQS `ApproximateReceiveCount`; exhaustion is driven by **Lambda event source mapping** max retry + DLQ. Document for operators. |
| **P1** | **Shard-ordered processing** within a batch is not serialized (same as default `processBatch`); strict per-shard ordering needs **batchSize 1** or a future shard-aware scheduler (similar to FIFO SQS). |
| **P1** | **MODIFY** payloads use **NewImage only** by default; handlers needing **old+new** should read from `meta.attributes` or extend `mapRawToBaseEvent`. |
| **P2** | Generalize **`NormalizedStreamEvent`** for Kinesis/Kafka behind the same `mapRawToBaseEvent` + `transportMode` pattern. |
| **P2** | Richer metrics: iterator age, shard id (when exposed), per-`eventName` breakdown. |

## Legacy

`createStreamHandler` remains but is **deprecated**; it used `EventConsumer` directly and did not share `processBatch` / `processSingle` semantics.
