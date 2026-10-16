# Implementation summary

Changed Booking Service files:

- `src/integrations/catalog.client.ts`: adds mandatory vendor scope to offering lookup.
- `src/integrations/user.client.ts`: reads the customer profile needed for community authorization.
- `src/services/bookings.service.ts`: scopes customer reads/writes and adds verified-payment-only confirmation.
- `src/repositories/bookings.repository.ts`: separates booking state changes from payment settlement.
- `src/handlers/internal.ts`: direct Lambda payment-confirmation entry point.
- `serverless.yml`: removes unsafe public confirmation and direct-update routes and registers the internal handler.

No production fixture, client price, or client payment status is accepted by the create flow.
