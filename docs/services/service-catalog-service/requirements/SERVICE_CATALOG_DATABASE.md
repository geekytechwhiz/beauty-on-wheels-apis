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

## GSI2 — vendor catalog

| Index | Access pattern | GSI2PK | GSI2SK |
| --- | --- | --- | --- |
| GSI2 | List a vendor's services | `VENDOR#<vendorId>` | `begins_with SERVICE#` or `SERVICE#<categoryId>#` |
| GSI2 | List a vendor's packages | `VENDOR#<vendorId>` | `begins_with PACKAGE#` |
| GSI2 | List a vendor's add-ons | `VENDOR#<vendorId>` | `begins_with ADDON#` or `ADDON#<serviceId>#` |

Only the canonical service, package, and add-on items carry `GSI2PK` / `GSI2SK`. Lookup rows and the `CATALOG#PACKAGES` aggregate do not, so a vendor list is not duplicated.

Name uniqueness stays on GSI1. A service name is unique per vendor and category (`TYPE#SERVICE#VENDOR#<vendorId>#CAT#<categoryId>`). A package name is unique per vendor (`TYPE#PACKAGE#VENDOR#<vendorId>`).

## API

| API | Operation | Keys |
| --- | --- | --- |
| `GET /services?vendorId=` | Query GSI2 | `VENDOR#<vendorId>` / `SERVICE#` |
| `POST /services` | TransactWrite | Category partition plus GSI2 vendor keys. Body `vendorId` is required. |
| `GET/PUT/DELETE /services/{serviceId}?vendorId=` | GetItem | Existing category key, then reject a different `vendorId` |
| `GET /packages?vendorId=` | Query GSI2 | `VENDOR#<vendorId>` / `PACKAGE#` |
| `GET /addons?vendorId=` | Query GSI2 | `VENDOR#<vendorId>` / `ADDON#` |

Deploying this index is a table update. DynamoDB allows one GSI addition per update.
