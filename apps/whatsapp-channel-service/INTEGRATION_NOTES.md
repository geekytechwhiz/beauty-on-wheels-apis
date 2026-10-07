# Downstream integration matrix

Statuses:

- **VERIFIED** — path, method, and response shape match code in this repo, and that code is implemented.
- **FIXED** — the copied client called a path or body the service does not accept. The channel now calls the real contract.
- **BLOCKED** — the route exists, but the handler does not implement the behavior or the authorizer cannot represent the WhatsApp customer.
- **MISSING CONTRACT** — no service or route in this repo provides the capability. The channel does not invent one.
- **ASSUMPTION** — the route exists, but the request or response fields are not defined. The adapter is the only place that interprets them.

The platform HTTP envelope is `{ success, data, error, meta }`. List payloads inside `data` use `items` (catalog, booking) or `data` plus `pagination` (vendors). Calls send `Authorization: Bearer <service token>` and `X-Correlation-Id`. GETs retry on timeout and 503/429. Booking create, booking confirm, booking cancel, and pricing POSTs are not retried.

| Dependency | Endpoint | Method | Purpose | Auth | Request | Response | Status |
|---|---|---|---|---|---|---|---|
| Catalog | `/categories?active=true&limit=10&nextToken=` | GET | List active categories | Platform bearer | Query `active`, `limit`, `nextToken` | `{ items, nextToken, total }` with `id`, `name`, `active` | VERIFIED |
| Catalog | `/services?categoryId=&active=true&limit=10&nextToken=` | GET | List services in a category | Platform bearer | `categoryId` is required | `{ items, nextToken }` with `id`, `categoryId`, `name`, `active` | FIXED |
| Catalog | `/services/{serviceId}?categoryId=` | GET | Service details before review | Platform bearer | `categoryId` query is required | Service object | FIXED |
| Catalog | `/packages`, `/addons` | GET | Packages and add-ons | Platform bearer | — | List envelopes | VERIFIED, not called. The pilot flow is category → service. |
| Vendor | `/vendors?status=ACTIVE&limit=10` | GET | Provider list when no pilot ids are configured | Platform bearer, admin | Query `status`, `limit`, optional `cursor` | `{ data, pagination }` | VERIFIED route. BLOCKED for a non-admin service token (`assertAdminAccess`). |
| Vendor | `/vendors/{vendorId}` | GET | Provider name and status | Platform bearer, vendor access | Path `vendorId` | `Vendor` (`vendorId`, `businessName`, `status`, `operationalStatus`) | VERIFIED route. BLOCKED unless the service token is allowed to read that vendor. Pilot ids use this route. |
| Vehicle | `/vehicles` | GET | Vehicles for the signed-in user | Platform bearer, caller `userId` | No `userId` query. The service reads the JWT user. | Vehicle list | BLOCKED. There is no customer-scoped list. The channel drops rows whose `userId` is not the linked customer and does not show another person's vehicles. |
| Availability | `/vendors/{vendorId}/slots?date=` | GET | Slots for a provider and date | Platform bearer | `date` query | Slot list | ASSUMPTION on `date`, `id`, `startTime`, `endTime`, `status`, `available`. BLOCKED: `SlotsService.getslots` throws `Not Implemented`. |
| Availability | `/slots/{slotId}` | GET | Recheck a slot before booking | Platform bearer | Path `slotId` | Slot | ASSUMPTION. BLOCKED: `getslotid` throws `Not Implemented`. A 501/“Not Implemented” response is treated as unavailable and does not invent a slot. |
| Pricing | `/pricing/calculate` | POST | Price the selection | — | `{ vendorId, vehicleType, serviceIds, couponCode? }` | `{ total, subtotal, discount, tax, convenienceFee, currency }` | MISSING CONTRACT. No pricing service exists. The channel does not compute totals. Booking is refused until a total is returned. |
| Pricing | `/pricing/validate-coupon` | POST | Validate one coupon | — | `{ couponCode, vendorId }` | `{ valid, reason? }` | MISSING CONTRACT. Coupon rules are not implemented here. |
| Booking | `/bookings` | POST | Create a booking | Platform bearer | Booking schema only: `customerId`, `vendorId`, `vehicleId`, `serviceIds`, `bookingDate`, `slotId`, `totalAmount`, `paymentStatus`, `bookingStatus` | Booking | VERIFIED. Body was FIXED to the strict schema. Create is not retried. A local claim prevents a second create. |
| Booking | `/bookings/{bookingId}/confirm` | POST | Confirm a created booking | Platform bearer | Empty object | `{ id, bookingStatus }` | VERIFIED. Called only when status is `CREATED` or `PENDING`. |
| Booking | `/bookings/{bookingId}/cancel` | POST | Cancel | Platform bearer | Empty object | `{ id, bookingStatus: CANCELLED }` | VERIFIED. Preferred over `DELETE /bookings/{bookingId}`. |
| Booking | `/bookings/{bookingId}` | GET | Load an in-flight booking | Platform bearer | Path `bookingId` | Booking | VERIFIED. Used so a retry confirms instead of creating. |
| Booking | `/customers/{customerId}/bookings` | GET | Upcoming bookings | Platform bearer | Path `customerId` | Booking array, wrapped as `items` | VERIFIED. |
| Booking | `PUT /bookings/{bookingId}` | PUT | Reschedule | Platform bearer | Booking fields, status unchanged | Booking | VERIFIED contract, not exposed in the pilot chat. |
| User | `GET /users?phone=` | GET | Resolve a customer from a WhatsApp number | Platform bearer, service principal or admin | Query `phone` (E.164, encode `+` as `%2B`) | `{ id, phone, status }` | VERIFIED contract in user-service. The channel still stores `IDENT#WHATSAPP#<wa_id>` until it calls this route. |
| User | `PUT /customers/{userId}` | PUT | Customer profile | Platform bearer, owner or admin | Profile fields. `marketingConsent` is rejected | Customer profile | VERIFIED for profile fields. Marketing consent stays in this service and is not written to user-service. |

## Required user API

Implemented on user-service:

```text
GET /users?phone={e164}
```

Caller must be a service principal (`service`, `service_principal`, `whatsapp`, or `notification`) or an admin. Response `data` is `{ id, phone, status }` inside the platform envelope. The channel should store only `id` as `customerId` on the identity row.

## Required vehicle API

```text
GET /customers/{customerId}/vehicles
```

or `GET /vehicles?userId=` authorized for a service principal. The current `GET /vehicles` uses the caller's JWT and cannot list the WhatsApp customer's garage.

## Auth

There is no service-to-service client in the monorepo. Protected routes use the shared TOKEN authorizer (`infra/serverless/config/http-api-authorizer.yml`). This service does not load a separate service-auth secret. An optional local `SERVICE_AUTH_TOKEN` is sent as `Authorization: Bearer` when present, and that header is not logged. Health and webhook verification do not use it. The webhook routes are public because Meta calls them. GET verification compares `WHATSAPP_VERIFY_TOKEN`. POST checks `X-Hub-Signature-256` with `WHATSAPP_APP_SECRET` from the same JSON secret as the access token (`WHATSAPP_SECRET_NAME`). Signature validation fails closed until that field is stored.
