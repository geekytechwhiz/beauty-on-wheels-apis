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

- `GET /offerings` — customer marketplace discovery (**requires** `communityId`; filters: `search`, `categoryId`, `vehicleType`, `minPrice`, `maxPrice`, `minRating`, `status`, `sort`, `limit`, pagination, geo, availability)
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
- `vendorId` / `categoryId`: required on create. `vendorId` must match the authenticated caller from `/vendors/me`. Top-level `categoryId` must exist and be active; it is persisted on the offering.
- `includedServices`: inline service descriptions (`name`, `description`, platform `categoryId`, optional `serviceKey`, `tags`, `visitsPerPeriod`, `durationMinutes`). Providers do not create linked service records. `includedServices[].durationMinutes` is **one visit’s duration**. `serviceKey` is an optional stable entitlement id (unique within the offering); when omitted, responses derive `entitlements[].serviceId` from the service name.
- `validityDays`: optional positive integer (1–730). For `oneTime` packages this is the purchase validity window in days; for recurring billing periods it is optional metadata.
- `entitlements` (response only): computed array of `{ serviceId, quantity, name, durationMinutes, categoryId }` from `includedServices` (`serviceKey` or slugified name, `visitsPerPeriod` as quantity).
- `vehiclePricing`: per vehicle type with **integer minor units** (final customer price) and explicit `currency` (default `INR`). `vehiclePricing[].durationMinutes` is the **total package duration across visits in the billing period** for that vehicle (for example, a weekly package whose visits sum to 170 minutes uses `170` here). It is not labeled as per-visit duration.
- `visitWindows`: optional package-defined preferred visit windows (`visitWindowId`, `label`, and either `allDay: true` or `startTime`/`endTime`). Selection is a preference for the provider to coordinate; not a confirmed availability slot.
- `billingPeriod`: `oneTime` | `weekly` | `monthly` | `yearly`. Name/description must not contradict the period (for example, “daily” with `weekly`).
- Lifecycle: `draft` → `published` → `paused` / `archived`. Only `published` offerings are customer-eligible (`active: true`). Version increments when price, composition (including `serviceKey`), `validityDays`, visit windows, or status-relevant fields change.
- Capacity and real-time availability belong to Availability Service, not this catalog. Pricing Service is not used for package final price.

Example create body:

```json
{
  "vendorId": "vend_demo_001",
  "categoryId": "cat_wash",
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

`GET /offerings` requires `communityId` and lists active, approved community mappings on GSI3 (`COMMUNITY#<communityId>`). There is no fallback to global GSI2 (`DISCOVERY#ALL` / `DISCOVERY#CATEGORY#…`) when the community query returns no rows. Missing or invalid `communityId` returns `400`. Only published/active offerings with an indexed community mapping are returned. The list response is a discovery page (`items`, `hasMore`, optional `nextCursor`) — not the full PACKAGE detail. Use `GET /offerings/{id}` for `includedServices`, `visitWindows`, vehicle-specific pricing, billing period, currency, publication/active state, and `communities` eligibility. Package detail does not require `branchId`. Community marketplace listing prefers an operational branch when one exists, but does not hide a valid community offering solely because `branchId` is absent or `branchOperational` is false.

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
