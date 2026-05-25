# FHIR Implementation Flow (Planned / Target State)

> **Current vs planned:** This document describes the **target** end-to-end FHIR gateway flow (inbound FHIR, OAuth gates, HAPI validation, etc.). For what is **implemented today** in `@api-hub/fhir` and `withApiHandler`, see the [Developer Guide](../DEVELOPER_GUIDE.md).

This document describes the end-to-end FHIR request/response flow planned for the FHIR gateway architecture.

## Scope

- Runtime middleware flow in `withLambdaHandler`
- Canonical to FHIR transformation
- Inbound/outbound validation chain
- OAuth2 scope, tenant isolation, patient self-check, and consent handling
- Error response behavior (`OperationOutcome`)

## 1) Request Entry and FHIR Detection

Entry point: `libs/fhir/src/middleware/withLambdaHandler.ts`

The wrapper marks a request as FHIR when any of these are true:

- `Content-Type` is `application/fhir+json`
- `Accept` includes `application/fhir+json`
- legacy FHIR flag header is present
- request path suggests FHIR (`/fhir`)
- query format hints (`_format`, `format`) indicate FHIR

## 2) Auth and Context Enrichment (FHIR requests)

When request is FHIR:

- Extract bearer token from `Authorization` header
- Validate token via `validateAccessToken(...)` when JWKS/user pool config is available
- Use decode fallback path for local/dev when strict token config is not provided
- Build FHIR auth context (`subjectId`, `scopes`, `tenantId`, `clientId`, patient context, actor role/type)
- Copy identity data into request context for downstream handlers

## 3) Security Gates

Still in middleware, before handler execution:

- **Tenant isolation:** blocks org mismatch between token and request payload/path/query
- **Client isolation:** blocks `x-client-id` mismatch when token has client id
- **Scope enforcement:** uses `@api-hub/scope-mapping` (`isScopeAllowed`)
- **Patient self-only check:** patient-scoped actors can access only own patient resource
- **Consent enforcement:** applied for patient-scoped actors via `@api-hub/consent`

## 4) Inbound FHIR Conversion (POST/PUT/PATCH)

For direct inbound FHIR payloads:

1. Validate inbound FHIR payload
2. Store `resourceType` in request context
3. Convert FHIR -> canonical using `convertFhirToCanonical`
4. Replace `request.body` with canonical payload for service handler compatibility

## 5) Handler Execution

After optional request validation middleware (`options.validator`), the wrapped business handler runs and returns canonical data or FHIR data.

## 6) Canonical -> FHIR Transformation (Outbound)

If FHIR transformation options are configured and request is FHIR:

- Resolve target resource type from:
  - `inferResourceType(payload)`
  - context-derived resource type
  - fixed `options.fhir.resourceType`
- Transform each row (for list responses) or single object using `FhirTransformationService`
- For list responses, return FHIR `Bundle` (`searchset`) with pagination behavior

Service used: `libs/fhir/src/services/fhir-transformation.service.ts`

## 7) Output Sanitization Before Validation

For `Patient` and `Practitioner` transformations, sanitizer removes invalid empty primitive content from arrays/scalars before final validation:

- `name[].given[]`: remove empty/whitespace entries
- `name[].prefix[]`: remove empty/whitespace entries
- `name[].family`: trim/remove if empty
- `address[].line[]`: remove empty/whitespace entries
- `address` scalar text fields (`city`, `state`, `postalCode`, `country`): trim/remove empty
- `telecom[]`: remove items with empty value

This prevents invalid payloads like `given: ["DOCTOR", ""]`.

## 8) FHIR Validation Chain (Current)

Main dispatcher: `libs/fhir/src/fhir/validator/index.ts`

Validation runs by resource type and calls `validateWithHl7(...)` (async) for supported resources.

`validateWithHl7` sequence:

1. **Local structural validation** using `fhir-tool`
2. **Strict primitive check** for empty string primitives anywhere in the resource (excluding underscore extension containers)
3. **Optional strict server validation** via `$validate` API call(s)

Strict server validator module: `libs/fhir/src/fhir/validator/hapiValidator.ts`

Behavior:

- Enabled only when `FHIR_ENABLE_HAPI_VALIDATION=true`
- Calls one or both endpoints when configured:
  - `FHIR_HAPI_VALIDATOR_URL`
  - `FHIR_HL7_VALIDATOR_URL`
- POSTs resource to `{baseUrl}/$validate`
- Fails on HTTP non-2xx or `OperationOutcome.issue` with severity `error`/`fatal`
- Timeout controlled by `FHIR_HAPI_VALIDATOR_TIMEOUT_MS` (default `8000`)

## 9) Response Formatting

For FHIR responses:

- Returns HTTP 200 with `Content-Type: application/fhir+json`
- Body is serialized FHIR resource or Bundle

For non-FHIR responses:

- Uses standard success wrapper middleware

## 10) Error Handling

If any step in FHIR flow fails:

- Middleware returns `OperationOutcome` with `severity=error`, `code=invalid`
- HTTP status currently set to `400` for FHIR request failures

If request is non-FHIR:

- Normal platform error middleware is used

## 11) Access Audit Logging

At request end (`finally`), if request was FHIR:

- Logs FHIR access audit event via `@api-hub/access-audit`
- Computes CRUD-like action from HTTP method
- Includes resource type/id, actor/client/tenant ids, outcome status

## 12) Key Environment Variables

- `FHIR_ENABLE_HAPI_VALIDATION` -> enables strict external validator calls
- `FHIR_HAPI_VALIDATOR_URL` -> HAPI validator base URL
- `FHIR_HL7_VALIDATOR_URL` -> HL7 validator base URL (optional second validator)
- `FHIR_HAPI_VALIDATOR_TIMEOUT_MS` -> timeout for strict validator call
- `FHIR_ENFORCE_SCOPES` -> enable/disable scope enforcement
- `FHIR_REQUIRE_SCOPES` -> require scopes presence when enforcing
- `FHIR_EXPECTED_AUDIENCE`, `COGNITO_APP_CLIENT_ID`, `COGNITO_USER_POOL_ID`, `AWS_REGION` -> token validation config

## 13) Supported Resource Types in Validator Dispatcher

Current supported types include:

- `Patient`
- `Bundle`
- `CapabilityStatement`
- `Observation`
- `Practitioner`
- `RelatedPerson`
- `Organization`
- `PractitionerRole`
- `Appointment`
- `OperationOutcome`

Unknown resource types fail fast with unsupported resource type error.
