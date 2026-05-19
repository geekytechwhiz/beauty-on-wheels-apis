Create errorMiddleware for centralized error handling.

Requirements:
- Wrap next()
- Catch all errors
- Log structured error using logger
- Re-throw error

Include:
- event payload
- correlationId

Ensure:
- No middleware silently swallows errors