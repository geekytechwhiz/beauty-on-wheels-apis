# FHIR Adapter Implementation Checklist

## Pre-Implementation

- [ ] Review architecture document (`FHIR_ADAPTER_ARCHITECTURE_REVIEW.md`)
- [ ] Identify all services that need FHIR compliance
- [ ] Map internal resources to FHIR resources (e.g., User → Patient, Order → MedicationRequest)
- [ ] Identify required FHIR profiles
- [ ] Determine FHIR version (R4 recommended)
- [ ] Define coding systems and terminologies to use
- [ ] Plan service registry approach (env vars, discovery service, etc.)

## Phase 1: Foundation - Shared Library Enhancement

### Core Infrastructure
- [ ] Create `FhirServiceConfig` interface
- [ ] Implement `ServiceRegistry` for cross-service references
- [ ] Create `FhirAdapter` interface/abstract class
- [ ] Implement adapter factory pattern
- [ ] Add configuration validation

### Security
- [ ] Implement SMART on FHIR scope parsing
- [ ] Create FHIR authorization helpers
- [ ] Add patient context isolation utilities
- [ ] Document security patterns

### Validation
- [ ] Integrate FHIR validator (e.g., `fhir-validator` npm package)
- [ ] Add profile validation support
- [ ] Create validation middleware
- [ ] Add validation test utilities

### Middleware
- [ ] Create `FhirResponse` helper for consistent responses
- [ ] Implement `FhirErrorHandler` for OperationOutcome errors
- [ ] Add content-type handling (`application/fhir+json`)
- [ ] Add correlation ID propagation

### Package Configuration
- [ ] Update `package.json` for NPM publishing
- [ ] Configure build output (ESM + CJS if needed)
- [ ] Add TypeScript declaration files
- [ ] Create `.npmignore` file
- [ ] Add package README with usage examples
- [ ] Set up semantic versioning strategy

### Testing
- [ ] Add unit tests for all adapters

## Phase 2: Service Migration

### user-service
- [ ] Create `src/handlers/fhir/` directory
- [ ] Implement `getPatient` handler
- [ ] Implement `listUserOrganizations` as FHIR Bundle
- [ ] Implement `listUserFiles` as FHIR Bundle
- [ ] Add FHIR routes to `serverless.yml`
- [ ] Add FHIR-specific error handling
- [ ] Add validation middleware
- [ ] Update API documentation
- [ ] Add integration tests
- [ ] Performance test transformation

### order-service
- [ ] Map Order → MedicationRequest/MedicationOrder
- [ ] Create FHIR adapters for orders
- [ ] Implement FHIR handlers
- [ ] Add routes to `serverless.yml`
- [ ] Test cross-service references (if needed)
- [ ] Add tests

### Other Services
- [ ] [Service Name]: Map resources to FHIR
- [ ] [Service Name]: Implement adapters
- [ ] [Service Name]: Add handlers
- [ ] [Service Name]: Configure routes

## Phase 3: Deprecation & Cleanup

- [ ] Mark `fhir-gateway` as deprecated
- [ ] Update API Gateway routes to point to service endpoints
- [ ] Add deprecation warnings to old gateway
- [ ] Monitor traffic migration
- [ ] Create rollback plan
- [ ] Remove `fhir-gateway` after confidence period
- [ ] Update documentation

## NPM Publishing

- [ ] Set up NPM organization/scope
- [ ] Configure CI/CD for automated publishing
- [ ] Create initial release (v1.0.0)
- [ ] Publish to NPM registry
- [ ] Create usage documentation for external repos
- [ ] Set up changelog/versioning strategy
- [ ] Configure access controls

## Documentation

- [ ] API documentation for each FHIR endpoint
- [ ] Adapter usage guide
- [ ] Migration guide for services
- [ ] Cross-service reference patterns
- [ ] Security and authorization guide
- [ ] Troubleshooting guide
- [ ] Performance optimization guide

## Monitoring & Observability

- [ ] Add metrics for transformation latency
- [ ] Add metrics for validation failures
- [ ] Add metrics for FHIR endpoint usage
- [ ] Set up alerts for validation errors
- [ ] Add distributed tracing for FHIR requests
- [ ] Create dashboards for FHIR operations

## Security Review

- [ ] Review FHIR endpoint security
- [ ] Validate SMART on FHIR implementation
- [ ] Test patient context isolation
- [ ] Review error messages (no PII leakage)
- [ ] Audit logging for FHIR operations
- [ ] Penetration testing (if required)

## Compliance

- [ ] Document FHIR version and profiles
- [ ] Create FHIR capability statement
- [ ] Document coding systems used
- [ ] Create conformance resources
- [ ] Review regulatory requirements
- [ ] Prepare for HL7 certification (if needed)

---

## Quick Reference: File Structure

```
libs/fhir/
├── src/
│   ├── core/
│   │   ├── fhir-config.ts
│   │   ├── service-registry.ts
│   │   ├── adapter-factory.ts
│   │   └── adapter.interface.ts
│   ├── security/
│   │   ├── fhir-scopes.ts
│   │   └── authorization.ts
│   ├── validation/
│   │   ├── validator.ts
│   │   └── profile-validator.ts
│   ├── middleware/
│   │   ├── fhir-response.ts
│   │   └── fhir-error-handler.ts
│   ├── adapters/
│   ├── models/
│   └── utils/
├── package.json
└── README.md

apps/user-service/
├── src/
│   └── handlers/
│       └── fhir/
│           ├── getPatient.ts
│           ├── listUserOrganizations.ts
│           └── listUserFiles.ts
└── serverless.yml
```

---

## Common Patterns

### Handler Pattern
```typescript
export async function getPatient(
  event: APIGatewayProxyEvent,
  context?: Context
): Promise<APIGatewayProxyResult> {
  const correlationId = extractCorrelationId(event);
  const logger = createChildLogger(baseLogger, { correlationId });
  
  try {
    const userId = event.pathParameters?.id;
    const user = await userService.getUser(userId);
    const baseUrl = getBaseUrl(event);
    const patient = toPatient(user, baseUrl);
    
    // Validate
    const validation = FhirValidator.validate(patient);
    if (!validation.valid) {
      logger.warn({ validationErrors: validation.errors });
    }
    
    return FhirResponse.ok(patient, correlationId);
  } catch (err) {
    return FhirErrorHandler.handle(err, event, correlationId);
  }
}
```

### Serverless Route
```yaml
functions:
  getPatient:
    handler: src/handlers/fhir/getPatient.main
    events:
      - http:
          path: fhir/Patient/{id}
          method: get
          cors: true
          request:
            parameters:
              paths:
                id: true
```

---

*Use this checklist to track implementation progress*
