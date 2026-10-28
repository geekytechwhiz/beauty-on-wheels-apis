# service-catalog-service

Platform categories and provider offerings for Beauty on Wheels.

## Retained API surface

### Categories (platform-managed)

- `GET /categories` — list (providers and customers read active categories)
- `GET /categories/{categoryId}`
- `POST /categories` — catalog admin
- `PUT /categories/{categoryId}` — catalog admin
- `DELETE /categories/{categoryId}` — catalog admin

### Offerings

- `GET /offerings` — customer marketplace discovery (filters: `search`, `categoryId`, `vehicleType`, `minPrice`, `maxPrice`, `minRating`, `status`, `sort`, `limit`, pagination, `communityId`, geo, availability)
- `POST /offerings` — authenticated provider creates a `PACKAGE` offering
- `GET /offerings/{offeringId}` — offering details
- `PATCH /offerings/{offeringId}` — provider updates their offering
- `DELETE /offerings/{offeringId}` — provider archives their offering (`status: archived`)
- `GET /vendors/me/offerings` — authenticated provider lists their offerings

Provider identity is resolved from Vendor Service `GET /vendors/me`. Client-supplied `vendorId` is not trusted for ownership.

Optional community coverage routes remain under `/offerings/{offeringId}/communities` for mapping and admin approval.

## Offering model

Create packages directly as offerings. There is no separate `/services` or `/packages` HTTP API.

- `offeringType`: `PACKAGE` (supported). `SERVICE` is reserved for a future shape on the same resource.
- `includedServices`: inline service descriptions (`name`, `description`, platform `categoryId`, `tags`, `visitsPerPeriod`, `durationMinutes`). Providers do not create linked service records. `includedServices[].durationMinutes` is **one visit’s duration**.
- `vehiclePricing`: per vehicle type with **integer minor units** (final customer price) and explicit `currency` (default `INR`). `vehiclePricing[].durationMinutes` is the **total package duration across visits in the billing period** for that vehicle (for example, a weekly package whose visits sum to 170 minutes uses `170` here). It is not labeled as per-visit duration.
- `visitWindows`: optional package-defined preferred visit windows (`visitWindowId`, `label`, and either `allDay: true` or `startTime`/`endTime`). Selection is a preference for the provider to coordinate; not a confirmed availability slot.
- `billingPeriod`: `oneTime` | `weekly` | `monthly` | `yearly`. Name/description must not contradict the period (for example, “daily” with `weekly`).
- Lifecycle: `draft` → `published` → `paused` / `archived`. Only `published` offerings are customer-eligible (`active: true`). Version increments when price, composition, visit windows, or status-relevant fields change.
- Capacity and real-time availability belong to Availability Service, not this catalog. Pricing Service is not used for package final price.

Example create body:

```json
{
  "offeringType": "PACKAGE",
  "name": "Premium weekly wash",
  "description": "Interior and exterior wash package billed weekly",
  "billingPeriod": "weekly",
  "currency": "INR",
  "vehiclePricing": [
    { "vehicleType": "HATCHBACK", "price": 149900, "durationMinutes": 170 },
    { "vehicleType": "SUV", "price": 199900, "durationMinutes": 200 }
  ],
  "includedServices": [
    {
      "name": "Exterior wash",
      "description": "Foam wash and dry",
      "categoryId": "cat_wash",
      "tags": ["exterior"],
      "visitsPerPeriod": 4,
      "durationMinutes": 30
    },
    {
      "name": "Interior vacuum",
      "categoryId": "cat_detail",
      "visitsPerPeriod": 2,
      "durationMinutes": 25
    }
  ],
  "visitWindows": [
    {
      "visitWindowId": "morning",
      "label": "Morning (8:00–12:00)",
      "startTime": "08:00",
      "endTime": "12:00"
    },
    {
      "visitWindowId": "anytime",
      "label": "Anytime",
      "allDay": true
    }
  ],
  "status": "published"
}
```

## Marketplace discovery

`GET /offerings` reads the discovery projection on GSI2 (`DISCOVERY#ALL`, or `DISCOVERY#CATEGORY#<categoryId>`). Only published offerings project onto that index. The list response is a discovery page (`items`, `hasMore`, optional `nextCursor`) — not the full PACKAGE detail. Use `GET /offerings/{id}` for `includedServices`, `visitWindows`, vehicle-specific pricing, billing period, currency, and publication/active state. `GET /offerings/{id}` returns published offerings to any authenticated caller; draft/paused/archived are owner-only. Community enforcement via GSI3 is controlled by `COMMUNITY_OFFERING_ENFORCEMENT`.

## Removed HTTP surfaces

These routes and their handlers are no longer part of the public catalog API:

- `/services`, `/packages`, `/addons`
- `POST /pricing/calculate`
- `/vendors/{vendorId}/service-visits`
- `GET /catalog/discover` (use `GET /offerings`)

Internal DynamoDB stream handlers for legacy `SERVICE` and `ServiceVisitConfiguration` rows, discovery EventBridge consumers, booking-readiness facts, and offering-community backfill remain so existing projections and integrations keep working. Existing DynamoDB data is not deleted or rewritten by this change.

## Compatibility

- Booking and vendor-service catalog clients call `GET /offerings/{id}` instead of `/services` or `/packages`. Booking prices from the offering’s vehicle price (minor → major units) and catalog `version`.
- `GET /offerings/{id}` still resolves legacy `SERVICE` / `PACKAGE` rows for existing booking ids (`legacySource` on the response).
- Offering revisions and discovery vendor/branch facts are preserved for booking snapshots and eligibility.

## OpenAPI / Postman

Swagger is generated from `serverless.yml` documentation models and `src/types/api-types.d.ts` via `serverless-auto-swagger` / `serverless-openapi-documenter`. Regenerate with:

```bash
pnpm --filter @api-hub/service-catalog-service openapi
```
