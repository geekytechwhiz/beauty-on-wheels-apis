# Vendor Service — DynamoDB

## Table
- Name: `vendor-service-${stage}-vendor` (env: `DYNAMODB_TABLE_NAME`)
- Keys: `PK` (HASH), `SK` (RANGE)
- Billing: PAY_PER_REQUEST
- Encryption: SSE enabled
- Streams: `NEW_AND_OLD_IMAGES`

Vendor-owned records live in a single partition `VENDOR#{vendorId}`. Singleton sections use a typed SK (`PROFILE`, `OWNER`, `ADDRESS`, `BANK`). Collections use prefixed SKs so list APIs are `begins_with` queries on the base table.

## Access patterns

| # | Pattern | Operation | Index | Key condition |
|---|---------|-----------|-------|----------------|
| 1 | Get vendor | GetItem | base | `PK=VENDOR#{vendorId}`, `SK=PROFILE` |
| 2 | Get onboarding state | GetItem | base | Same PROFILE item (`onboardingStatus`, `completedSections`, `currentSection`) |
| 3 | Resume onboarding (sections) | Query | base | `PK=VENDOR#{vendorId}` then group by SK prefix |
| 4 | Update BUSINESS_INFO | Put | base | `PK=VENDOR#{vendorId}`, `SK=PROFILE` |
| 5 | Create/update OWNER | Put | base | `PK=VENDOR#{vendorId}`, `SK=OWNER` |
| 6 | Get vendor by owner user | Query | GSI1 | `GSI1PK=OWNER#{userId}` |
| 7 | Create/update ADDRESS | Put | base | `PK=VENDOR#{vendorId}`, `SK=ADDRESS` (singleton; repeated PUTs overwrite) |
| 8 | Create/update BANK | Put | base | `PK=VENDOR#{vendorId}`, `SK=BANK` |
| 9 | List branches | Query | base | `PK=VENDOR#{vendorId}` AND `begins_with(SK, BRANCH#)` |
| 10 | Get/update/delete branch | GetItem / Put / Delete | base | `SK=BRANCH#{branchId}` |
| 11 | List documents | Query | base | `PK=VENDOR#{vendorId}` AND `begins_with(SK, DOCUMENT#)` |
| 12 | Get/update/delete document | GetItem / Put / Delete | base | `SK=DOCUMENT#{documentId}` |
| 13 | List staff | Query | base | `begins_with(SK, STAFF#)` |
| 14 | List capabilities assignment | GetItem | base | `SK=CAPABILITIES` |
| 15 | List service areas | Query | base | `begins_with(SK, SERVICE_AREA#)` |
| 16 | List vendors by lifecycle | Query | GSI1 | `GSI1PK=VENDOR`, `begins_with(GSI1SK, STATUS#{status}#)` |
| 17 | List vendors by city | Query | GSI2 | `GSI2PK=CITY#{city}` on PROFILE (denormalized when ADDRESS is saved) |

No additional GSIs: owner lookup reuses GSI1 with a different `GSI1PK` namespace (`OWNER#{userId}`). City lookup reuses GSI2 on PROFILE after ADDRESS writes.

## Item types

| PK | SK | entityType | Purpose |
|----|----|------------|---------|
| `VENDOR#{vendorId}` | `PROFILE` | `Vendor` | Business profile + onboarding progress + lifecycle |
| `VENDOR#{vendorId}` | `OWNER` | `VendorOwner` | Identity `userId` link (not auth credentials) |
| `VENDOR#{vendorId}` | `ADDRESS` | `VendorAddress` | Primary/business address (idempotent singleton) |
| `VENDOR#{vendorId}` | `BANK` | `VendorBank` | Banking details (omitted from standard Vendor GET) |
| `VENDOR#{vendorId}` | `BRANCH#{branchId}` | `VendorBranch` | One of many branches |
| `VENDOR#{vendorId}` | `DOCUMENT#{documentId}` | `VendorDocument` | Document metadata + S3 object key |
| `VENDOR#{vendorId}` | `STAFF#{staffId}` | `Staff` | Staff record; `userId` only when portal access is required |
| `VENDOR#{vendorId}` | `CAPABILITIES` | `VendorCapabilities` | Assignment IDs only (master catalog is not stored here) |
| `VENDOR#{vendorId}` | `SERVICE_AREA#{serviceAreaId}` | `ServiceArea` | Vendor-owned coverage area |
| `VENDOR#{vendorId}` | `HOURS` | `VendorOperatingHours` | Weekly operating schedule |

## GSIs

| Index | Access pattern | gsiNpk | gsiNsk | Notes |
|-------|----------------|--------|--------|-------|
| GSI1 | List vendors by status | `VENDOR` | `STATUS#{status}#OPERATIONAL#{op}#{createdAt}#{vendorId}` | On PROFILE |
| GSI1 | Get vendors owned by user | `OWNER#{userId}` | `VENDOR#{vendorId}` | On OWNER |
| GSI2 | List vendors by city/postal | `CITY#{CITY}` | `POSTAL#{postal}#{createdAt}#{vendorId}` | On PROFILE; written when ADDRESS is saved |

## Idempotency

- Vendor create: `attribute_not_exists(PK)` on PROFILE; owner uniqueness via pre-query on GSI1 `OWNER#{userId}`.
- ADDRESS / BANK / OWNER / BUSINESS_INFO: deterministic SKs so repeated PUTs update in place.
- BRANCH onboarding without `branchId` updates `primaryBranchId` when present; otherwise creates one branch.
- DOCUMENTS onboarding upserts by `documentType` (one current record per required type).
- Child creates ConditionCheck that PROFILE exists.

## Binary files

Document bytes are stored in S3 (`DOCUMENTS_BUCKET_NAME`). DynamoDB stores `bucket`, `objectKey`, `contentType`, and `documentType` only.
