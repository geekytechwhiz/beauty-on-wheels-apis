# Service catalog — DynamoDB

## Table

- Name: `service-catalog-service-${stage}-service-catalog`
- Keys: `PK` (HASH), `SK` (RANGE)
- Defined in `apps/service-catalog-service/serverless.yml`

## Ownership

Master categories are platform rows (`PK = CAT#<categoryId>`, `SK = META`). They are created by script and have no `vendorId`.

Services, packages, and add-ons store `vendorId`. That value is set on create and is not changed by update.

## Item types

| PK | SK | entityType | Purpose |
| --- | --- | --- | --- |
| `CAT#<categoryId>` | `META` | `CATEGORY` | Master category |
| `CAT#<categoryId>` | `SERVICE#<serviceId>` | `SERVICE` | Vendor service under a category |
| `SERVICE#<serviceId>` | `META` | `SERVICE_LOOKUP` | Resolve a service without its category |
| `CAT#<categoryId>` | `SERVICE#<serviceId>#ADDON#<addonId>` | `ADDON` | Vendor add-on under a service |
| `ADDON#<addonId>` | `META` | `ADDON_LOOKUP` | Resolve an add-on by id |
| `PACKAGE#<packageId>` | `META` | `PACKAGE` | Vendor package |
| `PACKAGE#<packageId>` | `ITEM#...` | `PACKAGE_ITEM` | Package composition |
| `DISCOVERY#ALL` | `SERVICE#<serviceId>#BRANCH#<branchId>` | `SERVICE_DISCOVERY` | Marketplace projection for every category |
| `DISCOVERY#CATEGORY#<categoryId>` | `SERVICE#<serviceId>#BRANCH#<branchId>` | `SERVICE_DISCOVERY` | Marketplace projection for one category |
| `DISCOVERY#SERVICE#<serviceId>` | `BRANCH#<branchKey>` | `DISCOVERY_POINTER` | Locates the two projection rows for one offering |
| `DISCOVERY_VENDOR#<vendorId>` | `META` | `DISCOVERY_VENDOR_STATE` | Local copy of vendor approval. Not on GSI2 |
| `DISCOVERY_BRANCH#<vendorId>` | `BRANCH#<branchId>` | `DISCOVERY_BRANCH_STATE` | Local copy of branch location and coverage. Not on GSI2 |
| `DISCOVERY_PRICE#<vendorId>` | `SERVICE#<serviceId>` | `DISCOVERY_PRICE_STATE` | Local copy of a provider price. Not on GSI2 |

## GSI2 — vendor catalog and marketplace discovery

GSI2 is the existing vendor-catalog index. Discovery uses different partition keys on that same index.

| Index | Access pattern | GSI2PK | GSI2SK |
| --- | --- | --- | --- |
| GSI2 | List a vendor's services | `VENDOR#<vendorId>` | `begins_with SERVICE#` or `SERVICE#<categoryId>#` |
| GSI2 | List a vendor's packages | `VENDOR#<vendorId>` | `begins_with PACKAGE#` |
| GSI2 | List a vendor's add-ons | `VENDOR#<vendorId>` | `begins_with ADDON#` or `ADDON#<serviceId>#` |
| GSI2 | Discover services | `DISCOVERY#ALL` | `SERVICE#<serviceId>#BRANCH#<branchId>` |
| GSI2 | Discover services in one category | `DISCOVERY#CATEGORY#<categoryId>` | `SERVICE#<serviceId>#BRANCH#<branchId>` |

Vendor catalog rows stay on `VENDOR#<vendorId>`. Discovery rows are separate items, so a vendor list does not return marketplace projections. Discovery queries GSI2. It does not scan the table.

Approval, branch location, service-area radius, and provider prices are copied from Vendor Service. Missing facts stay ineligible. `branchId` is `UNASSIGNED` until a branch exists.

Name uniqueness stays on GSI1. A service name is unique per vendor and category (`TYPE#SERVICE#VENDOR#<vendorId>#CAT#<categoryId>`). A package name is unique per vendor (`TYPE#PACKAGE#VENDOR#<vendorId>`).

## API

| API | Operation | Keys |
| --- | --- | --- |
| `GET /services?vendorId=` | Query GSI2 | `VENDOR#<vendorId>` / `SERVICE#` |
| `POST /services` | TransactWrite | Category partition plus GSI2 vendor keys. Body `vendorId` is required. |
| `GET/PUT/DELETE /services/{serviceId}?vendorId=` | GetItem | Existing category key, then reject a different `vendorId` |
| `GET /packages?vendorId=` | Query GSI2 | `VENDOR#<vendorId>` / `PACKAGE#` |
| `GET /addons?vendorId=` | Query GSI2 | `VENDOR#<vendorId>` / `ADDON#` |
| `GET /catalog/discover` | Query GSI2 | `DISCOVERY#ALL` or `DISCOVERY#CATEGORY#<categoryId>` |

Deploying this index is a table update. DynamoDB allows one GSI addition per update.
