 
## CONTEXT

You are working inside an existing **Nx monorepo (`api-hub`)** that uses:

* **TypeScript**
* **Serverless Framework (AWS Lambda + API Gateway)**
* **DynamoDB**
* **Nx module boundaries**
* **Shared libraries under `libs/`**
* **Standalone services under `services/` (NOT apps)**

You MUST strictly follow:

* Repository structure
* Coding standards
* Error handling
* Logging
* Validation
* API response format
* Serverless patterns

Refer and comply with:

* Root workspace README
* Full codebase reference in `docs/CODEBASE_README.md`

Do NOT invent new conventions.

---

## OBJECTIVE

Generate a **Partner Registry microservice** that manages:

* Third-party partners (labs, external hospitals)
* Partner capabilities (FHIR / NON_FHIR)
* Organization ↔ Partner relationships
* Partner endpoints (API / WEBHOOK / FHIR)
* Partner lifecycle (activate / suspend)
* Audit events (no PII)

This service is **internal-only** (not exposed to patients).

---

## SERVICE PLACEMENT (MANDATORY)

Create the service **ONLY** under:

```
services/partner-registry/
```

❌ Do NOT place this under `apps/`
❌ Do NOT mix with organization-service
❌ Do NOT add FHIR APIs here

---

## REQUIRED NX STRUCTURE

```
services/partner-registry/
├── project.json
├── serverless.yml
├── src/
│   ├── handlers/
│   │   ├── health.ts
│   │   ├── createPartner.ts
│   │   ├── updatePartner.ts
│   │   ├── getPartner.ts
│   │   ├── setPartnerCapability.ts
│   │   ├── linkOrgPartner.ts
│   │   └── listOrgPartners.ts
│   ├── httpHandler.ts
│   ├── services/
│   │   └── partner.service.ts
│   ├── repositories/
│   │   └── partner.repository.ts
│   ├── models/
│   │   ├── partner.model.ts
│   │   └── capability.model.ts
│   ├── validation/
│   │   ├── createPartner.schema.ts
│   │   ├── updatePartner.schema.ts
│   │   ├── capability.schema.ts
│   │   └── orgPartner.schema.ts
│   ├── utils/
│   │   └── errors.ts
│   └── index.ts
```

Handlers must be **thin** and delegate logic to `httpHandler.ts`.

---

## SHARED LIBRARIES (USE / CREATE)

### MUST USE existing libs:

* `@api-hub/logger`
* `@api-hub/utils` (ApiResponse, helpers)
* `@api-hub/error-messages`
* `@api-hub/canonical`
* `@api-hub/capability` (if applicable)

### CREATE NEW LIB (if not present):

```
libs/partners/
├── src/
│   ├── models/
│   │   ├── partner.types.ts
│   │   └── capability.types.ts
│   └── registry/
│       ├── getPartner.ts
│       ├── getPartnerCapability.ts
│       └── getPartnersForOrg.ts
```

Rules:

* Libs are **read-only helpers**
* NO DynamoDB writes in libs
* NO AWS config in libs

---

## DATABASE (MANDATORY)

Use **DynamoDB single-table design**:

```
Table: IntegrationRegistry
PK: string
SK: string
```

Patterns to implement in repository:

* `PARTNER#{partnerId} / META`
* `PARTNER#{partnerId} / CAPABILITY`
* `ORG#{orgId} / PARTNER#{partnerId}`
* `ENDPOINT#{API|WEBHOOK|FHIR}`
* `AUDIT#{timestamp}`

Use **LSIs exactly as designed**:

* LSI1 → relationship type
* LSI2 → status
* LSI3 → interop mode
* LSI4 → endpoint type
* LSI5 → audit ordering

NO scans.
NO GSIs unless explicitly required.

---

## API ENDPOINTS TO IMPLEMENT

All APIs are **internal**, REST-based.

| Method | Path                           | Purpose                        |
| ------ | ------------------------------ | ------------------------------ |
| GET    | /health                        | Health check                   |
| POST   | /partner                       | Create partner                 |
| PATCH  | /partner/{id}                  | Update partner                 |
| GET    | /partner/{id}                  | Get partner                    |
| PUT    | /partner/{id}/capability       | Set FHIR / NON_FHIR capability |
| POST   | /organization/{orgId}/partner  | Link org ↔ partner             |
| GET    | /organization/{orgId}/partners | List partners for org          |

---

## CODING RULES (STRICT)

* Use **Zod** for validation
* Use **ApiResponse** for ALL responses
* Use **message keys**, not raw strings
* Use **custom errors** mapped to HTTP codes
* Use **@api-hub/logger** with correlationId
* No business logic in handlers
* No HTTP calls in repositories
* No DynamoDB access in services outside repository
* Respect Nx module boundaries

---

## SERVERLESS REQUIREMENTS

* Serverless Framework v3
* `serverless-esbuild`
* REST API (not httpApi)
* CORS via shared config
* IAM: least privilege (DynamoDB table + LSIs)
* Environment variable:

  ```
  INTEGRATION_REGISTRY_TABLE
  ```

---

## OUTPUT EXPECTATION

Generate:

1. Full service code
2. serverless.yml
3. project.json
4. All handlers, services, repositories
5. Zod schemas
6. Error classes
7. Shared lib code (if missing)
8. Clear TODO comments only where external dependencies are required

Do **NOT** generate tests unless patterns already exist.

Do **NOT** generate documentation text — generate **production-ready code**.

---

## FINAL CHECK BEFORE FINISHING

Before completing:

* Verify imports use `@api-hub/*`
* Verify ApiResponse usage everywhere
* Verify logger usage
* Verify no organization master data duplication
* Verify DynamoDB access patterns match design
 