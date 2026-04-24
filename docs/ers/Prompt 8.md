Refactor or create schemaValidationMiddleware.

Requirements:
- Use centralized schema registry (core/schema)
- Validate event.payload based on eventType
- Throw structured error on failure

Ensure:
- No handler performs manual validation
- Middleware handles all validation