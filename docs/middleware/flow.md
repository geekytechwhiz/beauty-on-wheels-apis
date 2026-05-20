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
7. Business handler

Reliability (idempotency, retry, DLQ, transport outcome mapping) belongs in `@api-hub/event-platform`, not in the HTTP/async middleware stack.
