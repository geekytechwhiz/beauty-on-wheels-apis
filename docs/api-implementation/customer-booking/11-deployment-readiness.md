# Deployment readiness

Booking Service code type-checks, but the complete customer booking journey is not deployment-ready.

Required before enabling paid checkout:

1. Implement and deploy an owned Payment Service with a configured gateway secret, order creation, signed raw-body webhook verification, durable event de-duplication, reconciliation, and least-privilege invoke permission for `confirmPaidBooking`.
2. Add the Payment Service Lambda invoke permission to Booking Service and deploy both services together.
3. Replace finite availability expiry lookback with a durable catch-up/reconciliation mechanism and alarms.
4. Make allocation/release compensation durable and retryable.
5. Repair the Jest TypeScript configuration, then run unit, contract, concurrency, and deployed golden-path tests.

No deployment was attempted.
