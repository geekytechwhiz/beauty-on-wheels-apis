Incoming Event
   ↓
1. contextMiddleware
   ↓
2. invocationContextMiddleware
   ↓
3. loggerMiddleware (inject context into logger)
   ↓
4. tracerMiddleware
   ↓
5. schemaValidationMiddleware
   ↓
6. idempotencyMiddleware (only for write APIs)
   ↓
7. performanceMiddleware (start timer)
   ↓
8. Business Handler
   ↓
9. responseMiddleware
   ↓
10. performanceMiddleware (end timer)
   ↓
11. errorMiddleware (catch any failure globally)
   ↓
Response