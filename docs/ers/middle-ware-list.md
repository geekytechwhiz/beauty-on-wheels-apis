| #  | Middleware                                     | Responsibility                                                                    | Current Owner (Library) | Status               | Key Outputs / Side Effects        |
| -- | ---------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------- | -------------------- | --------------------------------- |
| 1  | **Transport Adapter Middleware**               | Normalize incoming events (SNS, SQS, EventBridge) into a standard `EventEnvelope` | `event-platform`        | Planned              | Normalized `event` object         |
| 2  | **Envelope Validator Middleware**              | Validate required envelope fields (`eventId`, `eventType`, `orgId`, etc.)         | `event-platform`        | Planned              | Throws error -> stops pipeline    |
| 3  | **Schema Validation Middleware**               | Validate `payload` against schema (Zod / JSON schema)                             | `event-platform`        | In progress          | Throws validation error           |
| 4  | **Correlation Context Middleware**             | Extract and set `correlationId`, `causationId` into request scope                 | `middleware`            | In progress          | Context available globally        |
| 5  | **Tracing Middleware**                         | Attach tracing metadata (X-Ray annotations, spans)                                | `observability`         | Planned              | Trace annotations added           |
| 6  | **Logging Middleware**                         | Structured logging with event metadata and request context                         | `middleware` + `observability` | In progress    | Logs with correlationId/eventId   |
| 7  | **Metrics Middleware**                         | Emit metrics (success, failure, duplicate, latency)                               | `observability`         | Planned              | CloudWatch metrics                |
| 8  | **Idempotency Middleware ⭐**                  | Ensure event is processed only once using DynamoDB (same table, shard-based)      | `event-platform` + `middleware` | In progress | Writes/updates idempotency record |
| 9  | **Retry Middleware**                           | Retry execution for retryable errors with backoff                                 | `event-platform`        | Planned              | Re-execution attempts             |
| 10 | **Error Classification Middleware**            | Classify errors (Retryable vs Non-Retryable vs Validation)                        | `middleware`            | In progress          | Tagged error types                |
| 11 | **DLQ Middleware**                             | Send failed events to DLQ after retries are exhausted                             | `event-platform`        | Planned              | Push to DLQ (SQS/EventBridge)     |
| 12 | **Context Enricher Middleware**                | Fetch additional context (user/org/config)                                        | `middleware`            | Planned              | Enriched event/context            |
| 13 | **Business Handler (Core)**                    | Execute domain logic                                                              | Service handler         | Implemented          | Writes domain data                |
| 14 | **Post-Processor Middleware**                  | Publish downstream events, audit logs                                             | `event-platform`        | Planned              | New events, logs                  |
| 15 | **Response/Finalizer Middleware** *(optional)* | Final cleanup, formatting, and metrics flush                                      | `middleware` + `observability` | In progress | Final logs/metrics                |

## Observability Scope

`libs/observability` should stay focused on telemetry primitives and integrations, while `libs/middleware` composes those primitives into handler middleware.

- `observability` owns: logger/tracer/metrics clients, context propagation helpers, serialization/redaction utilities.
- `middleware` owns: request lifecycle hooks (`before`, `after`, `onError`) and orchestration around handlers.
- `event-platform` owns: event-specific concerns (envelope/schema/idempotency/retry/dlq).
