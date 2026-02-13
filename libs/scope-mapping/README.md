# @api-hub/scope-mapping

Maps OAuth2 / SMART on FHIR scope strings to allowed FHIR resources and actions. Used by the FHIR gateway to enforce scope before serving requests.

## Usage

```ts
import { isScopeAllowed } from '@api-hub/scope-mapping';

const scopes = ['patient/Patient.read', 'user/Observation.search'];
if (!isScopeAllowed(scopes, 'Patient', 'read')) {
  return 403; // Insufficient scope
}
```

Supports patterns: `patient/ResourceType.read`, `user/*.write`, `launch`, `launch/patient`, `fhirUser`, `offline_access`.
