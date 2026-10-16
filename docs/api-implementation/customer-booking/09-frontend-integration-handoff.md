# Frontend integration handoff

Use bearer tokens for every customer request. Send `Idempotency-Key` for hold and booking creation. Treat all money from `POST /pricing/calculate` and the persisted booking snapshot as authoritative; never submit a total to `POST /bookings`.

For a community booking, select an active customer community and send `location: { "fulfilmentType": "community", "communityId": "..." }`. For an address booking send the customer-owned `addressId`.

Use `GET /catalog/discover` to obtain the stable `vendorId`, `branchId`, and `serviceId` needed by availability/pricing/booking. Use an active hold before posting a booking. Handle `HOLD_EXPIRED`, `HOLD_ALREADY_CONSUMED`, `SLOT_UNAVAILABLE`, `COMMUNITY_NOT_SERVED`, `VEHICLE_NOT_OWNED`, and idempotency conflicts as actionable errors.

There is no implemented payment API. Keep payment UI behind feature gating until a verified gateway-backed Payment Service is deployed. Do not call `POST /bookings/{id}/confirm`; it no longer exists publicly.
