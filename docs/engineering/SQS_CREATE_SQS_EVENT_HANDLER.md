# SQS Lambda: `createSqsEventHandler`

## Purpose

`createSqsEventHandler` is the **first-class** entry point for **Lambda + SQS** consumers. It mirrors `createEventHandler` DX while:

- Returning a typed **`SQSBatchResponse`** (partial batch failures).
- Parsing **SQS** records and **SNS → SQS** subscription envelopes via shared transport normalization + `parseInboundEvent`.
- Defaulting **`transportMode: 'sqs-native'`** so retry/DLQ decisions align with **ApproximateReceiveCount** and queue redrive.
- Scoping **AsyncLocalStorage** per **SQS message** for safe **concurrent** `processBatch` workers (`messageId`, `correlationId`, FIFO fields, receive count).

Orchestration stays in **`consumeEvent` → `processSingle` → `orchestratePreparedConsumerEvent`** (no duplicated policy logic).

For **production readiness** (retry, DLQ, FIFO, visibility, observability, alarms, and test gaps), see [SQS_PRODUCTION_READINESS.md](./SQS_PRODUCTION_READINESS.md).

## Example (new code)

```typescript
import type { SQSEvent, Context, SQSBatchResponse } from 'aws-lambda';
import { z } from 'zod';
import { createSqsEventHandler, defineEvent } from '@api-hub/event-platform';

const AlertCreatedSchema = defineEvent(
  z.object({ alertId: z.string() }),
  {
    eventType: 'Alert.Created',
    eventVersion: '1.0.0',
    source: 'alerts-svc',
    transport: 'sqs',
  },
);

export const handler = createSqsEventHandler({
  operation: 'alert.created',
  events: [
    {
      schema: AlertCreatedSchema,
      handler: async (event) => {
        // `event` is flattened payload + `meta` (same runtime shape as createEventHandler)
        await notify(event.alertId, event.meta.correlationId);
      },
    },
  ],
});
```

## Migration from `createEventHandler` + manual SQS mapping

**Before** (manual wire → `BaseEvent`, easy to forget partial-batch typing):

```typescript
import { createEventHandler, parseInboundEvent } from '@api-hub/event-platform';

export const handler = createEventHandler({
  operation: 'alert.created',
  consumer: {
    mapRawToBaseEvent: (raw) => parseInboundEvent(raw),
    batchConcurrency: 5,
  },
  events: [{ schema: AlertCreatedSchema, handler: async (e) => { ... } }],
});
```

**After** (typed `SQSBatchResponse`, defaults applied):

```typescript
import { createSqsEventHandler } from '@api-hub/event-platform';

export const handler = createSqsEventHandler({
  operation: 'alert.created',
  consumer: { batchConcurrency: 5 },
  events: [{ schema: AlertCreatedSchema, handler: async (e) => { ... } }],
});
```

**Notes:**

- Keep using **`consumer`** for overrides (`idempotencyStrategy`, `retry`, `dlq`, `tracing`, `mapRawToBaseEvent` for legacy payloads).
- For **EventBridge** or non-SQS shapes, continue using **`createEventHandler`**.
- Advanced: **`ConsumeEventOptions.wrapProcessSingle`** is available on **`consumeEvent`** for other transports or custom ALS (see package exports).

## Visibility timeout heartbeat

Long-running handlers can exceed the queue’s **visibility timeout**, causing another consumer to receive the same message while work is still in flight. **`createSqsEventHandler`** can wrap each record with **`runWithSqsVisibilityHeartbeat`**, which periodically calls **`ChangeMessageVisibility`** using the record’s **`receiptHandle`** and a configured **`queueUrl`**, and uses **`context.getRemainingTimeInMillis()`** to stop extending before the Lambda invoke freezes.

### Enabling on `createSqsEventHandler`

- **`visibilityHeartbeat: true`** — resolves **`queueUrl`** from **`SQS_QUEUE_URL`** or **`SQS_QUEUE`** (first non-empty wins after trim).
- **`visibilityHeartbeat: { ... }`** — optional **`queueUrl`**, **`visibilityExtensionSeconds`** (default 900, capped at SQS max), **`heartbeatIntervalMs`** (default 25000, minimum 1000; each tick adds up to 2s jitter to avoid synchronized bursts), **`minRemainingMsToExtend`** / **`minRemainingMsHardStop`**, shared **`client`** / **`region`**, and **`hooks`** (tracing / custom telemetry).
- **`visibilityHeartbeat: false`** or **`{ enabled: false }`** — off.

Behavior:

- **One controller per SQS record** — safe with **`batchConcurrency` > 1** (FIFO and standard queues; FIFO does not need a separate API path).
- **At most one in-flight `ChangeMessageVisibility` per message** — extensions are serialized on an internal chain so duplicate loops do not stack.
- **Stops** when the handler **`run()`** resolves or rejects, when remaining time falls below the hard-stop threshold, or when **`stop()`** runs (e.g. **`runWithSqsVisibilityHeartbeat`** `finally`).
- **Structured logs** (via **`getLogger`**): **`sqs_visibility_extended`**, **`sqs_visibility_extend_failed`**, **`sqs_visibility_heartbeat_skip`**, **`sqs_visibility_heartbeat_stopped_near_timeout`** (`logType: 'sqs_visibility_heartbeat'`).
- **Metrics** ( **`@api-hub/observability`** ): **`SqsVisibilityExtensions`** (dimension **`Outcome`**: Success / Failure), **`SqsVisibilityHeartbeatsSkipped`** (**`Reason`**), **`SqsVisibilityHeartbeatLoopsEnded`** (**`Reason`**).
- **Hooks**: **`onVisibilityExtended`**, **`onVisibilityExtendFailed`**, **`onHeartbeatStopped`** — keep side effects light; failures in hooks are swallowed.

### Manual / `consumeEvent` integration

If you do not use **`createSqsEventHandler`**, wrap **`processSingle`** from **`consumeEvent`** with the same pattern inside **`wrapProcessSingle`**, closing over Lambda **`context`**:

```typescript
import type { SQSEvent, Context, SQSBatchResponse } from 'aws-lambda';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  consumeEvent,
  resolveSqsVisibilityHeartbeatConfig,
  runWithSqsVisibilityHeartbeat,
} from '@api-hub/event-platform';

const sqs = new SQSClient({});

export function createHandler(deps: Parameters<typeof consumeEvent>[0], registry: Parameters<typeof consumeEvent>[1]) {
  return async (event: SQSEvent, context: Context): Promise<SQSBatchResponse> => {
    const consumed = consumeEvent(deps, registry, undefined, {
      wrapProcessSingle: async ({ raw, run }) => {
        const hb = resolveSqsVisibilityHeartbeatConfig({
          rawRecord: raw,
          queueUrl: process.env.SQS_QUEUE_URL,
          getRemainingTimeInMillis: () => context.getRemainingTimeInMillis(),
          client: sqs,
        });
        if (!hb) {
          return run();
        }
        return runWithSqsVisibilityHeartbeat(hb, run);
      },
    });
    return consumed(event) as Promise<SQSBatchResponse>;
  };
}
```

## FIFO-aware batch scheduling

When **`fifoGroupScheduling: true`** (or **`consumer.sqsFifoGroupScheduling: true`**), **`processBatch`** schedules work so that records sharing the same FIFO **`MessageGroupId`** run **one after another** inside the Lambda batch, while **different** groups (and standard-queue messages, each treated as its own lane) run with up to **`consumer.batchConcurrency`** handlers **in parallel**.

- **Ordering**: Within a lane, records run in **batch array order**. If an earlier record in that lane is not acked (for example **`needs_transport_retry`**), **later records in the same lane are not executed** in this invocation; they are reported in **`batchItemFailures`** so they are not deleted (same partial-batch semantics as a strict serial consumer).
- **Poison isolation**: Set **`fifoPoisonReceiveCountThreshold`** (or **`consumer.sqsFifoPoisonReceiveCountThreshold`**) together with FIFO scheduling. When **`ApproximateReceiveCount`** is at or above the threshold, the handler is **not** invoked for that message; it is failed fast with **`needs_transport_retry`**, and any **same-lane** tails are deferred with reason **`poison_receive_count_threshold`** (metrics + tracing).
- **Observability**: Structured logs **`sqs_fifo_batch_schedule`**, **`sqs_fifo_batch_tail_deferred`**, **`sqs_fifo_batch_poison_short_circuit`** (`logType: 'sqs_fifo_batch'`). Metrics **`SqsFifoBatchScheduleSnapshots`**, **`SqsFifoBatchTailsDeferred`**, **`SqsFifoBatchPoisonShortCircuits`**. Tracing hook **`onFifoBatchTailDeferred`** on **`EventTracingHooks`** (see **`fireFifoBatchTailDeferred`**).

```typescript
export const handler = createSqsEventHandler({
  operation: 'orders.updated',
  fifoGroupScheduling: true,
  fifoPoisonReceiveCountThreshold: 8,
  consumer: { batchConcurrency: 10 },
  events: [{ schema: OrderUpdatedSchema, handler: async (e) => { ... } }],
});
```

## FIFO and retry metadata

FIFO identifiers and **ApproximateReceiveCount** are attached to **per-message** logger context (`getContext()` inside the handler) when present on the record. Delivery policy still uses existing **`computeEffectiveDeliveryAttempt`** inside orchestration.

## Error handling

- **Malformed JSON** or invalid **BaseEvent**: preparation failures flow through existing **`handlePreparationFailure`** (DLQ / retry policy).
- **Handler throws**: SQS-native path surfaces **`needs_transport_retry`** until attempts exhausted, then **`batchItemFailures`** stops including the id when the outcome is acked without failure (e.g. duplicate, dead-letter strategy paths) per existing **`isAckedWithoutBatchFailure`** rules.
