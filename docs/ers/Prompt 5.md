Refactor idempotencyMiddleware to align with architecture.

IMPORTANT:
- Idempotency MUST NOT be enforced by middleware
- Remove any logic that:
  - blocks duplicate events
  - stores event processing state

Replace with:
- Logging only:
  - idempotencyKey
  - duplicate detection (if provided by domain)

Ensure:
- Domain services handle idempotency
- Middleware only logs + passes through

Update all usages accordingly.