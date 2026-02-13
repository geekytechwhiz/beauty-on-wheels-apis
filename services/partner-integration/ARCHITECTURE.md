# Partner Integration Service – Architecture

## Role

**External deployable service** (lives under `services/`, not `apps/`). Integrates with third-party partners (labs, clinics, hospitals) regardless of organization type. Uses **adapter + registry pattern** for scalability.

## Design

- **Single entry point**: All partner types (lab, clinic, hospital) go through this service.
- **Partner Registry**: Source of truth for partner config (onboarding). This service calls Partner Registry to get `partnerId`, `apiBaseUrl`, `authConfig`, `adapterKey`.
- **@api-hub/lab-integration**: Shared lib that provides:
  - Adapter registry and factory (`createAdapter`)
  - Base adapter (auth, retry, circuit breaker, error translation)
  - Per-partner validation (`getCreateOrderSchema(partnerId)` etc.)
  - Idempotency (DynamoDB)
  - Redcliffe / Orange (and future) adapters
- **This service**:
  - Fetches config from Partner Registry.
  - Maps registry config to lib `PartnerConfig` (`config/partner-config.mapper.ts`).
  - Uses lib’s `createAdapter`, `IdempotencyService`, and validation in handlers.
  - Handles HTTP, logging, and error mapping to API responses.

## Flow

1. Request → Handler (parse, validate with lib schema, read `Idempotency-Key`).
2. Handler → `integration.service` (createOrder / rescheduleOrder / cancelOrder / getOrderStatus).
3. Integration service → Partner Registry `getPartnerConfig(partnerId)` → map to lib config → `createAdapter(config)` → adapter method.
4. Adapter (from lib) → partner API (with retry, circuit breaker, auth from Secrets Manager).
5. Response mapped to unified API format; idempotent writes cached in DynamoDB when key present.

## Adding a new partner type

1. Implement `PartnerAdapter` in **libs/lab-integration** (extend `BasePartnerAdapter`).
2. Register in **libs/lab-integration** `adapter.registry.ts`.
3. Add partner config (or use Partner Registry) and validation schemas in the lib.
4. No changes required in this service; it uses registry and config.

## Idempotency

- Header: `Idempotency-Key`.
- Table: `partner-integration-{stage}-idempotency` (DynamoDB, TTL 24h).
- Used for createOrder, rescheduleOrder, cancelOrder.

## Endpoints

### Phase 1: Critical APIs

| Method | Path | Description | Idempotency |
|--------|------|-------------|-------------|
| GET | /health | Health check | No |
| POST | /orders | Create order | Yes |
| POST | /orders/{orderId}/reschedule | Reschedule order | Yes |
| POST | /orders/{orderId}/cancel | Cancel order | Yes |
| GET | /orders/{orderId}/status | Get order status | No |

### Phase 2: High Priority APIs

| Method | Path | Description | Idempotency |
|--------|------|-------------|-------------|
| GET | /locations/serviceable | Get serviceable locations | No |
| GET | /locations/partner | Get partner location by eloc | No |
| GET | /packages/search | Search packages | No |
| GET | /packages/details | Get package details by code | No |
| GET | /booking-slots | Get booking slots | No |

### Phase 3: Medium Priority APIs

| Method | Path | Description | Idempotency |
|--------|------|-------------|-------------|
| POST | /orders/{orderId}/confirm | Confirm booking/order | Yes |
| PUT | /packages/{packageCode} | Update package | Yes |
| GET | /orders/{orderId}/reports/consolidated | Get consolidated report | No |
| GET | /orders/{orderId}/reports/digital | Get digital report | No |

### Phase 4: Low Priority APIs

| Method | Path | Description | Idempotency |
|--------|------|-------------|-------------|
| PUT | /orders/{orderId}/credit | Update credit | Yes |

**Note:** All endpoints require `partnerId` as a query parameter (except `/health`). Write operations (POST/PUT) support `Idempotency-Key` header for idempotent requests.
