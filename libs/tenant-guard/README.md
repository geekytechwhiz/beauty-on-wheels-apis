# @api-hub/tenant-guard

Tenant isolation guard: enforces that the request tenant matches the resource's tenant. Callers must resolve the resource's tenant (e.g. from `canonical.organizationId`) and call `assertResourceInTenant` or `isTenantAllowed`.

## Usage

```ts
import { assertResourceInTenant, isTenantAllowed } from '@api-hub/tenant-guard';

// After resolving resource's tenant (e.g. from Patient.organizationId)
assertResourceInTenant(auth.tenantId, canonical.organizationId, 'Patient', id);
// Throws TenantAccessDeniedError if not allowed
```
