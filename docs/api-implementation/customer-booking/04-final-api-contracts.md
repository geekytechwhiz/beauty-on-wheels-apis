# Final API contracts

## Implemented and safe for customer use

| Method/path | Owner | Authentication | Notes |
| --- | --- | --- | --- |
| `GET /vehicles`, `POST /vehicles`, `GET /vehicle-types` | vehicle | Bearer | authenticated customer garage |
| `GET /customers/{customerId}` | user | Bearer | caller must use their authorizer identity |
| `GET|POST /users/{customerId}/addresses` | user | Bearer | customer-owned addresses |
| `GET /communities` | user | Bearer | serviceability data |
| `GET /catalog/discover` | catalog | Bearer | service discovery with vendor/branch ids |
| `POST /pricing/calculate` | catalog | Bearer | authoritative price/version only |
| `GET /vendors/{vendorId}/availability` | availability | Bearer | available inventory |
| `POST|GET|DELETE /slot-holds` | availability | Bearer | `Idempotency-Key` is required on create |
| `POST /bookings` | booking | Bearer + `Idempotency-Key` | server-side validation and price snapshot |
| `GET /bookings`, `GET /bookings/{id}`, `POST /bookings/{id}/cancel` | booking | Bearer | customer-scoped |

`POST /bookings/{id}/confirm` is deliberately not a public API. `confirmPaidBooking` is a direct-Lambda-only handler accepting `{bookingId, amount, currency}` after trusted gateway verification.

Payment endpoints are not implemented and must not be substituted with simulated client confirmation.
