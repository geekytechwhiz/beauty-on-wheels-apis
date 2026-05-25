# `@api-hub/fhir` Developer Guide

This guide is the **source of truth for current behavior** of the FHIR library and its integration with `@api-hub/middleware` via `withApiHandler`.

For planned gateway features (inbound FHIR, HAPI validation, OAuth gates, content negotiation), see [FHIR Implementation Flow](./implementation/FHIR_IMPLEMENTATION_FLOW.md) — that document describes **target architecture**, not everything implemented today.

**Quick-start:** [WITH_API_HANDLER_QUICKSTART.md](../../../libs/fhir/doc/WITH_API_HANDLER_QUICKSTART.md)

---

## 1. What this library is (and is not)

### What it is

`@api-hub/fhir` is a **declarative canonical ↔ FHIR R4 transformation library**. It provides:

- JSON-driven field mappings (canonical domain objects → FHIR resources)
- A generic mapping engine with strict and hybrid modes
- Multi-resource projection with explicit type selection and signal-based fallback
- Lightweight validation (resource type + top-level required fields)
- FHIR `OperationOutcome` error shaping
- Client-specific mapping overrides

**Primary integration path:** `@api-hub/middleware` via `withApiHandler({ fhir: ... })`.

### What it is not

- A FHIR REST server or full gateway
- Searchset bundles with pagination links (only `collection` bundles are exported today)
- Content-negotiated FHIR-only responses (`Accept: application/fhir+json` is not wired into `withApiHandler`)
- Inbound FHIR → canonical conversion in middleware (API exists; not wired in handlers)
- Profile validation, terminology validation, or HAPI `$validate` integration
- OAuth2 scope, tenant isolation, consent, or audit enforcement (remain middleware/service concerns)

---

## 2. `withApiHandler` middleware reference

Handlers use `withApiHandler` from `@api-hub/middleware` for the standard HTTP Lambda pipeline. FHIR projection is **opt-in** via the `fhir` option.

### Handler signature

```typescript
import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

export const main = withApiHandler(
  {
    operation: 'getUser',           // required — used for logging, tracing, metrics
    schema?: z.ZodType,             // optional — validates full API Gateway event body
    bodySchema?: z.ZodType,         // optional — validates req.body after context build
    validator?: (req) => void,      // optional — tenant/auth checks after body parse
    fhir?: FhirHandlerOptions,      // optional — enables FHIR sibling projection
  },
  async (req: LambdaRequest) => {
    return { /* canonical domain object */ };
  },
);
```

### Middleware pipeline order

When API Gateway invokes the handler, middleware runs outer-to-inner:

1. `httpApiErrorMiddleware` — catches errors, returns API Gateway response
2. `contextMiddleware` — correlation ID, transport hints
3. `invocationContextMiddleware` — attaches `operation`
4. `loggerMiddleware` — observability context
5. `tracerMiddleware` — X-Ray / Powertools tracing
6. `requestParserMiddleware` — parses JSON `event.body`
7. `schemaValidationMiddleware` — Zod validation on `options.schema`
8. `performanceMiddleware` — latency metrics

Inside the adapted handler, `withApiHandler` then:

1. Builds `LambdaRequest` via `buildRequestContext(event)` (JWT → `userContext`)
2. Attaches child logger, correlation ID, trace ID to `req.context`
3. Runs `bodySchema` and `validator` if configured
4. Invokes your handler
5. Wraps the result in `successResponse` — optionally adding a sibling `fhir` Bundle

### Request object

`buildRequestContext` produces a `LambdaRequest` with:

- `req.event` — raw API Gateway event (parsed body)
- `req.params` / `req.pathParameters` / `req.queryStringParameters`
- `req.body` — parsed JSON body (when applicable)
- `req.context.userContext` — `{ userId, organizationId }` from JWT
- `req.context.logger`, `correlationId`, `awsRequestId`, `traceId`, `operation`

JWT auth is decoded inside `buildRequestContext`; authorization (org scoping, RBAC) remains in service controllers.

### Response envelope

Standard success responses use `ApiResponse.ok`:

```json
{
  "success": true,
  "data": { /* canonical handler output — unchanged */ },
  "message": { "title": "SUCCESS", "description": "...", "severity": "SUCCESS" },
  "fhir": { /* optional FHIR Bundle — only when fhir option is enabled */ }
}
```

**Array results:** when the handler returns an array, canonical data is wrapped as `{ items: [...] }` while FHIR resources are aggregated into one `collection` Bundle.

If no FHIR resources can be generated, the `fhir` field is omitted.

### Architecture

```mermaid
flowchart TD
  subgraph handler [ServiceHandler]
    A[Return canonical object]
  end
  subgraph middleware [withApiHandler]
    B[buildApiExecutionPipeline]
    C[buildRequestContext]
    D[bodySchema / validator]
    E[handler req]
    F{isFhirEnabled?}
    G[transformToFhirResponse]
    H[successResponse data plus fhir]
  end
  subgraph fhirLib [@api-hub/fhir]
    I[FhirTransformationService]
    J[ResourceDiscoveryService]
    K[MappingResolver]
    L[GenericMapper]
    M[BundleBuilder]
  end
  A --> E
  B --> C --> D --> E
  E --> F
  F -->|No| H
  F -->|Yes| G --> I --> J --> K --> L --> M --> H
```

### Key files

| File | Responsibility |
|------|----------------|
| `libs/middleware/src/lib/withApiHandler.ts` | HTTP handler wrapper; opt-in FHIR |
| `libs/middleware/src/lib/fhir/transform-to-fhir-response.ts` | Builds FHIR Bundle from handler result |
| `libs/middleware/src/lib/error.middleware.ts` | `FhirValidationError` → `OperationOutcome` |
| `libs/fhir/src/services/fhir-transformation.service.ts` | Orchestrator: canonical ↔ FHIR, projection |
| `libs/fhir/src/services/resource-discovery.service.ts` | Resource type resolution |
| `libs/fhir/src/mapper/generic-fhir.mapper.ts` | Declarative field mapping engine |
| `libs/fhir/src/registry/mapping.registry.ts` | Base R4 mapping configs |
| `libs/fhir/src/registry/resource-registry.ts` | Resource metadata + detection rules |
| `libs/fhir/src/resolver/mapping.resolver.ts` | Resolves base + client mappings |
| `libs/fhir/src/builders/BundleBuilder.ts` | Builds `collection` bundles |
| `libs/fhir/src/bootstrap/index.ts` | Loads registries at library import |

---

## 3. Enabling FHIR on a handler

Return **canonical** data from your handler. Enable FHIR on `withApiHandler`:

```typescript
import { withApiHandler } from '@api-hub/middleware';

const handler = async (req) => {
  return {
    userID: 'user-123',
    firstName: 'Jane',
    lastName: 'Doe',
    emailAddress: 'jane@example.com',
    phoneNumber: '555-0100',
    patientId: '01K',
    mrn: 'PI-123',
  };
};

export const main = withApiHandler(
  { operation: 'getUser', fhir: { resourceType: 'Patient' } },
  handler,
);
```

### Production examples

| Service | Handler | FHIR config |
|---------|---------|-------------|
| user-service | `apps/user-service/src/handlers/getUser.ts` | `fhir: { resourceType: 'Patient' }` |
| alert-service | `apps/alert-service/src/handlers/http/getAlert.ts` | `fhir: { resourceType: 'Patient' }` |

Map handlers to the resource type that matches the payload shape. Avoid mapping alert payloads to `Patient` unless the canonical object is patient-shaped.

---

## 4. `FhirHandlerOptions` reference

Defined in `libs/middleware/src/lib/fhir/transform-to-fhir-response.ts`:

```typescript
type FhirHandlerOptions = {
  enabled?: boolean;       // force auto-detection of resource types
  resourceType?: string;   // single resource (alias: resource)
  resource?: string;
  resources?: string[];    // explicit multi-resource override
  version?: 'R4';
};
```

FHIR is enabled when any of `enabled`, `resourceType`, `resource`, or `resources` is set.

| Option | Behavior |
|--------|----------|
| `resourceType: 'Patient'` | Always project as Patient (recommended for production) |
| `resources: ['Patient', 'Practitioner']` | Project multiple explicit types |
| `enabled: true` | Auto-detect from payload signals (see section 6) |
| *(omitted)* | Standard API response only; no `fhir` field |

### Response example

```json
{
  "success": true,
  "data": { "userID": "user-123", "firstName": "Jane", "isLoggedIn": true },
  "message": { "title": "SUCCESS", "description": "...", "severity": "SUCCESS" },
  "fhir": {
    "resourceType": "Bundle",
    "type": "collection",
    "entry": [
      {
        "resource": {
          "resourceType": "Patient",
          "id": "user-123",
          "name": [{ "given": ["Jane"], "family": "Doe" }],
          "telecom": [
            { "system": "phone", "value": "555-0100" },
            { "system": "email", "value": "jane@example.com" }
          ],
          "extension": [
            { "url": "https://myvirtualrx.com/fhir/custom/mrn", "valueString": "PI-123" }
          ]
        }
      }
    ]
  }
}
```

- **`data`** — unchanged canonical handler output (including `firstName`, `isLoggedIn`, etc.).
- **`fhir`** — strict FHIR projection; canonical-only fields do not appear on the resource.

### Client ID resolution

Used for client-specific mapping overrides:

1. `req.context.clientId`
2. `x-client-id` / `X-Client-Id` header
3. `'default'`

---

## 5. Library bootstrap

Registries are populated automatically when `@api-hub/fhir` is imported (`libs/fhir/src/index.ts` calls `bootstrapFhirLibrary()`):

1. **`bootstrapRegistry()`** — loads generated `ResourceConfig` entries from `libs/fhir/src/generated/resource-config/R4/` into `resourceRegistry`
2. **Curated mappings** — merges hand-authored JSON from `libs/fhir/src/mappings/R4/` into both `mappingRegistry` and `resourceRegistry`, applying detection rules from `libs/fhir/src/bootstrap/curated-detection.ts`

Codegen defaults set `detection.enabled: false`. Production resources (Patient, Practitioner, Organization, RelatedPerson) get curated detection rules at bootstrap.

---

## 6. Resource type resolution

Resource types are resolved in this order:

1. **Handler config** — `fhir.resourceType`, `fhir.resource`, or `fhir.resources` on `withApiHandler`
2. **Payload declaration** — canonical `resourceType` or `resources[]` on the object
3. **Fallback signals** — field heuristics on `ResourceConfig.detection` (only when neither explicit source applies)

| Resource | Fallback detection signals | Production ready |
|----------|----------------------------|------------------|
| **Patient** | `patientId`, `mrn` | Yes |
| **Practitioner** | `reporterName`, `reporterEmail` | Yes |
| **Organization** | `organizationId`, `organizationID`, `organizationName`, `orgName` | Yes |
| **RelatedPerson** | `invitedBy`, `caregiverName`, `caregiverEmail`, `caregiverPhone`, `caregiverId` | Yes |
| **Observation** | *(disabled)* | **No** — scaffold only |

When multiple fallback signals match (and no explicit type is set), **all matching resources run** and produce multiple bundle entries (e.g. Patient + Practitioner from one alert payload).

**Prefer explicit `resourceType` / `resources` in handler options** for production handlers.

---

## 7. Transformation modes

Use the right API for your integration point.

| Method | Use case | Validation default |
|--------|----------|-------------------|
| `transformToProjection(data, options)` | Middleware path; explicit types + signal fallback + strict map | On (`validate: true`) |
| `transformCanonicalToFhir(type, canonical, clientId, config)` | Explicit resource type; programmatic use | On (`validate !== false`) |
| `transformCanonicalToHybridFhir(type, canonical, clientId, config)` | Transitional APIs needing both shapes | Off unless `config.validate === true` |
| `transformFhirToCanonical(type, resource, clientId)` | Inbound FHIR ingestion (future handlers) | N/A |

### Direct library usage (outside middleware)

```typescript
import { FhirTransformationService } from '@api-hub/fhir';

const service = new FhirTransformationService();

const patient = await service.transformCanonicalToFhir(
  'Patient',
  canonicalPayload,
  'acme-client',
  { validate: true },
);
```

---

## 8. Adding and editing mappings

### Hand-authored mapping location

```
libs/fhir/src/mappings/R4/{Resource}.mapping.json
```

Curated mappings are registered at bootstrap. Generated scaffolds live in `libs/fhir/src/generated/templates/R4/` and must be hand-edited before use.

### Mapping field schema

```json
{
  "source": "fullName",
  "target": "name.0.given.0",
  "fieldType": "string",
  "transform": "firstName",
  "template": "Organization/{{value}}",
  "defaultValue": "phone",
  "system": "http://hl7.org/fhir/administrative-gender",
  "required": false
}
```

| Property | Purpose |
|----------|---------|
| `source` | Dot-path into canonical object (`object-path` syntax). Empty string with `defaultValue` sets a literal. |
| `target` | Dot-path on FHIR resource |
| `fieldType` | Documentation / future validation hint |
| `transform` | `firstName`, `lastName`, or `dateOfBirth` |
| `template` | String template; `{{value}}` replaced with source value |
| `defaultValue` | Used when `source` is empty or value is missing |
| `system` | Terminology system URI; value normalized via `@api-hub/terminology` |

### Extensions

Non-standard clinical or platform fields belong in FHIR extensions:

```json
{
  "extensions": [
    {
      "source": "mrn",
      "url": "https://myvirtualrx.com/fhir/custom/mrn",
      "valueType": "string"
    },
    {
      "source": "medicalHistory",
      "url": "https://myvirtualrx.com/fhir/custom/medical-history",
      "valueType": "json"
    }
  ]
}
```

Supported `valueType`: `string`, `boolean`, `integer`, `date`, `code`, `json`.

### Client-specific overrides

1. Create `libs/fhir/src/mappings/clients/{clientId}/R4/{Resource}.mapping.json` with override fields only.
2. Register in `libs/fhir/src/bootstrap/index.ts` (or extend bootstrap to load client directories):

```typescript
clientMappingRegistry.register('acme', {
  resource: 'Patient',
  version: 'R4',
  fields: [/* override fields only */],
  // ... remaining ResourceConfig fields
});
```

Overrides merge by **target path**: client fields replace base fields with the same target; new targets are appended.

### Codegen scripts

After StructureDefinition changes in `src/package/r4/`:

```bash
npm run fhir:generate-resources   # → generated/resources/R4/*.metadata.json
npm run fhir:generate-mappings    # → generated/templates (scaffold only; hand-edit before use)
npm run fhir:generate-config      # → generated/resource-config/R4/*.config.ts
npm run fhir:generate-scopes      # → generated/scopes
```

Re-run tests after codegen: `nx test fhir`.

---

## 9. Platform fields excluded from FHIR output

Strict mapping only copies declared targets. These platform fields must never appear in FHIR resources:

- `isLoggedIn`, `logoutRequired`, `tokenUpdatedAt`
- `createdAt`, `status`, `roleName`, `roleID`

Defined in `libs/fhir/src/constants/excluded-fields.ts`. Tests in `fhir-projection.spec.ts` verify they are absent from projection output.

---

## 10. Error handling

| Error | HTTP | Code | When |
|-------|------|------|------|
| `FhirValidationError` | 422 | `FHIR_VALIDATION_FAILED` | Required fields missing, wrong `resourceType` |
| Mapping not found | 500 | `FHIR_MAPPING_NOT_FOUND` | Resource/version not in registry |

When a handler throws `FhirValidationError`, `httpApiErrorMiddleware` returns a raw FHIR `OperationOutcome` with `Content-Type: application/fhir+json` (not the standard API envelope).

Example validation issue shape:

```typescript
{
  severity: 'error',
  code: 'REQUIRED_FIELD_MISSING',
  diagnostics: 'Required field missing: status',
  field: 'status',
}
```

---

## 11. Testing checklist

Before merging mapping or handler changes:

```bash
nx test fhir
nx test middleware --testPathPattern=fhir
```

- [ ] Add or update a projection test when introducing new canonical field aliases.
- [ ] Verify excluded platform fields never appear in `fhir.entry[].resource`.
- [ ] Confirm explicit `resourceType` override behaves as expected for composite payloads.
- [ ] If using client overrides, add resolver spec coverage for merge behavior.
- [ ] Do not enable `Observation` until mapping is hand-authored.

Relevant spec files:

- `libs/fhir/src/mapper/generic-fhir.mapper.spec.ts`
- `libs/fhir/src/services/fhir-transformation.service.spec.ts`
- `libs/fhir/src/services/fhir-projection.spec.ts`
- `libs/middleware/src/lib/withApiHandler.fhir.spec.ts`

---

## 12. Known limitations and roadmap

| Limitation | Status |
|------------|--------|
| Content negotiation (`Accept: application/fhir+json`) | `isFhirRequest()` exists; not wired into `withApiHandler` |
| Searchset bundles / pagination links | Not exported |
| Profile / schema / terminology validation | Stub files only |
| Observation mapping | Auto-generated scaffold — not production-ready |
| Inbound FHIR in middleware | Not wired |
| HAPI / HL7 `$validate` | Documented as planned; not in library |
| R5 support | Type-only; no mappings |

### Related documentation

| Document | Purpose |
|----------|---------|
| [WITH_API_HANDLER_QUICKSTART.md](../../../libs/fhir/doc/WITH_API_HANDLER_QUICKSTART.md) | Copy-paste quick-start |
| [FHIR Implementation Flow](./implementation/FHIR_IMPLEMENTATION_FLOW.md) | **Planned** end-to-end gateway flow |
| [FHIR Adapter Architecture Review](./requirements/FHIR_ADAPTER_ARCHITECTURE_REVIEW.md) | Decentralized adapter strategy |
| [FHIR Mapping AI Agent Guide](./ai-agent/FHIR_MAPPING_AI_AGENT_GUIDE.md) | AI-assisted mapping generation |

---

## 13. FAQ

**Q: Should I change my handler to return FHIR instead of canonical JSON?**  
No. Return canonical data; enable `fhir` on `withApiHandler`. Clients choose which representation to consume.

**Q: Why is the `fhir` field missing from my response?**  
No mapper matched the payload, or transformation returned zero resources. Set an explicit `resourceType` on the handler (recommended), or ensure detection signals are configured in `curated-detection.ts`.

**Q: Can one handler return multiple FHIR resources?**  
Yes. Use `resources: ['Patient', 'Practitioner']` on the handler, or omit explicit types and rely on fallback signals for multiple types in one payload.

**Q: Where do I add consent and audit for FHIR responses?**  
In middleware and service layers — not in `@api-hub/fhir`.

**Q: How do I add a new resource type?**  
1) Author `mappings/R4/{Resource}.mapping.json`, 2) add detection rules to `bootstrap/curated-detection.ts` if auto-detection is needed, 3) register the mapping in `bootstrap/index.ts`, 4) add tests.

**Q: Does FHIR projection run validation?**  
Yes. The middleware path calls `transformToProjection`, which runs strict mapping with `validate: true` by default.
