---
name: dynamodb-streams
description: Generates and reviews DynamoDB Streams consumers in api-hub using createDynamoStreamHandler and onDynamoEvent from @api-hub/event-platform. Use when wiring stream Lambdas, MODIFY/INSERT routing, stream-to-event mapping, or partial batch failure handling.
---

# DynamoDB Streams — api-hub

## When to apply

- New stream consumer Lambda on a DynamoDB table
- Mapping table changes to domain events
- Reviewing stream handler reliability and idempotency

## Documentation

`docs/engineering/DYNAMODB_STREAM_RUNTIME.md` — full runtime behavior.

## API (use event-platform, not raw Records)

```typescript
import { defineEvent, createDynamoStreamHandler } from '@api-hub/event-platform';
import { z } from 'zod';

const ItemUpdatedSchema = defineEvent(
  z.object({ patientId: z.string() }),
  {
    eventType: 'Patient.Updated',
    eventVersion: '1.0.0',
    source: 'patients-svc',
    transport: 'sqs', // schema transport; stream uses dynamodb-stream at runtime
  },
);

export const handler = createDynamoStreamHandler({
  operation: 'patient.updated',
  consumer: { batchConcurrency: 10 },
  events: [
    {
      table: 'patients', // substring match on ARN table name
      eventName: ['MODIFY'],
      schema: ItemUpdatedSchema,
      handler: async (event) => {
        // flattened payload + event.meta
      },
    },
  ],
});
```

**DX shortcut**: `onDynamoEvent(schema, handler, { table, eventName })`.

## Runtime guarantees (do not bypass)

- Same pipeline as SQS/EventBridge: idempotency, delivery policy, DLQ, tracing, per-record ALS
- `normalizeDynamoStreamRecord` unmarshalls AttributeValues — handlers see plain objects
- No matching route → `StreamRecordFilteredError` → ack success (no batch failure)
- Handler failure → partial batch failure / transport retry (no in-process sleep retries)

## Generation workflow

```
- [ ] Identify table name(s) and stream view (NEW_AND_OLD_IMAGES if diff needed)
- [ ] List eventName filters: INSERT | MODIFY | REMOVE
- [ ] Map stream image → zod schema (prefer newImage fields)
- [ ] defineEvent metadata: eventType, eventVersion, source
- [ ] Business logic in service layer; handler orchestrates only
- [ ] serverless.yml: stream ARN, batch size, bisect batch on error
```

## Mapping guidelines

- Read from **newImage** for downstream actions; use oldImage only for diff/delete detection.
- Extract `correlationId` / trace fields from item if stored on records.
- Do not pass raw `DynamoDBRecord` to services.

## Idempotency

Stream deliveries are at-least-once. Reuse event-platform consumer idempotency or domain keys (`inputEventId`, etc.). Handlers must be safe on duplicate MODIFY.

## serverless.yml

```yaml
functions:
  onPatientStream:
    handler: src/handlers/streams/patient-updated.main
    events:
      - stream:
          type: dynamodb
          arn:
            Fn::GetAtt: [PatientsTable, StreamArn]
          batchSize: 10
          startingPosition: LATEST
          functionResponseType: ReportBatchItemFailures
```

Enable streams on the table with required view type before deploy.

## Review checklist

- [ ] Filtered routes do not throw for unrelated tables/operations
- [ ] REMOVE handled explicitly if tombstones matter
- [ ] No full-item logging of PHI
- [ ] `batchConcurrency` appropriate for downstream rate limits
- [ ] DLQ / alarm on repeated batch failures

## Anti-patterns

- Manual `Records` loop without event-platform orchestration
- Business logic in handler without service extraction
- Assuming INSERT-only when MODIFY is required
- Stream handler calling TransactWrite on same table without considering recursion (stream loops)
