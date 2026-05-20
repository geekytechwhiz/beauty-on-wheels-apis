Enterprise event runtime upgrade

Phase 1 — Architecture review (current state)

Current architecture

flowchart TB
  subgraph lambda [Lambda invocation]
    MW["@api-hub/middleware buildEventExecutionPipeline"]
    Factory["createEventHandler / createSqsEventHandler / createDynamoStreamHandler"]
    CE["consumeEvent"]
    MW --> Factory --> CE
  end
  subgraph records [Record path]
    ER["extractRecords"]
    PB["processBatch"]
    PS["processSingle"]
    CE --> ER
    ER -->|Records| PB
    ER -->|no Records| PS
    PB --> PS
  end
  subgraph core [Shared orchestration]
    PREP["prepareInboundBaseEvent"]
    ORCH["orchestratePreparedConsumerEvent"]
    POL["evaluateDeliveryPolicy + idempotency + DLQ executor"]
    PS --> PREP --> ORCH --> POL
  end
  subgraph publish [Publish path]
    CFG["configureEventPlatform"]
    PUB["EventPublisher + adapters"]
    DX["publishEvent"]
    CFG --> PUB
    DX --> PUB
  end

Strengths to preserve





Canonical [BaseEvent](libs/event-platform/src/typings/base-event.types.ts) + Zod registry via [defineEvent](libs/event-platform/src/core/schema/define-event.ts).



Single consumer orchestration spine: [consumeEvent](libs/event-platform/src/engine/executor/consume-event.ts) → [processSingle](libs/event-platform/src/engine/processor/process-single.ts) / [processBatch](libs/event-platform/src/engine/processor/process-batch.ts) → [orchestratePreparedConsumerEvent](libs/event-platform/src/engine/processor/orchestrate-consumer-message.ts).



SQS partial-batch semantics via [process-outcomes](libs/event-platform/src/engine/processor/process-outcomes.ts) and [createSqsEventHandler](libs/event-platform/src/lib/create-sqs-event-handler.ts).



Delivery policy as decision-only layer in [delivery-policy.ts](libs/event-platform/src/core/policy/delivery-policy.ts) (AWS redrive remains authoritative for SQS/EventBridge).



Existing architecture review baseline: [docs/architecture/event-platform-unified-transport-review.md](docs/architecture/event-platform-unified-transport-review.md).

Duplicated orchestration and DX inconsistencies







Area



Finding



Risk





Handler factories



[create-event-handler.ts](libs/event-platform/src/lib/create-event-handler.ts) and [create-sqs-event-handler.ts](libs/event-platform/src/lib/create-sqs-event-handler.ts) duplicate schema registry build, default EventConsumerDeps, middleware wiring, and runMiddlewares composition



Drift when defaults change (idempotency, retry, DLQ, parsing)





onEvent



Use **`onEvent({ operation, events })`** for EventBridge consumers ([create-event-handler.ts](libs/event-platform/src/lib/create-event-handler.ts)). Legacy single-schema sugar: [define-event-handler.ts](libs/event-platform/src/lib/define-event-handler.ts) (`onSingleEvent`, deprecated).



Teams pick incompatible consume/publish bootstrap





createEventHandler export



Documented in README but not exported from [index.ts](libs/event-platform/src/index.ts)



Broken/implicit imports; codegen targets wrong surface





EventBridge ingress



createEventHandler does not default mapRawToBaseEvent to [parseInboundEvent](libs/event-platform/src/sdk/consumer/parse-inbound-event.ts); [process-single.ts](libs/event-platform/src/engine/processor/process-single.ts) treats raw as BaseEvent when unset



Native EventBridge envelope not mapped (alert-service threshold breach)





Non-Records retry surface



consumeEvent returns ProcessSingleResult (e.g. needs_transport_retry) for single-object invocations; createEventHandler is Promise<void> and does not map outcomes to Lambda failure



Silent success / no transport redelivery for EventBridge-shaped events





Deprecated stream path



[create-stream-handler.ts](libs/event-platform/src/lib/create-stream-handler.ts) bypasses unified registry/FIFO scheduler vs [create-dynamo-stream-handler.ts](libs/event-platform/src/lib/create-dynamo-stream-handler.ts)



Weaker typing and divergent batch behavior

Transport inconsistencies





Inbound normalization jumps straight from transport hints to payload candidate in [transport-normalize.ts](libs/event-platform/src/sdk/consumer/transport-normalize.ts) without a first-class envelope that retains receiptHandle, messageId, approximateReceiveCount, FIFO fields, and raw payload.



EventConsumerDeps.mapRawToBaseEvent returns BaseEvent directly, encouraging skipping envelope metadata.



[standard-event-context.ts](libs/middleware/src/lib/standard-event-context.ts) labels any Records batch as eventType: 'aws:sqs' (mis-tags DynamoDB Streams/Kinesis at invocation scope).



Correlation extraction diverges: observability [normalize-context.ts](libs/observability/src/core/normalize-context.ts) (detail.correlationId) vs middleware/event-platform (detail.meta.correlationId).

Middleware ordering

[buildEventExecutionPipeline](libs/middleware/src/lib/http-pipeline.ts) already nests asyncErrorMiddleware outermost (index 0), matching the required order: error → context → invocation → logger → tracer → performance. Gaps are documentation drift ([docs/middleware/flow.md](docs/middleware/flow.md) lists error last) and semantic bypass: when the inner handler returns retry disposition objects instead of throwing, error middleware never runs. Fix belongs at the transport outcome mapper boundary, not by re-ordering the existing stack.

Retry / DLQ / idempotency gaps





Default [DomainIdempotencyStrategy](libs/event-platform/src/core/idempotency/domain-idempotency.strategy.ts) is not cross-instance durable; store-backed strategy exists but is not factory-default.



Factories default dlq: { enabled: true } without strategy → policy may classify DLQ while [dlq.executor](libs/event-platform/src/core/dlq/dlq.executor.ts) performs no I/O.



Failure taxonomy is implicit (BaseError.retryable, ZodError, error name heuristics in [isNonRetryableHandlerError](libs/event-platform/src/core/policy/delivery-policy.ts)); no first-class RetryableError / NonRetryableError / SchemaError / DependencyError types for deterministic classification.



idempotencyStrategy.afterSuccess failures are logged via console.error in orchestrator (ack risk without durable commit).



[publishEvent](libs/event-platform/src/dx/publish-event.ts) hard-codes transport selection to eventbridge cast, ignoring schema __meta.transport and preventing declarative fan-out.

Observability gaps





Consumer EMF in [consumer-metrics.ts](libs/observability/src/metrics/consumer-metrics.ts) dimensions are mostly eventType + Error; no transport, outcome, or stable operation on every consumer log line.



Invocation-level performanceMiddleware measures one span per Lambda, not per SQS/Dynamo record.



Per-record ALS exists for SQS/Dynamo in event-platform, but outer event.__context stays invocation-scoped.

Schema governance / replay gaps





Versioning helpers exist ([version-compatibility.ts](libs/event-platform/src/core/versioning/version-compatibility.ts)) but no event registry (ownership, classification, compatibility matrix) or replay metadata on the wire beyond ad-hoc Dynamo stream hints.



No replay-safe processing states (claimed / processing / succeeded / failed) integrated with idempotency store.



No contract-test harness for transport golden fixtures (SQS+SNS unwrap, EventBridge detail, partial batch outcomes).

Production risks (prioritized)





EventBridge consumer mapping + non-throwing retry outcomes (data loss / stuck poison).



Non-durable idempotency by default (duplicate side effects under at-least-once).



Transport mis-attribution in logs/metrics (incident triage cost).



Dual onEvent + unpublished createEventHandler (DX fragmentation).



Publisher bootstrap gaps in apps (HTTP paths calling publishEvent without configureEventPlatform — see alert-service controller).

Target architecture (incremental, no giant abstraction)

flowchart TB
  subgraph entry [Per-Lambda entry - separate functions per transport]
    Profile["TransportProfile selected at factory time"]
    Runtime["createConsumerRuntime(profile, options)"]
    MW["buildEventExecutionPipeline unchanged"]
    MW --> Runtime
  end
  subgraph inbound [Inbound]
    NTE["NormalizedTransportEnvelope"]
    MAP["profile.mapToBaseEvent"]
    PREP["prepareInboundBaseEvent"]
    Profile --> NTE --> MAP --> PREP
  end
  subgraph orch [Unchanged core]
    ORCH["orchestratePreparedConsumerEvent"]
    PREP --> ORCH
  end
  subgraph outbound [Publish]
    PLAN["resolvePublishPlan routing mode single or fanOut"]
    ORCH_PUB["multi-transport publish orchestrator"]
    PLAN --> ORCH_PUB
  end
  subgraph obs [Observability]
    LOG["logEventOperation required fields"]
    MET["consumer/publish metrics with transport dimension"]
  end
  Runtime --> inbound
  ORCH --> obs
  ORCH_PUB --> obs

Rules honored





Separate Lambdas per transport; profile chosen in factory, not auto-detected at runtime.



AWS-native retry/DLQ stays authoritative; platform classifies, observes, and drives idempotency.



No fallback routing (SQS if EventBridge fails) in this program.



Phase 2 — Shared consumer runtime (refactor)

New modules (add under libs/event-platform/src/runtime/)

Proposed layout (keep existing engine/, adapters/, core/; relocate transport-specific inbound code gradually):

libs/event-platform/src/
  runtime/
    transport-profile.ts          # TransportProfile interface + registry
    normalized-transport-envelope.ts
    create-consumer-runtime.ts    # shared factory spine
    transport-outcome-mapper.ts   # ProcessSingleResult -> Lambda return/throw
    build-event-registry.ts       # shared schema registry + handler flattening
    middleware-compose.ts         # buildEventExecutionPipeline + runMiddlewares
  transports/
    eventbridge/profile.ts
    sqs/profile.ts
    dynamodb-stream/profile.ts    # wraps existing stream helpers
  governance/
    event-registry.ts
    schema-compatibility.ts
    replay-metadata.ts
  reliability/
    errors.ts                     # RetryableError, NonRetryableError, SchemaError, DependencyError
    failure-classifier.ts
  publishing/
    routing.ts                    # PublishRoutingConfig, resolvePublishPlan
    publish-orchestrator.ts

Core interfaces

// runtime/normalized-transport-envelope.ts
export interface NormalizedTransportEnvelope<TPayload = unknown> {
  transport: EventTransport | 'dynamodb-stream';
  raw: unknown;
  payloadCandidate: unknown;
  attributes: {
    messageId?: string;
    receiptHandle?: string;
    approximateReceiveCount?: number;
    fifoGroupId?: string;
    fifoDeduplicationId?: string;
    eventSourceArn?: string;
    sequenceNumber?: string;
    correlationHint?: string;
    replay?: ReplayMetadata;
  };
  receivedAt: string;
}

// runtime/transport-profile.ts
export interface TransportProfile {
  transport: NormalizedTransportEnvelope['transport'];
  parseInbound(raw: unknown): NormalizedTransportEnvelope;
  mapToBaseEvent(envelope: NormalizedTransportEnvelope): BaseEvent<unknown>;
  buildFailureResponse(outcomes: ProcessSingleResult[]): unknown;
  supportsPartialBatch: boolean;
  retryModel: 'transport' | 'application' | 'hybrid';
  defaultTransportMode: TransportMode;
  perRecordLoggerContext?(envelope: NormalizedTransportEnvelope): LoggerContext;
}

// runtime/create-consumer-runtime.ts
export function createConsumerRuntime<TEvent, TResult, TContext>(
  profile: TransportProfile,
  options: CreateConsumerRuntimeOptions<TEvent, TContext>,
): (event: TEvent, context: TContext) => Promise<TResult>;

Implementation notes





Move duplicated registry/deps merge from [create-event-handler.ts](libs/event-platform/src/lib/create-event-handler.ts) / [create-sqs-event-handler.ts](libs/event-platform/src/lib/create-sqs-event-handler.ts) into build-event-registry.ts + create-consumer-runtime.ts.



Change processSingle to accept TransportProfile (or parseInbound injected via deps) so mapping is envelope → BaseEvent, not raw → BaseEvent, while keeping [prepareInboundBaseEvent](libs/event-platform/src/core/event-envelope/prepare-inbound-base-event.ts) unchanged.



transport-outcome-mapper.ts enforces: for supportsPartialBatch === false, map needs_transport_retry / terminal failures to thrown normalized errors so asyncErrorMiddleware and Lambda retries engage; for SQS, preserve [coerceConsumeResultToSqsBatchResponse](libs/event-platform/src/lib/create-sqs-event-handler.ts).



Thin wrappers: createEventHandler, createSqsEventHandler, createDynamoStreamHandler, onEvent delegate to createConsumerRuntime with the appropriate profile.

Middleware ordering fix (operational)





Keep [buildEventExecutionPipeline](libs/middleware/src/lib/http-pipeline.ts) order as-is.



Update misleading comments in handler factories and [docs/middleware/flow.md](docs/middleware/flow.md).



Add regression test: injected failure in inner handler is logged once by asyncErrorMiddleware and rethrown.



Phase 3 — Routing and publishing

Declarative routing

Extend [configureEventPlatform](libs/event-platform/src/dx/configure-event-pladtform.ts) and schema meta:

routing?: {
  mode: 'single' | 'fanOut';
  transports: Array<{ transport: EventTransport; adapterOptions?: unknown }>;
};





resolvePublishPlan(schemaMeta, routingOverride) chooses one or many transports.



publish-orchestrator.ts loops transports sequentially for fanOut, reusing one correlationId / stable idempotencyKey from [generate-idempotency-key](libs/event-platform/src/core/idempotency/generate-idempotency-key.ts) + envelope eventId.



Replace [publishEvent](libs/event-platform/src/dx/publish-event.ts) transport cast with plan resolution; no fallback between transports on failure (fail the publish operation, emit per-transport outcome metrics).



Keep [EventPublisher](libs/event-platform/src/sdk/publisher/event-publisher.ts) as the per-transport adapter caller.



Phase 4 — Reliability





Add typed errors in reliability/errors.ts; wire [isNonRetryableHandlerError](libs/event-platform/src/core/policy/delivery-policy.ts) and retry loops to failure-classifier.ts (schema → non-retryable, dependency timeouts → retryable with caps).



Promote store-backed idempotency as the recommended production default via [createIdempotencyStrategy](libs/event-platform/src/core/idempotency/idempotency-factory.ts); document DomainIdempotencyStrategy as local/test-only.



Extend idempotency store states using existing [IdempotencyState](libs/event-platform/src/core/idempotency/idempotency-state.ts) for claimed / processing / succeeded; treat replay as explicit meta.replay + receive-count / archive id hints.



Poison protection: keep SQS FIFO poison threshold; add receive-count guardrails in SQS profile; align with [recommendedSqsRedriveMaxReceiveCount](libs/event-platform/src/infra/recommended-sqs-redrive-max-receive-count.ts).



Propagate afterSuccess failures as retryable DependencyError when store write fails (configurable strict mode).



Phase 5 — Observability

Required log envelope (consumer + publish)

Add logEventOperation helper in @api-hub/observability (or event-platform runtime/observability.ts wrapper) used at orchestration boundaries:

{
  "eventId": "",
  "eventType": "",
  "transport": "",
  "correlationId": "",
  "traceId": "",
  "operation": "",
  "outcome": ""
}





Extend [consumer-metrics.ts](libs/observability/src/metrics/consumer-metrics.ts) and publisher metrics with transport, outcome, operation dimensions (guard cardinality).



Fix [standard-event-context.ts](libs/middleware/src/lib/standard-event-context.ts) batch transport inference via eventSource (delegate to shared inferTransportFromLambdaEvent in runtime/).



Unify correlation extraction paths (prefer meta.correlationId, accept legacy detail.correlationId at normalize layer).



Optional: per-record latency metrics behind consumer.perRecordMetrics flag (default off).



Phase 6 — Governance





governance/event-registry.ts: register defineEvent metadata (owner team, classification, compatibility mode, deprecated versions).



Enforce compatibility on consume via existing [assertVersionCompatible](libs/event-platform/src/core/versioning/version-compatibility.ts) + registry rules.



governance/replay-metadata.ts: ReplayMetadata on envelope + optional meta.replay on BaseEvent (archive id, replayedAt, originalEventId).



Document schema evolution rules in existing engineering guides (extend [EVENT_PLATFORM_DEVELOPER_GUIDE](docs/engineering/EVENT_PLATFORM_DEVELOPER_GUIDE.md) / [SQS_CREATE_SQS_EVENT_HANDLER](docs/engineering/SQS_CREATE_SQS_EVENT_HANDLER.md) — no new standalone markdown unless requested).



Phase 7 — Production hardening







Item



Delivery





Replay-safe processing



Idempotency states + explicit replay metadata + consumer tests with duplicated delivery





Contract testing



Golden fixtures per transport under libs/event-platform/src/**.spec.ts + snapshot envelopes





Operational dashboards



CloudWatch dashboard JSON templates + EMF dimension list (docs/ops artifacts)





DLQ runbooks



Link policy outcomes to AWS queue DLQ + platform DlqStrategy configuration





Local testing utilities



InMemoryIdempotencyStore + test harness to run TransportProfile.parseInbound on fixture files





Concurrency / backpressure



Document batchConcurrency / FIFO scheduler defaults; optional semaphore in process-batch





Transport capability matrix



Table in architecture doc: partial batch, retry owner, ordering, idempotency key source



Reference migration: alert-service

Touchpoints (incremental, no big-bang):





[threshold-breach.consumer.ts](apps/alert-service/src/handlers/events/consumer/event-bridge/threshold-breach.consumer.ts): ensure EventBridge profile / parseInboundEvent mapping; add consumer tests with EventBridge-shaped fixture.



[event-runtime.ts](apps/alert-service/src/handlers/events/bootstrap/event-runtime.ts): call configureEventPlatform from every Lambda that publishes (including HTTP), or split publish-only bootstrap.



[alert-publisher.ts](apps/alert-service/src/handlers/events/publisher/alert-publisher.ts): adopt routing config when fan-out needed; fix HTTP payload shapes vs outbound Zod schemas.



Implement [retry-alert.consumer.ts](apps/alert-service/src/handlers/events/consumer/sqs/retry-alert.consumer.ts) via createSqsEventHandler + serverless partial batch response.



IAM: add events:PutEvents for alert bus in [serverless.yml](apps/alert-service/serverless.yml).



Backward compatibility





Keep public exports stable; add createEventHandler, TransportProfile, NormalizedTransportEnvelope, routing types to [index.ts](libs/event-platform/src/index.ts).



Deprecate (do not remove) [create-stream-handler.ts](libs/event-platform/src/lib/create-stream-handler.ts) in favor of `onDynamoEvent` / `createDynamoStreamHandler`; maintain re-exports for one release cycle.



mapRawToBaseEvent remains supported as an override that runs after envelope parse (adapter for legacy callers).



Default behavior: SQS partial batch unchanged; EventBridge consumers gain correct mapping behind profile defaults (may surface previously hidden validation failures — document as fix).



Test strategy





Unit: transport profiles (parse/map), failure classifier, publish plan resolution, outcome mapper throw vs return.



Integration: SQS batch mixed outcomes, FIFO group scheduler + poison threshold, EventBridge single-event retry throw, fan-out publish (mock adapters).



Contract: golden JSON for SNS→SQS, EventBridge detail, Dynamo stream record → envelope.



Regression: middleware ordering test; standard-event-context transport inference; idempotency store contention → retry classification.



App: alert-service consumer spec for threshold breach; optional serverless-offline smoke.



Incremental rollout





Foundation: export fixes + outcome mapper + EventBridge profile defaults (low risk, fixes silent retry gap).



Runtime extraction: createConsumerRuntime behind existing factories; no caller changes.



Envelope layer: switch processSingle to envelope mapping; migrate tests.



Observability: required log fields + transport metric dimension.



Reliability types + store idempotency guidance: opt-in per service.



Publishing routing: single-transport first, then fan-out behind explicit config.



Governance registry + replay metadata: opt-in per event schema.



App migrations: alert-service first, then other apps using createEventHandler / SQS handlers per codegen [tools/event-migration](tools/event-migration).

gantt
  title Rollout waves
  dateFormat YYYY-MM-DD
  section Foundation
  OutcomeMapperAndExports     :a1, 2026-05-15, 7d
  section Runtime
  ConsumerRuntimeAndProfiles  :a2, after a1, 14d
  section Ops
  ObservabilityDimensions     :a3, after a2, 10d
  section Apps
  AlertServiceMigration       :a4, after a3, 10d

