# middleware (`@api-hub/middleware`)

Lambda middleware for **HTTP APIs** and **async invocation** (logger, tracer, context, errors, performance). Composes with `@api-hub/event-platform` for event consumers.

**Execution flows:** [`docs/middleware/flow.md`](../../docs/middleware/flow.md)

---

## HTTP handlers

Use **`withApiHandler`** + **`buildApiExecutionPipeline`**:

```typescript
import { withApiHandler, successResponse } from '@api-hub/middleware';

export const handler = withApiHandler(
  { operation: 'createItem', bodySchema: CreateItemSchema },
  async (req) => successResponse({ id: '...' }, req.context.correlationId),
);
```

**HTTP idempotency** is not provided by this library. Use **domain conditional writes** in repositories (e.g. `attribute_not_exists(pk)` on a business key). See [IDEMPOTENCY_EVENT_PLATFORM_VS_MIDDLEWARE.md](../../docs/engineering/IDEMPOTENCY_EVENT_PLATFORM_VS_MIDDLEWARE.md).

---

## Async event handlers

Use **`buildEventExecutionPipeline`** via `createEventHandler` / `onQueue` / `onDynamoEvent` in event-platform. Event idempotency (`DomainIdempotencyStrategy` or optional store) lives in **`@api-hub/event-platform`**.

---

## Build & test

```bash
nx build middleware
nx test middleware
```
