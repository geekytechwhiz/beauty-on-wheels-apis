# vendor-service

Provider aggregate for Beauty on Wheels: profile, onboarding, approval, operational status, geographic service areas, community assignment, weekly operating hours, branches, staff, documents, bank details, and catalog mappings.

## Ownership

Vendor Service owns provider configuration. It does not own catalog definitions, checkout price calculation, slot inventory, holidays, bookings, payments, or identity.

Holiday dates and slot blocks belong to Availability Service. This service keeps the weekly operating schedule at `GET/PUT /vendors/{vendorId}/operating-hours`. Availability should read that schedule when generating slots. There is no holiday store in this service.

## Lifecycle

Onboarding status and administrative status are separate.

Onboarding: `DRAFT` → `IN_PROGRESS` → `PENDING_REVIEW` when every required section is saved. `POST /vendors/{vendorId}/submit-review` records that explicitly and is idempotent once review is pending.

Administrative status:

- `PENDING_VERIFICATION` → `ACTIVE` only when onboarding is `PENDING_REVIEW` (or historical `COMPLETED`)
- `PENDING_VERIFICATION` → `REJECTED` requires `reason`
- `ACTIVE` → `SUSPENDED` or `INACTIVE`
- `SUSPENDED` → `ACTIVE` or `INACTIVE`

`POST /vendors/{vendorId}/approve` and `POST /vendors/{vendorId}/reject` use those rules. `PATCH /vendors/{vendorId}/status` uses the same rules. Repeating the current status does not write another history row.

Approval does not mint an email OTP. `VendorApproved` and `VendorRejected` are published from the vendor table stream onto the vendor event bus. `VendorEmailVerification.Requested` remains only for profile rows that still carry an OTP.

Operational status (`ONLINE`, `OFFLINE`, `BUSY`, `TEMPORARILY_UNAVAILABLE`) is separate. `ONLINE` and `BUSY` require lifecycle status `ACTIVE`.

## Communities and catalog

`/vendors/{vendorId}/communities` stores provider membership in business communities. Geographic coverage stays on `/vendors/{vendorId}/service-areas`. Community definitions live in User Service; this service checks id format only.

`/vendors/{vendorId}/services` and `/vendors/{vendorId}/packages` store enablement and an optional `priceOverride`. Each service mapping includes `categoryId` because Service Catalog looks up a service by category. Set `CATALOG_SERVICE_URL` to the catalog API base (including stage). Writes fail closed when the catalog cannot be reached. Checkout totals are not calculated here.

List vendors with `communityId` uses GSI3. Do not combine `communityId` with `city` or `postalCode`.

## Deploy

`CATALOG_SERVICE_URL` is required before catalog mappings can be saved. Adding GSI3 is a table update; existing vendors have no community rows until an admin assigns them.
