Objective: Implement consumer logic in sdk/consumer/

This is the MOST IMPORTANT layer.

Implement:

consumer.handle(event, handler)

Flow:
1. Parse event
2. Validate structure
3. Idempotency check
4. Retry wrapper
5. Execute handler
6. Save idempotency key

Requirements:
- Plug-in architecture:
  - IdempotencyStore injected
  - Retry config injected

- Must be transport-agnostic

Tests:
- duplicate event skipped
- retry works
- success path

DO NOT:
- connect to SQS directly