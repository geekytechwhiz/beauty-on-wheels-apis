# Test results

Executed on 2026-10-17:

| Check | Result |
| --- | --- |
| `pnpm exec tsc -p apps/booking-service/tsconfig.app.json --noEmit` | Pass |
| `pnpm exec nx build @api-hub/booking-service` | Pass |
| Targeted ESLint on changed Booking Service source | Pass with pre-existing `no-explicit-any` warnings in `bookings.service.ts` and `bookings.repository.ts` |
| `pnpm exec jest --config apps/booking-service/jest.config.cts --runInBand` | Not executed: Jest configuration fails before loading tests with TS5095 (`moduleResolution: bundler` with Jest's CommonJS config) |
| Deployed integration/golden-path test | Not run: no configured deployment, payment gateway, or payment service |

Do not interpret the type-check as E2E or payment verification.
