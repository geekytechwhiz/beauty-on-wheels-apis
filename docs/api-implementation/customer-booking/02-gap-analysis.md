# Gap analysis

## Corrected in this change

- Booking service now calls `GET /services/{id}?vendorId=...`, matching the catalog contract.
- Booking service now reads `GET /customers/{id}` for community membership, rather than the user summary endpoint.
- Customer booking history, detail, update, cancellation, and status transitions derive the customer from the authorizer and reject another customer's record.
- The public `POST /bookings/{id}/confirm` route was removed. Confirmation can only use the internal `confirmPaidBooking` Lambda seam after a verified payment event.
- The repository no longer equates every transition to `CONFIRMED` with payment success. Only the internal verified-payment path explicitly writes `PAID`.

## Still blocking a complete paid booking flow

1. No Payment Service, payment table, Razorpay (or other gateway) secret, webhook, or deployed gateway configuration exists.
2. Availability expiry scans only a finite lookback window; a prolonged scheduler outage can leave stale capacity reserved.
3. Booking allocation/cancellation and availability release are a cross-service saga without a durable retry/outbox state.
4. Customer marketplace discovery is service-level only; packages/add-ons and a composed customer provider-detail endpoint are absent.
5. `PUT /bookings/{id}` was removed from the public API because it could replace slot data without reallocating inventory. A dedicated reschedule saga is still missing.

These are not reported as production-ready or E2E verified.
