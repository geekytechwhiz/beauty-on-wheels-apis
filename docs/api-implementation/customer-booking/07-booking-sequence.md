# Booking sequence

```text
Customer -> Catalog discovery -> Provider/branch from discovery
Customer -> Availability -> Slot hold (idempotent)
Customer -> Catalog pricing -> authoritative amount/version
Customer -> Booking -> validates vehicle, customer location, vendor/branch, slot, hold, offering
Booking -> Availability -> consumes hold
Customer -> Payment Service (not yet implemented)
Gateway webhook -> Payment Service verifies signature and settlement (not yet implemented)
Payment Service -> booking internal confirmPaidBooking -> CONFIRMED + PAID
```

Until the last two steps exist, the flow stops at a payment-pending booking. The mobile application must not claim success or call a confirmation endpoint.
