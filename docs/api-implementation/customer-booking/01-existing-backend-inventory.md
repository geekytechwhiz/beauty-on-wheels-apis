# Existing backend inventory

Investigation on 2026-10-17 found these booking domains already present: identity-v1, user, vehicle, vendor, service-catalog, availability, booking, email, and WhatsApp channel services. There is no `payment-service` application, payment DynamoDB table, payment gateway adapter, payment webhook route, or gateway secret configuration.

| Capability | Owner | Actual status |
| --- | --- | --- |
| Authentication/session/profile | identity-v1 | Exists; preserved |
| Customer profiles, addresses, communities | user-service | Exists under `/customers/{userId}`, `/users/{userId}/addresses`, and `/communities` |
| Vehicles/types | vehicle-service | Exists and self-scoped |
| Customer service discovery | service-catalog-service | Exists as `GET /catalog/discover` |
| Vendor profile/checkout eligibility | vendor-service | Exists; checkout eligibility is an internal Lambda |
| Slot inventory/holds/allocation | availability-service | Exists with conditional writes and internal consume/release Lambdas |
| Authoritative calculation | service-catalog-service | Exists as `POST /pricing/calculate` |
| Booking create/read/cancel | booking-service | Exists and was hardened in this change |
| Payment initiation/verification | — | Missing |

The frontend-audit documents named in the assignment were not present in this workspace.
