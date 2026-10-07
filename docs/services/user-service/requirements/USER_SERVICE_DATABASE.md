# User Service — DynamoDB

## Table

- Name: `user-service-${stage}-user` (env: `DYNAMODB_TABLE_NAME`)
- Keys: `PK` (HASH), `SK` (RANGE)
- Billing: `PAY_PER_REQUEST`
- Encryption: SSE enabled
- Point-in-time recovery: enabled
- Streams: off. Nothing in this service publishes from the table yet.

Customer data for one person lives in `USER#{userId}`. Phone lookup and communities use their own partitions so a phone or community read does not scan users.

## Access patterns

| # | Pattern | Operation | Index | Key condition |
| --- | --- | --- | --- | --- |
| 1 | Get customer profile | GetItem | base | `PK=USER#{userId}`, `SK=PROFILE` |
| 2 | Create or update profile and phone lookup | TransactWrite | base | Profile item plus `PK=PHONE#{e164}`, `SK=LOOKUP` |
| 3 | Resolve a user from a phone | GetItem | base | `PK=PHONE#{e164}`, `SK=LOOKUP` |
| 4 | List addresses | Query | base | `PK=USER#{userId}` AND `begins_with(SK, ADDR#)` |
| 5 | Get, update, or soft-delete one address, and move the default | TransactWrite | base | `SK=ADDR#{addressId}` and `Update` on `SK=PROFILE` |
| 6 | Get or replace operational preferences | GetItem / Put | base | `SK=PREFERENCES` |
| 7 | Get community | GetItem | base | `PK=COMMUNITY#{communityId}`, `SK=META` |
| 8 | List communities | Query | GSI1 | `GSI1PK=COMMUNITY` |
| 9 | Read community membership | GetItem | base | `communityIds` on `PROFILE` |
| 10 | Replace community membership | TransactWrite | base | `Update` `PROFILE.communityIds`, put/delete `SK=MEMBER#{communityId}` |

## Item types

| PK | SK | entityType | Purpose |
| --- | --- | --- | --- |
| `USER#{userId}` | `PROFILE` | `CustomerProfile` | Customer profile, `communityIds`, `defaultAddressId` |
| `PHONE#{e164}` | `LOOKUP` | `PhoneLookup` | One phone maps to one user. Stores `userId`, `phone`, `status` |
| `USER#{userId}` | `ADDR#{addressId}` | `Address` | Address. `status=deleted` is a soft delete |
| `USER#{userId}` | `PREFERENCES` | `OperationalPreferences` | WhatsApp, SMS, email, and push flags |
| `COMMUNITY#{communityId}` | `META` | `Community` | Community record |
| `USER#{userId}` | `MEMBER#{communityId}` | `CommunityMembership` | Customer membership row |

## GSIs

| Index | Access pattern | GSI1PK | GSI1SK | Notes |
| --- | --- | --- | --- | --- |
| GSI1 | List communities, newest first | `COMMUNITY` | `{createdAt}#{communityId}` | On community `META` only. Phone lookup does not use this index |

A status filter on the community list is a `FilterExpression`. DynamoDB applies `Limit` before the filter, so a page can be short.

## Idempotency

- Profile create: `attribute_not_exists(PK)` on `PROFILE`.
- Phone claim: `attribute_not_exists(PK) OR userId = :userId` on the lookup item, in the same transaction as the profile.
- Changing a phone deletes the previous lookup item only when that item belongs to the same user.
- Address ids are generated. Updates require the address item to exist.
- One active default per user. The profile `defaultAddressId` is updated in the same transaction as the address flags.
- Community create uses a new id and `attribute_not_exists`.
- Membership replace writes `communityIds` on the profile and the membership rows together.

## API ↔ storage

| API | Operation |
| --- | --- |
| `PUT /customers/{userId}` | TransactWrite profile + phone lookup |
| `GET /users?phone=` | GetItem phone lookup. Service principal or admin |
| `GET/PUT /users/{userId}/addresses` | Query or TransactWrite `ADDR#` |
| `GET/PUT /users/{userId}/preferences` | GetItem / Put `PREFERENCES`. A missing row is treated as all channels enabled and is not written by GET |
| `PUT /customers/{userId}/communities` | TransactWrite profile `communityIds` and `MEMBER#` rows |

Marketing consent is not stored.
