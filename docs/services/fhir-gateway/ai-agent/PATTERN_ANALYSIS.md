# Pattern Analysis: FHIR Gateway Mapping Patterns

This document analyzes the existing patterns in `user-service` and `fhir-gateway` to understand the code structure and mapping approaches.

## Architecture Flow

```
┌─────────────────┐
│  API Gateway    │
│  (AWS Lambda)   │
└────────┬────────┘
         │
         │ HTTP Request: GET /fhir/Patient/{id}
         │ Headers: Authorization, X-Correlation-Id
         │
         ▼
┌─────────────────────────────────────┐
│  Handler                            │
│  (apps/fhir-gateway/src/handlers/   │
│   patient.ts)                       │
│                                     │
│  • Extract ID from path             │
│  • Validate auth header             │
│  • Extract correlation ID           │
│  • Call service client              │
│  • Transform via adapter            │
│  • Return FHIR response             │
└────────┬────────────────────────────┘
         │
         │ userServiceClient.getUser(id, correlationId, authHeader)
         │
         ▼
┌─────────────────────────────────────┐
│  Service Client                     │
│  (apps/fhir-gateway/src/services/   │
│   user-service.client.ts)           │
│                                     │
│  • HTTP client (Axios)              │
│  • Request interceptors             │
│  • Error handling                   │
│  • Call microservice API            │
│  • Return DTO                       │
└────────┬────────────────────────────┘
         │
         │ HTTP GET /get-user-details?userID={id}
         │
         ▼
┌─────────────────────────────────────┐
│  Microservice API                   │
│  (apps/user-service)                │
│                                     │
│  Returns: { data: User }            │
└────────┬────────────────────────────┘
         │
         │ User DTO
         │
         ▼
┌─────────────────────────────────────┐
│  Adapter                            │
│  (libs/fhir/src/adapters/identity/  │
│   patient.adapter.ts)               │
│                                     │
│  • Transform User → Patient         │
│  • Map fields                       │
│  • Use utility functions            │
│  • Handle optional fields           │
│  • Return FHIR Patient              │
└────────┬────────────────────────────┘
         │
         │ FHIR Patient Resource
         │
         ▼
┌─────────────────────────────────────┐
│  Response                           │
│                                     │
│  Status: 200                        │
│  Headers: Content-Type: application/│
│           fhir+json                 │
│  Body: { resourceType: "Patient",   │
│          id: "...", ... }           │
└─────────────────────────────────────┘
```

## Code File Structure

```
apps/fhir-gateway/
├── src/
│   ├── handlers/
│   │   ├── patient.ts              ← Lambda handler
│   │   ├── practitioner.ts
│   │   └── related-person.ts
│   ├── services/
│   │   └── user-service.client.ts  ← Service client
│   └── utils/
│       ├── helper.ts
│       ├── http-client.ts
│       └── response.ts
└── serverless.yml                   ← Lambda configuration

libs/fhir/
└── src/
    ├── adapters/
    │   └── identity/
    │       ├── patient.adapter.ts    ← Transformation logic
    │       ├── practitioner.adapter.ts
    │       └── related-person.adapter.ts
    ├── models/
    │   └── r4/
    │       ├── common.ts             ← Shared types
    │       ├── patient.ts            ← FHIR resource types
    │       ├── practitioner.ts
    │       └── related-person.ts
    ├── utils/
    │   ├── coding.ts                 ← CodeableConcept utilities
    │   ├── date.ts                   ← Date utilities
    │   └── reference.ts              ← Reference utilities
    └── types/
        └── internal.ts               ← DTO types (User, etc.)
```

## Handler Pattern

### Standard Structure

```typescript
export async function main(
  event: APIGatewayProxyEvent,
  context?: Context
): Promise<APIGatewayProxyResult> {
  // 1. Initialize timing and extract IDs
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const resourceId = event.pathParameters?.id;
  const authHeader = getAccessTokenFromHeaders(event.headers || {});

  // 2. Validation
  if (!resourceId) {
    // Return 400 error
  }
  if (!authHeader) {
    // Return 401 error
  }

  // 3. Setup logger
  const logger = createChildLogger(baseLogger, { 
    correlationId, 
    resourceId,
    ...(awsRequestId && { awsRequestId }) 
  });

  // 4. Try-catch block
  try {
    // 5. Call service client
    const dto = await serviceClient.getResource(resourceId, correlationId, authHeader);
    
    // 6. Extract base URL for references
    const baseUrl = event.requestContext?.domainName
      ? `https://${event.requestContext.domainName}${...}`
      : undefined;
    
    // 7. Transform via adapter
    const fhirResource = toResource(dto, baseUrl);
    
    // 8. Log success and return response
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '...', 200, duration, correlationId);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/fhir+json',
        'X-Correlation-Id': correlationId,
      },
      body: JSON.stringify(fhirResource),
    };
  } catch (err) {
    // 9. Error handling
    const duration = Date.now() - startTime;
    if (err instanceof ResourceNotFoundError) {
      // Return 404
    }
    // Return 500
  }
}
```

## Service Client Pattern

### Standard Structure

```typescript
export class {Service}ServiceClient {
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.{SERVICE}_SERVICE_URL || 'http://localhost:3000';
    this.client = this.createClient();
  }

  private createClient(): AxiosInstance {
    const client = axios.create({
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
      validateStatus: (status) => status < 500,
    });

    // Request interceptor: Normalize auth header
    client.interceptors.request.use(...);
    
    // Response interceptor: Log errors
    client.interceptors.response.use(...);

    return client;
  }

  async get{Resource}(
    id: string, 
    correlationId?: string, 
    authHeader?: string
  ): Promise<{ResourceDTO}> {
    // 1. Validate inputs
    // 2. Prepare headers (Authorization, X-Correlation-Id)
    // 3. Make HTTP request
    // 4. Handle response
    // 5. Handle errors (401, 403, 404, 429, 500)
    // 6. Return DTO
  }
}

export class {Resource}NotFoundError extends Error {
  // Custom error class
}
```

## Adapter Pattern

### Standard Structure

```typescript
export function to{Resource}(dto: {DTOType}, baseUrl?: string): {Resource} {
  const resourceId = dto.{idField};

  // 1. Build names array
  const names: HumanName[] = [];
  if (dto.firstName || dto.lastName) {
    names.push({
      use: 'official',
      given: [dto.firstName, dto.middleName].filter(Boolean),
      family: dto.lastName,
    });
  }

  // 2. Build telecom array
  const telecom: ContactPoint[] = [];
  if (dto.emailAddress) {
    telecom.push({
      system: 'email',
      value: dto.emailAddress,
      use: 'home' | 'work',
    });
  }

  // 3. Build addresses array
  const addresses: Address[] = [];
  if (dto.street || dto.city) {
    addresses.push({
      use: 'home' | 'work',
      type: 'both',
      line: [dto.street],
      city: dto.city,
      state: dto.state,
      postalCode: dto.postalCode,
      country: dto.country,
    });
  }

  // 4. Build identifiers array
  const identifiers: Identifier[] = [];
  identifiers.push({
    use: 'official',
    system: baseUrl ? `${baseUrl}/fhir/{Resource}` : undefined,
    value: dto.{idField},
  });

  // 5. Build resource object
  const resource: {Resource} = {
    resourceType: '{Resource}',
    id: resourceId,
    ...(identifiers.length > 0 && { identifier: identifiers }),
    ...(names.length > 0 && { name: names }),
    ...(telecom.length > 0 && { telecom }),
    ...(addresses.length > 0 && { address: addresses }),
    ...(dto.gender && { gender: mapGender(dto.gender) }),
    ...(dto.dateOfBirth && { birthDate: toFhirDate(dto.dateOfBirth) }),
    meta: {
      lastUpdated: getCurrentFhirDateTime(),
      ...(baseUrl && { source: baseUrl }),
    },
  };

  return resource;
}
```

## Mapping Pattern Categories

### 1. Direct Mapping
```typescript
// Simple field copy
id: dto.userID
active: dto.isActive !== false
```

### 2. Transformed Mapping
```typescript
// Value transformation with function
gender: mapGender(dto.gender)
birthDate: toFhirDate(dto.dateOfBirth)
```

### 3. Conditional Mapping
```typescript
// Only include if condition is met
...(dto.gender && { gender: mapGender(dto.gender) })
...(dto.dateOfBirth && { birthDate: toFhirDate(dto.dateOfBirth) })
...(names.length > 0 && { name: names })
```

### 4. Array Mapping
```typescript
// Transform array elements
telecom: [
  ...(dto.emailAddress ? [{
    system: 'email',
    value: dto.emailAddress,
    use: 'home'
  }] : []),
  ...(dto.phoneNumber ? [{
    system: 'phone',
    value: dto.phoneNumber,
    use: 'mobile'
  }] : [])
]

// Or map over array
telecom: dto.additionalEmailIDs?.map(email => ({
  system: 'email',
  value: email,
  use: 'temp'
})) || []
```

### 5. Composite Mapping
```typescript
// Multiple fields → single structure
name: {
  use: 'official',
  given: [dto.firstName, dto.middleName].filter(Boolean),
  family: dto.lastName,
  ...(dto.namePrefix && { prefix: [dto.namePrefix] })
}
```

### 6. CodeableConcept Mapping
```typescript
// String → CodeableConcept
maritalStatus: createCodeableConcept(
  CodingSystems.MARITAL_STATUS,
  dto.maritalStatus.toLowerCase().replace(/\s+/g, '-'),
  dto.maritalStatus
)
```

### 7. Reference Mapping
```typescript
// ID → Reference
managingOrganization: createOrganizationReference(dto.organizationID)
patient: createPatientReference(patientId)
```

### 8. Nested Object Mapping
```typescript
// Complex nested structures
contact: dto.emergencyContact ? [{
  relationship: dto.emergencyContact.relationship ? [
    createCodeableConcept(
      CodingSystems.RELATIONSHIP,
      dto.emergencyContact.relationship.toLowerCase().replace(/\s+/g, '-'),
      dto.emergencyContact.relationship
    )
  ] : undefined,
  name: dto.emergencyContact.name ? {
    text: dto.emergencyContact.name
  } : undefined,
  telecom: dto.emergencyContact.phone ? [{
    system: 'phone',
    value: dto.emergencyContact.phone,
    use: 'home'
  }] : undefined
}] : []
```

## Utility Functions

### Coding Utilities (`libs/fhir/src/utils/coding.ts`)
- `createCoding(system, code, display)`: Create Coding object
- `createCodeableConcept(system, code, display, text)`: Create CodeableConcept
- `CodingSystems`: Constants for common coding systems

### Reference Utilities (`libs/fhir/src/utils/reference.ts`)
- `createReference(resourceType, id, display)`: Generic reference
- `createPatientReference(id, display)`: Patient reference
- `createOrganizationReference(id, display)`: Organization reference
- `createPractitionerReference(id, display)`: Practitioner reference

### Date Utilities (`libs/fhir/src/utils/date.ts`)
- `toFhirDate(value)`: Convert to FHIR date (YYYY-MM-DD)
- `toFhirDateTime(value)`: Convert to FHIR dateTime (ISO 8601)
- `getCurrentFhirDate()`: Current date
- `getCurrentFhirDateTime()`: Current dateTime

## Common Transformations

### Gender Mapping
```typescript
function mapGender(gender: string): 'male' | 'female' | 'other' | 'unknown' {
  const normalized = gender.toLowerCase().trim();
  if (normalized === 'm' || normalized === 'male') return 'male';
  if (normalized === 'f' || normalized === 'female') return 'female';
  if (normalized === 'other' || normalized === 'non-binary') return 'other';
  return 'unknown';
}
```

### Phone Number Combination
```typescript
value: dto.phoneCode ? `${dto.phoneCode}${dto.phoneNumber}` : dto.phoneNumber
```

### Address Line Priority
```typescript
...(dto.street && { line: [dto.street] }),
...(dto.address && !dto.street && { line: [dto.address] })
```

### Postal Code Priority
```typescript
...(dto.postalCode && { postalCode: dto.postalCode }),
...(dto.zip && !dto.postalCode && { postalCode: dto.zip })
```

### State/Country Code Priority
```typescript
...(dto.state && { state: dto.state }),
...(dto.stateCode && !dto.state && { state: dto.stateCode }),
...(dto.country && { country: dto.country }),
...(dto.countryCode && !dto.country && { country: dto.countryCode })
```

## Error Handling Patterns

### Handler Level
- 400: Missing required parameters
- 401: Missing/invalid auth header
- 404: Resource not found (catch `ResourceNotFoundError`)
- 500: Other errors

### Service Client Level
- 401: Unauthorized → "Unauthorized: Invalid or expired access token"
- 403: Forbidden → "Forbidden: Insufficient permissions"
- 404: Not Found → `ResourceNotFoundError`
- 429: Rate Limit → "Rate limit exceeded: Too many requests"
- 500+: Generic error with detailed logging

## Logging Patterns

### Handler Logging
```typescript
// Create child logger with context
const logger = createChildLogger(baseLogger, { 
  correlationId, 
  resourceId,
  ...(awsRequestId && { awsRequestId }) 
});

// Log events
logger.info({ event: 'fhir_{resource}_get_received' });
logger.error({ event: 'fhir_{resource}_get_error', err: serializeError(err) });

// Log HTTP request/response
logHttpRequest(logger, method, path, statusCode, duration, correlationId);
```

### Service Client Logging
```typescript
// Request error
logger.error({
  event: '{service}_request_error',
  err: { message: error.message, config: {...} }
});

// Response error
logger.warn({
  event: '{service}_response_error',
  status: error.response.status,
  url: error.config?.url,
});
```

## Serverless Configuration Pattern

```yaml
functions:
  get{Resource}:
    handler: src/handlers/{resource}.main
    timeout: 10
    memorySize: 256
    events:
      - http:
          path: fhir/{Resource}/{id}
          method: get
          cors:
            origin: ${self:custom.cors.origin}
            headers: ${self:custom.cors.headers}
```

## Key Takeaways for AI Agent

1. **Consistent Structure**: All handlers, clients, and adapters follow the same patterns
2. **Error Handling**: Standardized error classes and HTTP status codes
3. **Logging**: Structured logging with correlation IDs and event names
4. **Type Safety**: TypeScript types throughout, with proper optional handling
5. **Utility Functions**: Reusable functions for common transformations
6. **Conditional Inclusion**: Use spread operator with conditionals for optional fields
7. **Array Handling**: Build arrays conditionally, use map for transformations
8. **Naming Conventions**: camelCase for variables, PascalCase for types/classes

