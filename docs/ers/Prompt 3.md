Refactor loggerMiddleware to use AsyncLocalStorage context binding.

Requirements:
- Use withLoggerContext from observability/logger
- Read context from event.__context
- Wrap entire execution inside context

Ensure:
- No direct mutation of logger
- No manual passing of correlationId

Fix all middlewares using logger incorrectly.