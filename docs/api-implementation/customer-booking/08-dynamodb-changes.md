# DynamoDB changes

This change does not add tables or indexes. Booking continues to use its owned table with:

- booking details by `BOOKING#{id}`;
- customer and vendor lookups through `GSI1`;
- booking idempotency records by customer/key;
- one hold-to-booking lock per hold;
- optimistic version checks for transitions.

The future Payment Service requires its own table for `PAYMENT`, booking-to-payment lookup, idempotency, and gateway-event de-duplication records. It must not share or query the booking table.
