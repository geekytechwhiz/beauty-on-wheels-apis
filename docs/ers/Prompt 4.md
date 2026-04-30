Refactor contextMiddleware to standardize event context.

Requirements:
- Extract:
  - correlationId
  - awsRequestId
- Attach to event.__context (DO NOT mutate root event)
- Add:
  - eventType
  - source

Ensure:
- No duplicate context logic across services
- Works for SQS, EventBridge, HTTP events