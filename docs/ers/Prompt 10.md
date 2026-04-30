Refactor all handlers to use a consistent middleware pipeline.

Standard order:

[
  errorMiddleware(),
  contextMiddleware(),
  loggerMiddleware(),
  schemaValidationMiddleware(),
  performanceMiddleware()
]

Ensure:
- Same order across all services
- No missing middleware
- No custom ordering per service