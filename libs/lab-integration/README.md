# Lab Integration Library

Third-party lab integration (Redcliffe Labs, Orange Health) with enterprise patterns: base commands, per-partner validation, idempotency, retry/backoff, circuit breaker, and adapter registry.

## Architecture Overview

- **Commands**: Base order types + partner extensions (Redcliffe, Orange); union types for runtime.
- **Validation**: Per-partner Zod schemas and `getCreateOrderSchema(partnerId)` / `getRescheduleOrderSchema(partnerId)` / `getCancelOrderSchema(partnerId)`.
- **Adapters**: `PartnerAdapter` interface, `BasePartnerAdapter`, registry pattern; Redcliffe implemented, Orange placeholder.
- **Standards**: Idempotency (DynamoDB), HTTP retry with exponential backoff, optional circuit breaker.
- **Services**: `createOrder`, `rescheduleOrder`, `cancelOrder`, `getOrderStatus` with idempotency for writes.

## Partner Configuration Registry

### Service Level Agreement (SLA)

- **Latency:** < 100ms (p95), < 200ms (p99)
- **Availability:** 99.9% uptime
- **Cache TTL:** 5 minutes
- **Dependency:** Partner Registry Service

### Cache Behavior

- Partner configurations are cached in-memory for 5 minutes.
- New partners or configuration changes may take up to 5 minutes to appear.
- Cache can be manually cleared using `clearConfigCache(partnerId)`.
- Cache is per-Lambda instance (not shared across instances).

### Adding New Partners

1. Implement `PartnerAdapter` interface (e.g. extend `BasePartnerAdapter`).
2. Add entry to `adapter.registry.ts` (register key and constructor).
3. Add partner config in `partner-config.service.ts` (or wire to Partner Registry).
4. Add validation schemas and schema factory entries if needed.
5. Deploy — no other code changes needed in factory or handlers.

## Idempotency

- **Storage:** DynamoDB table (name from `IDEMPOTENCY_TABLE_NAME`).
- **TTL:** 24 hours on `ttl` attribute.
- **Key:** Client sends `Idempotency-Key` header; same key returns cached result for create/reschedule/cancel.

## Environment Variables

- `IDEMPOTENCY_TABLE_NAME` — DynamoDB table for idempotency (default: `lab-integration-idempotency`).
- `REDCLIFFE_BASE_URL`, `REDCLIFFE_SECRET_ARN` — Redcliffe API and credentials secret ARN.
- `ORANGE_BASE_URL`, `ORANGE_SECRET_ARN` — Orange Health API and credentials secret ARN.
- `REGION` / `DEFAULT_REGION` — AWS region for Secrets Manager and DynamoDB.

## Usage

```ts
import {
  createOrder,
  rescheduleOrder,
  cancelOrder,
  getOrderStatus,
  getCreateOrderSchema,
} from '@api-hub/lab-integration';

// Validate with partner-specific schema
const schema = getCreateOrderSchema('redcliffe');
const parsed = schema.parse(body);

// Create order (optionally with idempotency key)
const result = await createOrder(parsed, event.headers['Idempotency-Key']);
```

## Testing

- Unit tests: adapters, services, validation schemas, idempotency, circuit breaker, retry.
- Mock AWS (Secrets Manager, DynamoDB) and HTTP in tests.

## Exports

- Commands: `BaseCreateOrderCommand`, `RedcliffeCreateOrderCommand`, `OrangeCreateOrderCommand`, etc.
- Adapters: `PartnerAdapter`, `createAdapter`, `adapterRegistry`, `BasePartnerAdapter`, `RedcliffeAdapter`, `OrangeAdapter`.
- Validation: `getCreateOrderSchema`, `getRescheduleOrderSchema`, `getCancelOrderSchema`, and per-partner schemas.
- Services: `createOrder`, `rescheduleOrder`, `cancelOrder`, `getOrderStatus`, `getPartnerConfig`, `clearConfigCache`, `IdempotencyService`.
- Utils: `IntegrationResult`, `toResult`, `toResultError`, custom errors, `translateError`, `requestWithRetry`, `CircuitBreaker`.
