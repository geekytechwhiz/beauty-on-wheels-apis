# user-service

Customer profile, addresses, operational notification preferences, and community membership for Beauty on Wheels.

Provider profiles and KYC stay in `vendor-service`. This service does not deploy those routes.

## API

All routes use the shared platform authorizer.

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/users?phone=` | Service principal or admin. Returns `{ id, phone, status }`. |
| `GET` | `/users/{userId}` | Owner, admin, or service principal |
| `GET` | `/customers/{userId}` | Owner, admin, or service principal |
| `PUT` | `/customers/{userId}` | Owner or admin. Creates the profile when it is missing |
| `GET` | `/users/{userId}/addresses` | Owner, admin, or service principal |
| `POST` | `/users/{userId}/addresses` | Owner or admin |
| `PUT` | `/users/{userId}/addresses/{addressId}` | Owner or admin |
| `DELETE` | `/users/{userId}/addresses/{addressId}` | Owner or admin. Soft delete |
| `GET` | `/users/{userId}/preferences` | Owner, admin, or service principal |
| `PUT` | `/users/{userId}/preferences` | Owner or admin |
| `POST` | `/communities` | Admin |
| `GET` | `/communities` | Admin |
| `GET` | `/communities/{communityId}` | Admin |
| `PUT` | `/communities/{communityId}` | Admin |
| `DELETE` | `/communities/{communityId}` | Admin. Sets `inactive` |
| `GET` | `/customers/{userId}/communities` | Owner, admin, or service principal |
| `PUT` | `/customers/{userId}/communities` | Admin. Replaces membership |

Service principal roles: `service`, `service_principal`, `whatsapp`, `notification`.

`status` and `loyaltyPoints` on a customer profile are admin-only. Marketing consent is rejected on the profile and on preferences.

Phone values are E.164. In `GET /users?phone=`, encode `+` as `%2B`. A leading space left by query-string decoding is treated as `+`.

Operational preferences are `whatsapp`, `sms`, `email`, and `push`. A customer with no saved row is treated as opted in on all four channels.

The first active address is the default. `isDefault: true` moves the default. Deleting the default promotes the most recently updated active address. The only active address stays the default.

## Data

Table `user-service-${stage}-user`. See [USER_SERVICE_DATABASE.md](../../docs/services/user-service/requirements/USER_SERVICE_DATABASE.md).

## Tests

```bash
npx nx test user-service
```
