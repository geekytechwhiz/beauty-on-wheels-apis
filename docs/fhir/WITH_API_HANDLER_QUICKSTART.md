# FHIR Quick-Start with `withApiHandler`

Add a FHIR R4 projection to any HTTP Lambda handler without changing your canonical response shape. FHIR appears as a sibling `fhir` field on the standard API envelope.

**Full guide:** [DEVELOPER_GUIDE.md](../../../docs/services/fhir-gateway/DEVELOPER_GUIDE.md)

---

## Minimal example

```typescript
import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

const handler = async (req: LambdaRequest) => {
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

Your handler returns canonical JSON. Middleware adds the FHIR Bundle automatically.

---

## `FhirHandlerOptions`

| Option | Example | Purpose |
|--------|---------|---------|
| `resourceType` | `'Patient'` | Single resource type (recommended for production) |
| `resource` | `'Patient'` | Alias for `resourceType` |
| `resources` | `['Patient', 'Practitioner']` | Multiple explicit types |
| `enabled` | `true` | Auto-detect types from payload signals |
| `version` | `'R4'` | FHIR version (R4 only today) |

FHIR is enabled when any of `enabled`, `resourceType`, `resource`, or `resources` is set.

---

## Response shape

```json
{
  "success": true,
  "data": { "userID": "user-123", "firstName": "Jane" },
  "message": { "title": "SUCCESS", "description": "...", "severity": "SUCCESS" },
  "fhir": {
    "resourceType": "Bundle",
    "type": "collection",
    "entry": [{ "resource": { "resourceType": "Patient", "id": "01K" } }]
  }
}
```

- `data` — unchanged handler output
- `fhir` — strict FHIR projection (canonical-only fields like `firstName` are excluded)

If no resources are generated, `fhir` is omitted.

---

## Production handlers today

- `apps/user-service/src/handlers/getUser.ts` — `fhir: { resourceType: 'Patient' }`
- `apps/alert-service/src/handlers/http/getAlert.ts` — `fhir: { resourceType: 'Patient' }`

---

## Before first use

Install `@myvitalrx/fhir-wrapper` (and `@myvitalrx/platform-tools` for middleware) when using the `fhir` option on `withApiHandler`. In the monorepo, use `@api-hub/fhir` via workspace paths. Middleware lazy-loads `@myvitalrx/fhir-wrapper/middleware` at runtime — no FHIR dependency is declared on the middleware package itself.

`@myvitalrx/fhir-wrapper` bootstraps registries automatically when the middleware subpath is loaded. Hand-authored mappings live in `libs/fhir/src/mappings/R4/`. See the [bootstrap section](../../../docs/services/fhir-gateway/DEVELOPER_GUIDE.md#5-library-bootstrap) in the full guide for adding new resources.

---

## Tests

```bash
nx test fhir --testPathPattern=with-api-handler
nx test fhir
```

---

## Not implemented today

- Content negotiation (`Accept: application/fhir+json` does not switch response format)
- FHIR-only responses without the standard `data` envelope
- Inbound FHIR → canonical in middleware

See [DEVELOPER_GUIDE.md § Known limitations](../../../docs/services/fhir-gateway/DEVELOPER_GUIDE.md#12-known-limitations-and-roadmap).
