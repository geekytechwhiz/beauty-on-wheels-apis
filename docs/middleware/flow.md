# Middleware execution flow

## HTTP API (`buildApiExecutionPipeline`)

Incoming request

1. `httpApiErrorMiddleware` (outermost wrapper)
2. `contextMiddleware`
3. `invocationContextMiddleware`
4. `loggerMiddleware`
5. `tracerMiddleware`
6. `requestParserMiddleware`
7. `schemaValidationMiddleware` (optional)
8. `performanceMiddleware`
9. Business handler

## Async events (`buildEventExecutionPipeline`)

Incoming event

1. `asyncErrorMiddleware` (outermost wrapper)
2. `contextMiddleware`
3. `invocationContextMiddleware`
4. `loggerMiddleware`
5. `tracerMiddleware`
6. `performanceMiddleware`
7. `realtimeMiddleware` (optional; only when `realtime.enabled` on `createEventHandler`)
8. Business handler (`consumeEvent` → per-record idempotency, schema, retry, handler)

`realtimeMiddleware` calls `next()` first (steps 8 complete), then drains per-invocation successes collected inside `@api-hub/event-platform` after handler + idempotency `afterSuccess`. Realtime failures are logged and never fail the invocation.

Reliability (idempotency, retry, DLQ, transport outcome mapping) belongs in `@api-hub/event-platform`, not in the HTTP/async middleware stack.

### Realtime sequence (direct publish, `aggregate=false`)

```mermaid
sequenceDiagram
  participant MW as MiddlewareStack
  participant CE as consumeEvent
  participant OR as orchestratePreparedConsumerEvent
  participant COL as RealtimeInvocationCollector
  participant RS as RealtimeEventService
  participant RP as RealtimePublisher

  MW->>CE: next() inner handler
  CE->>OR: per record
  OR->>OR: idempotency before
  OR->>OR: business handler
  OR->>OR: idempotency afterSuccess
  OR->>COL: push(baseEvent) if realtime.enabled
  CE-->>MW: result
  MW->>COL: drain pending
  MW->>RS: process each event
  RS->>RP: publish([message])
  RP->>SRP: SocketRealtimePublisher when REALTIME_SOCKET_ENABLED
  SRP->>SS: ApiGatewaySocketService
  SS->>API: postToConnection
```

### Socket transport architecture (`REALTIME_SOCKET_ENABLED=true`)

```mermaid
flowchart TD
  subgraph publisher [RealtimePublisher]
    SRP[SocketRealtimePublisher]
    SRP --> SS[SocketService]
    SS --> AGS[ApiGatewaySocketService]
    AGS --> CR[ConnectionResolver]
    CR --> NCR[NoopConnectionResolver]
    AGS --> APIGW[ApiGatewayManagementApi postToConnection]
    APIGW --> Clients[Web / Mobile]
  end
```

When `REALTIME_SOCKET_ENABLED` is not `true`, `resolveSocketRealtimePublisher()` returns `NoopRealtimePublisher` (safe default for tests and local).

Environment variables:

- `REALTIME_SOCKET_ENABLED` — enable socket fan-out (default off)
- `WEBSOCKET_API_ENDPOINT` — API Gateway Management API URL for `postToConnection`

### Socket publish sequence

```mermaid
sequenceDiagram
  participant SRP as SocketRealtimePublisher
  participant SS as ApiGatewaySocketService
  participant CR as ConnectionResolver
  participant API as ApiGatewayManagementApi

  SRP->>SRP: derive destinations from RealtimeMessage
  loop each destination
    SRP->>SS: publish(destination, envelope)
    SS->>CR: resolve(destination)
    CR-->>SS: connectionIds
    alt no connections
      SS->>SS: log and continue
    else
      loop each connectionId
        SS->>API: postToConnection
      end
    end
  end
```

### Recipient routing examples (socket destinations)

| Input on `RealtimeMessage` | Socket destination key |
|----------------------------|-------------------------|
| `recipientIds: ['DOC123']` | `USER#DOC123` |
| `payload.organizationId: 'ORG1'`, `channel: 'TEAM_ALERTS'` | `ORG#ORG1#TEAM_ALERTS` |
| `payload.patientId: 'PAT001'` | `PATIENT#PAT001` |

Helper: `buildSocketDestinationKey()` in `@api-hub/event-platform`. Connection lookup is via `ConnectionResolver` (currently `NoopConnectionResolver` returning `[]` until a connection repository exists).

### Realtime aggregation architecture (`aggregate=true`)

```mermaid
flowchart TD
  subgraph producer [Producer Lambda]
    BH[BusinessHandler success]
    RTM[realtimeMiddleware]
    RES[RealtimeEventService]
    RAP[RealtimeAggregationPublisher]
    RP[RealtimePublisher]
    BH --> RTM --> RES
    RES -->|aggregate=false| RP
    RES -->|aggregate=true| RAP
  end

  subgraph sqs [SQS Transport]
    Q[RealtimeAggregationQueue]
    RAP -->|EventPublisher + SqsAdapter| Q
  end

  subgraph consumer [Consumer Lambda event-platform infra]
    Q --> H[realtimeAggregationSqsHandler]
    H --> RAS[RealtimeAggregationService]
    RAS --> RP2[resolveInfrastructureRealtimePublisher]
    RP2 --> SRP2[SocketRealtimePublisher]
    SRP2 --> SS2[ApiGatewaySocketService]
  end
```

### Realtime aggregation sequence (`aggregate=true`)

```mermaid
sequenceDiagram
  participant MW as realtimeMiddleware
  participant RS as RealtimeEventService
  participant EP as EventPublisher
  participant SA as SqsAdapter
  participant Q as AggregationQueue
  participant H as createRealtimeAggregationConsumer
  participant AG as RealtimeAggregationService
  participant RP as RealtimePublisher

  MW->>RS: process after handler success
  RS->>EP: publish RealtimeAggregateMessage
  EP->>SA: BaseEvent envelope
  SA->>Q: SendMessage
  Note over Q: batchSize=20, maxBatchingWindow=2s
  Q->>H: Lambda batch invoke
  loop each record in batch
    H->>H: record message
  end
  H->>AG: groupAndPublish(drained)
  AG->>AG: group by orgId#channel#type
  AG->>RP: publish aggregated RealtimeMessage per group
```

### SQS aggregation flow (retry + DLQ)

```mermaid
flowchart LR
  subgraph main [Main Queue]
    M1[Message 1]
    M2[Message 2]
  end
  subgraph lambda [Lambda ESM]
    BS[batchSize 20]
    BW[maximumBatchingWindow 2s]
    FR[ReportBatchItemFailures]
  end
  subgraph retry [SQS-native retry]
    RC[ApproximateReceiveCount]
    MA[maxReceiveCount 3]
  end
  subgraph dlq [DLQ]
    DLQ[RealtimeAggregationDLQ]
    STR[SqsDlqStrategy optional app DLQ]
  end

  main --> lambda
  lambda -->|needs_transport_retry| main
  lambda -->|success| ack[Delete message]
  RC --> MA
  MA --> DLQ
  lambda -->|terminal dead_letter| STR
```

No `DelaySeconds` — batching uses Lambda ESM `MaximumBatchingWindowInSeconds` only.

### Example producer: `createEventHandler` with aggregation

```ts
import {
  createEventHandler,
  createRealtimeAggregationPublisher,
} from '@api-hub/event-platform';

const aggregationPublisher = createRealtimeAggregationPublisher({
  queueUrl: process.env.REALTIME_AGGREGATION_QUEUE_URL,
});

createEventHandler({
  operation: 'alert.created',
  consumer: {
    realtimePublisher: myRealtimePublisher,
    realtimeAggregationPublisher: aggregationPublisher,
  },
  realtime: {
    enabled: true,
    aggregate: true,
    resolver: new AlertRecipientResolver(),
    transformer: new AlertTransformer(),
  },
  events: [{ schema: AlertSchema, handler: handleAlert }],
});
```

### Platform aggregation consumer (infrastructure — not domain services)

The aggregation SQS queue has **one shared consumer** owned by `@api-hub/event-platform`. Domain services (alert-service, etc.) only **publish** to the queue when `realtime.aggregate=true`; they must not deploy their own SQS consumer.

**Lambda handler** (deploy once per environment):

```ts
// libs/event-platform/src/handlers/realtime-aggregation-sqs.handler.ts
export const handler = createDefaultRealtimeAggregationConsumer();
```

**Serverless wiring:**

```yaml
onRealtimeAggregate:
  handler: ../../libs/event-platform/src/handlers/realtime-aggregation-sqs.handler.main
  events:
    - sqs:
        arn: !GetAtt RealtimeAggregationQueue.Arn
        batchSize: 20
        maximumBatchingWindow: 2
        functionResponseType: ReportBatchItemFailures
```

Final delivery transport: `resolveInfrastructureRealtimePublisher()` → `resolveSocketRealtimePublisher()` → `SocketRealtimePublisher` → `ApiGatewaySocketService` when `REALTIME_SOCKET_ENABLED=true`; otherwise `NoopRealtimePublisher`.

### Advanced: custom consumer options

```ts
import { createRealtimeAggregationConsumer } from '@api-hub/event-platform';

export const handler = createRealtimeAggregationConsumer({
  consumer: { batchConcurrency: 10 },
});
```

Grouping key: `{organizationId}#{channel}#{eventType}` (e.g. `ORG1#TEAM_ALERTS#TEAM_ALERTS_UPDATED`).

Aggregated payload shape: `{ type: eventType, count: N }`.

### SQS IaC example

```yaml
RealtimeAggregationQueue:
  Type: AWS::SQS::Queue
  Properties:
    VisibilityTimeout: 180
    RedrivePolicy:
      deadLetterTargetArn: !GetAtt RealtimeAggregationDLQ.Arn
      maxReceiveCount: 3

RealtimeAggregationEventSourceMapping:
  Type: AWS::Lambda::EventSourceMapping
  Properties:
    EventSourceArn: !GetAtt RealtimeAggregationQueue.Arn
    BatchSize: 20
    MaximumBatchingWindowInSeconds: 2
    FunctionResponseTypes:
      - ReportBatchItemFailures
```

Environment variables:

- Producer: `REALTIME_AGGREGATION_QUEUE_URL`
- Socket: `REALTIME_SOCKET_ENABLED`, `WEBSOCKET_API_ENDPOINT`
- Consumer DLQ: `DLQ_QUEUE_URL` / `EVENT_DLQ_QUEUE_URL`

Metrics emitted during aggregation:

- `aggregationEventsReceived`
- `aggregationGroupsCreated`
- `aggregationEventsPublished`
