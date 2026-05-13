# SQS runtime and middleware: production readiness

This document is a **production-readiness audit** of the SQS consumer path in `@api-hub/event-platform`: `createSqsEventHandler` → `consumeEvent` → `processBatch` (including FIFO-aware scheduling) → `processSingle` → `orchestratePreparedConsumerEvent`, plus transport parsing, visibility heartbeat, DLQ handling, and observability. It complements [SQS_CREATE_SQS_EVENT_HANDLER.md](./SQS_CREATE_SQS_EVENT_HANDLER.md).

---

## Architecture snapshot

| Layer | Responsibility |
|-------|----------------|
| Middleware | `@api-hub/middleware` pipeline wraps the Lambda handler. |
| `createSqsEventHandler` | Typed `SQSBatchResponse`, default `transportMode: 'sqs-native'`, per-message ALS (`withLoggerContext`), optional visibility heartbeat, optional FIFO batch scheduling shorthands. |
| `consumeEvent` | Extracts batch records, delegates to `processBatch`, optional `wrapProcessSingle`. |
| `processBatch` | Partial batch aggregation; optional FIFO lane scheduler (serial per `MessageGroupId`, global concurrency cap). |
| `processSingle` | Map raw → `BaseEvent`, orchestrate idempotency, handler, retry/DLQ policy. |
| `orchestratePreparedConsumerEvent` | Tracing hooks, idempotency `before`/`afterSuccess`, delivery policy, DLQ executor. |

---

## Dimension analysis

### Retry safety

- **SQS-native surface path** (`useSqsSurfaceRetry`): when `ApproximateReceiveCount` is present and mode is sqs-native without `transportRetry`, handler failures that remain retryable return `needs_transport_retry` → **partial batch failure** — aligned with Lambda + SQS redrive.
- **In-process retries** (`runInProcessHandlerAttempts`): used when the SQS surface path is not selected. Retries use **`sleep`** inside the same invocation — **Lambda wall-clock and timeout** must be budgeted (`retry.maxAttempts`, `delayMs`, batch size, handler duration).
- **Idempotency contention** can also **`sleep`** before returning transport retry in some branches — same timeout concern.

### Duplicate safety

- **`DUPLICATE`** from `idempotencyStrategy.before` returns outcome `duplicate`, which is **acked without batch failure** — correct when the store accurately reflects prior completion.
- **Risk:** After handler success, **`afterSuccess` errors are logged (`console.error`) but the outcome is still success**. If the message is redelivered (crash before batch response, visibility edge, etc.), the handler may run again while persistence is ambiguous — **mitigate with idempotent handlers and a store that tolerates duplicate `afterSuccess`**.

### Lambda timeout safety

- **Visibility heartbeat** (optional): uses `context.getRemainingTimeInMillis()`, hard stop, clears timers in `stop`, serialized `ChangeMessageVisibility` per message — good defaults for long work.
- **FIFO lane serialization** increases time spent per group within one invoke — tune **batch window**, **visibility timeout**, heartbeat interval, and **function timeout** together.

### Partial batch correctness

- Failures and non-ack outcomes contribute **`messageId`** (or stream-like identifiers) to `batchItemFailures` — matches Lambda’s partial batch API.
- **FIFO-aware scheduling** defers same-lane tails with synthetic `needs_transport_retry` so deferred messages are **not implicitly deleted** — critical for ordering + partial batch parity.

### FIFO correctness

- Same **`MessageGroupId`** → serial within the batch; different groups run up to **`batchConcurrency`** in parallel (see scheduler in `libs/event-platform`).
- **Misconfiguration risk:** if `MessageGroupId` is missing on FIFO traffic, the runtime falls back to **per-`messageId` lanes**, which **does not** serialize true same-group messages — treat as **P0 configuration** for strict FIFO.

### Memory leaks

- Per-invocation structures (batch results, semaphore, heartbeat controller) are bounded by **batch size** and **invoke lifetime**. Heartbeat uses a single timer per controller and a chained extend promise — low leak risk for normal Lambda durations.

### ALS isolation

- `createSqsEventHandler` sets **`buildSqsPerMessageLoggerContext`** inside `withLoggerContext` around each record’s `run()` — safe for concurrent `processBatch` workers.
- **Gap:** FIFO **deferred tails** never run `processSingle`, so they do not get the same per-message **handler tracing** lifecycle as executed records (scheduling logs/metrics still apply).

### Tracing correctness

- Normal path fires start/success/failure via `fireProcessing*` helpers.
- **`onFifoBatchTailDeferred`** covers FIFO tail deferral.
- **Fragility:** preparation failure **`stage`** in traces can be inferred from **`Error.message` substrings** in `handlePreparationFailure` — brittle for dashboards; prefer typed error codes long-term.

### DLQ correctness

- Policy can yield **`dead_letter`** when `dlq.enabled` even if **`dlq.strategy`** is unset; **`handleDlq`** no-ops without strategy, and some branches fall through to **`needs_transport_retry`** — operators may believe DLQ is wired when messages only churn. **Validate config at deploy time** or emit a high-severity signal on first skip.
- **`dlq.strategy.send` throwing** can fail the record path without a first-class **DLQ send failure** metric unless wrapped by the application.

### Poison message handling

- **FIFO poison threshold** (optional): short-circuits the handler when `ApproximateReceiveCount` meets the threshold and defers lane tails — reduces wasted work on known poison.
- **Queue-native** redrive to DLQ remains an **AWS** concern (`maxReceiveCount` on redrive policy); the library adds an **optional** app-level guardrail.

### Observability completeness

- Existing metrics cover processing, duplicates, retries, failures, dispositions, visibility heartbeat, and FIFO batch scheduling snapshots / tail deferral / poison short-circuit.
- Gaps are called out below under **missing metrics**.

---

## Scenario matrix (what to expect)

| Scenario | Expected behavior | Watchouts |
|----------|--------------------|-----------|
| Malformed SNS / non-JSON `Message` | Preparation failure → policy (retry/DLQ/discard) | Unusual SNS shapes may not unwrap; errors surface as validation failures |
| Schema / version failures | Often non-retryable → discard or DLQ | Trace `stage` heuristics may mislabel |
| Downstream timeouts | Retryable → transport retry until exhausted | No built-in circuit breaker — protect inside handler |
| Visibility expiration | Mitigated by heartbeat when enabled | Missing `SQS_QUEUE_URL` / misconfig disables heartbeat |
| Concurrent record failures | Independent `batchItemFailures` entries | Shared AWS clients: usually fine; load-test extremes |
| DLQ send failure | Propagates unless wrapped | Add metrics and retry/compensation at app boundary |
| Retry storms | SQS + Lambda scale | Reserved concurrency, queue depth alarms, dependency limits |
| Duplicate deliveries | `DUPLICATE` short-circuit when store correct | Post-success crash / `afterSuccess` failure → business idempotency still required |

---

## Risks (P0 / P1 / P2)

### P0

1. **Business duplicate side effects** if handlers are not idempotent under **redelivery** (including Lambda crash after handler success but before returning `SQSBatchResponse`).
2. **FIFO strict ordering** compromised when **`MessageGroupId` is absent** on real FIFO records (lane falls back to per-`messageId`).

### P1

1. **`dlq.enabled` without `dlq.strategy`** — silent lack of DLQ emission while policy still returns dead-letter style outcomes in some paths.
2. **`handleDlq` / `send` throws** — poison the invoke or record without dedicated **`DlqSendFailure`** observability unless added upstream.
3. **Preparation `stage` classification** via message substring — wrong operational signals.
4. **Missing `ApproximateReceiveCount`** on `raw` — switches retry semantics toward **in-process sleeps**; surprising under timeout pressure.
5. **FIFO deferred tails** — limited per-event tracing compared to executed messages.

### P2

- No library-level **circuit breaker** for downstream calls inside handlers.
- No per-invoke **structured batch summary** log (counts by outcome) in the framework.
- **Synchronized sleeps** across workers under idempotency contention can amplify load.

---

## Hardening recommendations

1. **Config validation:** if `dlq.enabled`, require **`dlq.strategy`** at startup (or fail CI/CD schema check).
2. **Wrap DLQ send:** try/catch → metric + structured log (`messageId`, `eventType`, error); optional secondary sink.
3. **Typed preparation errors:** replace substring `stage` detection with error codes or `instanceof` checks.
4. **Policy for `afterSuccess` failure:** document whether to **retry the message** (trade duplicate handler runs) vs accept risk; avoid silent success if the business cannot tolerate it.
5. **FIFO:** optional **lint/metric** when FIFO queue URL is known but records lack `MessageGroupId`.
6. **Capacity:** document **batch size × handler p99 × visibility × heartbeat × timeout**; set **reserved concurrency** when retry storms are likely.

---

## Missing tests (suggested backlog)

- DLQ: enabled + no strategy; `send` throws.
- Preparation: JSON vs SNS unwrap vs `validateBaseEvent` failures → stable classification once refactored.
- Idempotency: `afterSuccess` throws → assert current contract (and future contract if changed).
- Transport: record without `ApproximateReceiveCount` → assert retry path class.
- FIFO + partial batch: mixed lanes, concurrent failures, tail deferral IDs.
- Visibility: extend API failure; near-timeout behavior with fake `getRemainingTimeInMillis`.
- Middleware: handler returns value that bypasses `coerceConsumeResultToSqsBatchResponse` safeguards (contract test).

---

## Missing metrics (suggested)

- **`ConsumerDlqSendSuccess` / `ConsumerDlqSendFailure`** (dimensions: `eventType`, `errorName`).
- **`ConsumerPreparationFailure`** with explicit **`Stage`** dimension (`json_parse`, `sns_unwrap`, `base_event`, `schema`, `version`, `unknown`).
- **`SqsBatchInvokeSummary`** (processed, partial failure, duplicate, discarded counts) — EMF or one structured log per invoke.
- **`IdempotencyAfterSuccessFailure`** count.
- **`LambdaNearTimeoutHeartbeats`** (already partially covered by skip metrics — correlate in dashboards).

---

## Missing alarms (suggested)

1. Sustained **`DlqSendFailure`** (if implemented) or Lambda **errors** on the SQS trigger function.
2. **`SqsFifoBatchTailsDeferred`** or **`SqsFifoBatchPoisonShortCircuits`** spikes.
3. **`SqsVisibilityHeartbeatsSkipped`** with reason tied to **low remaining time** — handler vs timeout misalignment.
4. Queue **ApproximateAgeOfOldestMessage** + function **throttles** + **concurrent executions** composite.
5. **DLQ depth** (AWS-native redrive target) and any **application DLQ** depth.

---

## Missing dashboards (suggested)

1. **Lambda SQS consumer:** invocations, errors, throttles, duration p50/p99, concurrent executions.
2. **Batch health:** ratio of `batchItemFailures.length` to `Records.length` by version.
3. **Retry pressure:** consumer retry metrics vs SQS **ApproximateNumberOfMessagesVisible**.
4. **FIFO:** FIFO batch scheduling metrics + tail deferral + poison short-circuit.
5. **DLQ:** send outcomes vs AWS DLQ ingests.
6. **Preparation vs handler:** split failure volumes using stable stages once metrics exist.

---

## References (in-repo)

- Handler factory: `libs/event-platform/src/lib/create-sqs-event-handler.ts`
- Batch / FIFO scheduler: `libs/event-platform/src/engine/processor/process-batch.ts`, `sqs-fifo-group-scheduler.ts`
- Orchestration: `libs/event-platform/src/engine/processor/orchestrate-consumer-message.ts`
- Policy: `libs/event-platform/src/core/policy/delivery-policy.ts`
- DLQ executor: `libs/event-platform/src/core/dlq/dlq.executor.ts`
- Visibility heartbeat: `libs/event-platform/src/sqs/sqs-visibility-heartbeat.ts`
- Consumer metrics: `libs/observability/src/metrics/consumer-metrics.ts`

---

## Document control

- **Audience:** service owners, SRE, and security reviewers operating SQS-triggered Lambdas on this stack.
- **When to update:** after material changes to `processBatch`, delivery policy, DLQ wiring, FIFO scheduling, visibility heartbeat, or default `EventConsumerDeps`.
