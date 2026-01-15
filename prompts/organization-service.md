You are a senior backend engineer working inside an Nx monorepo called `api-hub`.

STRICTLY FOLLOW ALL REPOSITORY RULES AND AI INSTRUCTIONS DEFINED IN:
- architecture.md
- backend.md
- base.md
- development.md
- code-quality.md
- constraints.md
- context.md
- pr-review.md
- debugging.md

These documents are authoritative. Do not violate them.

----------------------------------------
SERVICE OVERVIEW
----------------------------------------

Generate a new microservice called:

  apps/organization-service

This service is responsible ONLY for:
- Organization profile management (CRUD operations)
- Organization-user mapping (assign, remove, list)
- Organization-device mapping (assign, remove, list)
- Organization metadata management
- Organization file references
- Organization change event processing (DynamoDB Streams)

Authentication, authorization, and role management are handled by other services.
DO NOT implement auth logic here.

----------------------------------------
ARCHITECTURE CONSTRAINTS (MANDATORY)
----------------------------------------

- Nx monorepo boundaries MUST be respected
- No imports from other services
- Shared logic must go into `libs/`
- TypeScript strict mode
- AWS SDK v3 only
- Lambda handlers must be THIN
- Business logic must live in service or lib layers
- Validate all inputs and events
- Structured logging only (include correlationId)
- Do NOT log PII
- Prefer async + event-driven patterns
- No synchronous coupling to other services
- DynamoDB, S3, SQS, EventBridge only (no new AWS services)
- REUSE existing patterns from `apps/user-service` wherever possible

----------------------------------------
FOLDER STRUCTURE (MUST MATCH)
----------------------------------------

apps/organization-service/
├── src/
│   ├── handlers/              # Lambda handlers (thin)
│   │   ├── createOrganization.ts
│   │   ├── getOrganization.ts
│   │   ├── updateOrganization.ts
│   │   ├── deleteOrganization.ts
│   │   ├── assignUserToOrganization.ts
│   │   ├── removeUserFromOrganization.ts
│   │   ├── listOrganizationUsers.ts
│   │   ├── assignDeviceToOrganization.ts
│   │   ├── removeDeviceFromOrganization.ts
│   │   ├── listOrganizationDevices.ts
│   │   ├── updateOrganizationMetadata.ts
│   │   ├── health.ts
│   │   ├── s3/
│   │   │   └── uploadOrganizationFile.ts
│   │   ├── sqs/
│   │   │   └── organizationEventProcessor.ts (if needed)
│   │   └── stream/
│   │       └── organizationProfileStreamHandler.ts
│   ├── services/              # Business logic
│   │   ├── organization.service.ts
│   │   └── notification.service.ts (if needed, reuse from user-service pattern)
│   ├── repositories/          # DynamoDB access layer
│   │   ├── organization.repository.ts
│   │   └── organization.repository.spec.ts
│   ├── validation/            # Input & event validation
│   │   ├── organization.validation.ts
│   │   └── event.validation.ts
│   ├── events/                # Event definitions & publishers
│   │   ├── event.publisher.ts (reuse pattern from user-service)
│   │   ├── event.types.ts
│   │   ├── OrganizationCreated.ts
│   │   ├── OrganizationUpdated.ts
│   │   └── OrganizationDeleted.ts
│   ├── models/                # Domain models
│   │   ├── index.ts
│   │   ├── Organization.ts
│   │   ├── OrganizationUser.ts
│   │   ├── OrganizationDevice.ts
│   │   ├── OrganizationMetadata.ts
│   │   └── OrganizationFile.ts
│   ├── utils/                 # Service-specific utilities
│   │   ├── db.config.ts (reuse pattern from user-service)
│   │   ├── errors.ts
│   │   ├── response.ts (reuse from user-service)
│   │   └── helpers.ts
│   ├── index.ts
│   └── serverless.yml
├── project.json
└── tsconfig.json

Shared contracts or DTOs must go into:
  libs/contracts or libs/dtos (if needed)

----------------------------------------
AWS ARCHITECTURE
----------------------------------------

API Gateway → Lambda → DynamoDB (OrganizationTable)
                           ├─ DynamoDB Streams → Lambda (audit/analytics/notifications)
                           ├─ S3 → Lambda (file upload reference)
                           └─ SQS → Lambda (if needed for async processing)

----------------------------------------
DYNAMODB TABLE DESIGN (MANDATORY)
----------------------------------------

Table: OrganizationTable

PK: pk
SK: sk

Items:

1) Organization Profile
   pk = ORG#{organizationId}
   sk = ORG_DETAILS
   Contains: name, email, address, phone, status, createdDate, modifiedDate, etc.

2) Organization-User Mapping
   pk = ORG#{organizationId}
   sk = ORG_USER#{userId}
   Contains: organizationId, userId, assignedAt, role (optional), status

3) Organization-Device Mapping
   pk = ORG#{organizationId}
   sk = ORG_DEVICE#{deviceId}
   Contains: organizationId, deviceId, assignedAt, status

4) Organization Metadata
   pk = ORG#{organizationId}
   sk = ORG_METADATA
   Contains: organizationId, metadata (JSON object), updatedAt

5) Organization File Reference
   pk = ORG#{organizationId}
   sk = ORG_FILE#{fileId}
   Contains: organizationId, fileId, fileName, s3Key, uploadedAt

Access Patterns:
- Get organization profile: pk = ORG#{orgId}, sk = ORG_DETAILS
- List all org users: pk = ORG#{orgId}, sk begins_with(ORG_USER#)
- List all org devices: pk = ORG#{orgId}, sk begins_with(ORG_DEVICE#)
- Get org metadata: pk = ORG#{orgId}, sk = ORG_METADATA
- List org files: pk = ORG#{orgId}, sk begins_with(ORG_FILE#)

----------------------------------------
API & EVENT FLOWS TO IMPLEMENT
----------------------------------------

### API Gateway → Lambda

1) createOrganization
   - POST /organization
   - Create ORG_DETAILS record
   - Generate organizationId (UUID)
   - Set createdDate, modifiedDate
   - Publish OrganizationCreated.v1 event
   - Returns: organizationId, status

2) getOrganization
   - GET /organization/{organizationId}
   - Fetch ORG_DETAILS
   - Return organization profile
   - 404 if not found or deleted

3) updateOrganization
   - PUT /organization/{organizationId}
   - Update ORG_DETAILS
   - Set modifiedDate
   - Publish OrganizationUpdated.v1 event
   - Returns: updated organization

4) deleteOrganization
   - DELETE /organization/{organizationId}
   - Soft delete preferred (set deleted flag)
   - Publish OrganizationDeleted.v1 event
   - Consider cascade deletion of mappings (optional, or handle in stream)

5) assignUserToOrganization
   - POST /organization/{organizationId}/user/{userId}
   - Create ORG_USER#{userId} item
   - Set assignedAt timestamp
   - Idempotent (allow re-assignment)
   - Returns: success status

6) removeUserFromOrganization
   - DELETE /organization/{organizationId}/user/{userId}
   - Delete ORG_USER#{userId} item
   - Returns: success status

7) listOrganizationUsers
   - GET /organization/{organizationId}/users
   - Query begins_with(ORG_USER#)
   - Returns: array of user mappings

8) assignDeviceToOrganization
   - POST /organization/{organizationId}/device/{deviceId}
   - Create ORG_DEVICE#{deviceId} item
   - Set assignedAt timestamp
   - Idempotent (allow re-assignment)
   - Returns: success status

9) removeDeviceFromOrganization
   - DELETE /organization/{organizationId}/device/{deviceId}
   - Delete ORG_DEVICE#{deviceId} item
   - Returns: success status

10) listOrganizationDevices
    - GET /organization/{organizationId}/devices
    - Query begins_with(ORG_DEVICE#)
    - Returns: array of device mappings

11) updateOrganizationMetadata
    - PUT /organization/{organizationId}/metadata
    - Create or update ORG_METADATA item
    - Set updatedAt timestamp
    - Metadata is a JSON object (key-value pairs)
    - Returns: updated metadata

12) listOrganizationFiles
    - GET /organization/{organizationId}/files
    - Query begins_with(ORG_FILE#)
    - Returns: array of file references

----------------------------------------
ASYNC / EVENT-DRIVEN HANDLERS
----------------------------------------

13) uploadOrganizationFile (S3 → Lambda via EventBridge)
    - Receive S3 event from EventBridge
    - Extract organizationId from S3 key path (e.g., organizations/{orgId}/files/{filename})
    - Generate fileId (UUID)
    - Create ORG_FILE#{fileId} item
    - Publish OrganizationFileUploaded.v1 event
    - Handle errors gracefully

14) organizationProfileStreamHandler (DynamoDB Stream → Lambda)
    - Handle INSERT / MODIFY / REMOVE events
    - Filter for ORG_DETAILS items only
    - Trigger audit logging, analytics, or notifications
    - Use idempotency keys
    - Handle batch failures with ReportBatchItemFailures

15) organizationEventProcessor (SQS → Lambda, optional)
    - Process async organization events if needed
    - Validate messages
    - Idempotent processing
    - Log correlationId

----------------------------------------
MODELS (TypeScript Interfaces)
----------------------------------------

Organization:
- organizationId: string
- name: string
- email?: string
- phone?: string
- address?: string
- city?: string
- state?: string
- country?: string
- postalCode?: string
- status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
- createdDate: number (timestamp)
- modifiedDate: number (timestamp)
- deleted?: boolean
- itemType: 'ORG_DETAILS'

OrganizationUser:
- organizationId: string
- userId: string
- assignedAt: string (ISO date)
- role?: string
- status?: string
- itemType: 'ORG_USER'

OrganizationDevice:
- organizationId: string
- deviceId: string
- assignedAt: string (ISO date)
- status?: string
- itemType: 'ORG_DEVICE'

OrganizationMetadata:
- organizationId: string
- metadata: Record<string, unknown>
- updatedAt: string (ISO date)
- itemType: 'ORG_METADATA'

OrganizationFile:
- organizationId: string
- fileId: string
- fileName: string
- s3Key: string
- uploadedAt: string (ISO date)
- itemType: 'ORG_FILE'

----------------------------------------
REUSABLE COMPONENTS FROM CODEBASE
----------------------------------------

MUST REUSE:
1. Logger: `@api-hub/logger`
   - Use createLogger, createChildLogger, extractCorrelationId, serializeError
   - Pattern: See apps/user-service/src/handlers/getUser.ts

2. Response utilities: Copy pattern from apps/user-service/src/utils/response.ts
   - ok(), created(), problem() functions
   - SuccessResponse<T> and ProblemDetails interfaces

3. DB config: Copy pattern from apps/user-service/src/utils/db.config.ts
   - Use DynamoDBDocumentClient from @aws-sdk/lib-dynamodb
   - Export docClient

4. Error handling: Copy pattern from apps/user-service/src/utils/errors.ts
   - Create: OrganizationNotFoundError, OrganizationAlreadyExistsError
   - Extend Error class properly

5. Event publisher: Copy pattern from apps/user-service/src/events/event.publisher.ts
   - Use SNSClient from @aws-sdk/client-sns
   - Publish to ORGANIZATION_EVENTS_TOPIC_ARN
   - Include correlationId, eventId, occurredAt

6. Validation: Copy pattern from apps/user-service/src/validation/
   - Use zod or similar for schema validation
   - Create schemas for create, update, assign operations

7. Serverless.yml structure: Follow apps/user-service/serverless.yml
   - Same provider config, IAM roles, environment variables pattern
   - Use same plugins (serverless-esbuild, serverless-offline, etc.)

----------------------------------------
SERVERLESS.YML CONFIGURATION
----------------------------------------

Environment Variables:
- ORGANIZATION_TABLE: organization-table-${self:provider.stage}
- ORGANIZATION_FILES_BUCKET: organization-files-bucket-${self:provider.stage}
- ORGANIZATION_EVENTS_TOPIC_ARN: arn:aws:sns:...:organization-events-topic-${self:provider.stage}
- EVENT_BUS: organization-service-bus-${self:provider.stage}

IAM Permissions:
- DynamoDB: GetItem, PutItem, UpdateItem, DeleteItem, Query on OrganizationTable
- S3: GetObject, PutObject, ListBucket on organization-files-bucket
- SNS: Publish on organization-events-topic
- EventBridge: PutEvents on organization-service-bus
- X-Ray: PutTraceSegments, PutTelemetryRecords

Resources to Create:
- OrganizationTable (if not managed by infra stack)
- OrganizationFilesBucket (S3 bucket)
- OrganizationEventsTopic (SNS topic)
- OrganizationServiceBus (EventBridge event bus)
- DLQ for streams (if needed)

Functions:
- Health check endpoint
- All API endpoints (11 endpoints)
- S3 file upload handler (EventBridge trigger)
- DynamoDB stream handler
- SQS handler (if needed)

----------------------------------------
VALIDATION SCHEMAS
----------------------------------------

createOrganizationSchema:
- name: string (required, min 1, max 255)
- email?: string (valid email format)
- phone?: string (valid phone format)
- address?: string
- city?: string
- state?: string
- country?: string
- postalCode?: string
- status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' (default: 'ACTIVE')

updateOrganizationSchema:
- name?: string
- email?: string
- phone?: string
- address?: string
- city?: string
- state?: string
- country?: string
- postalCode?: string
- status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'

updateOrganizationMetadataSchema:
- metadata: Record<string, unknown> (required, non-empty object)

----------------------------------------
EVENT TYPES TO PUBLISH
----------------------------------------

1. OrganizationCreated.v1
   - Data: { organizationId, name, email?, status, createdDate }

2. OrganizationUpdated.v1
   - Data: { organizationId, updatedFields: Record<string, unknown>, modifiedDate }

3. OrganizationDeleted.v1
   - Data: { organizationId, deletedAt }

4. OrganizationUserAssigned.v1
   - Data: { organizationId, userId, assignedAt }

5. OrganizationUserRemoved.v1
   - Data: { organizationId, userId, removedAt }

6. OrganizationDeviceAssigned.v1
   - Data: { organizationId, deviceId, assignedAt }

7. OrganizationDeviceRemoved.v1
   - Data: { organizationId, deviceId, removedAt }

8. OrganizationMetadataUpdated.v1
   - Data: { organizationId, metadata, updatedAt }

9. OrganizationFileUploaded.v1
   - Data: { organizationId, fileId, fileName, s3Key, uploadedAt }

Event Structure:
- eventId: UUID
- eventType: string (e.g., "OrganizationCreated.v1")
- occurredAt: ISO timestamp
- source: "organization-service"
- correlationId: from request context
- data: event-specific payload

----------------------------------------
ERROR HANDLING
----------------------------------------

Create custom errors:
- OrganizationNotFoundError extends Error
- OrganizationAlreadyExistsError extends Error
- OrganizationValidationError extends Error

Use problem() response utility with appropriate status codes:
- 400: Bad Request (validation errors)
- 404: Not Found (organization not found)
- 409: Conflict (organization already exists)
- 500: Internal Server Error (with correlationId)

Always include correlationId in error responses.

----------------------------------------
LOGGING PATTERNS
----------------------------------------

Use structured logging with correlationId:
```typescript
const logger = createChildLogger(baseLogger, { 
  correlationId, 
  organizationId,
  ...(awsRequestId && { awsRequestId })
});

logger.info({ 
  event: 'organization_created', 
  organizationId,
  message: 'Organization created successfully' 
});

logger.error({ 
  event: 'organization_create_error', 
  err: serializeError(err),
  organizationId,
  message: 'Failed to create organization' 
});
```

Do NOT log PII (personal identifiable information) unless explicitly required.
Email addresses may be logged if redacted appropriately.

----------------------------------------
TESTING REQUIREMENTS
----------------------------------------

Create unit tests for:
- Repository methods (using DynamoDB mocking)
- Service layer business logic
- Validation schemas
- Event publishers (mock SNS)

Integration tests (optional):
- E2E API tests using serverless-offline
- Stream handler tests with mock DynamoDB stream events

Follow patterns from apps/user-service/src/repositories/user.repository.spec.ts

----------------------------------------
IMPLEMENTATION ORDER
----------------------------------------

1. Project setup (serverless.yml, tsconfig.json, project.json)
2. Models (Organization, OrganizationUser, OrganizationDevice, etc.)
3. DB config and repository layer
4. Service layer
5. Validation schemas
6. Event types and publisher
7. Error classes
8. Handlers (start with CRUD, then mappings, then metadata/files)
9. Stream handler
10. S3 handler
11. Health check
12. Tests

----------------------------------------
CODE QUALITY REQUIREMENTS
----------------------------------------

- TypeScript strict mode enabled
- All functions must have proper types
- No `any` types (use `unknown` if needed)
- Proper error handling with try-catch
- Input validation on all handlers
- Idempotency for PUT operations
- Soft deletes preferred over hard deletes
- Use async/await (no promise chains)
- Export only what's needed
- Document complex business logic
- Follow existing naming conventions from user-service

----------------------------------------
SPECIFIC PATTERNS TO FOLLOW
----------------------------------------

1. Handler structure (see apps/user-service/src/handlers/getUser.ts):
   - Extract correlationId
   - Create child logger
   - Extract path parameters
   - Validate input
   - Call service method
   - Handle errors
   - Return response using ok()/problem()
   - Log HTTP request metrics

2. Repository structure (see apps/user-service/src/repositories/user.repository.ts):
   - Helper functions for pk/sk generation
   - Try-catch with proper error handling
   - Conditional expressions for existence checks
   - Logging at repository level
   - Return domain models, not DB items

3. Service structure (see apps/user-service/src/services/user.service.ts):
   - Business logic only
   - Call repository methods
   - Publish events
   - Handle business-level errors
   - Generate IDs (use crypto.randomUUID())

4. Event publishing (see apps/user-service/src/events/event.publisher.ts):
   - Use SNS client
   - Include all required fields
   - Handle errors gracefully
   - Log publish attempts and results

----------------------------------------
ADDITIONAL NOTES
----------------------------------------

- The organizationId should be a UUID (generate using crypto.randomUUID())
- Timestamps should use Date.now() for numbers or new Date().toISOString() for strings
- Use conditional expressions in DynamoDB to prevent overwrites on create
- Use begins_with() for listing items with prefixes
- Consider pagination for list operations (optional, can be added later)
- File uploads via S3 should extract organizationId from the S3 key path
- Stream handler should filter events to only process relevant items (ORG_DETAILS)
- All handlers should be idempotent where possible
- Use environment-specific configuration via serverless.yml custom section

----------------------------------------
REFERENCE IMPLEMENTATIONS
----------------------------------------

Study these files as references:
- apps/user-service/src/handlers/getUser.ts
- apps/user-service/src/repositories/user.repository.ts
- apps/user-service/src/services/user.service.ts
- apps/user-service/src/events/event.publisher.ts
- apps/user-service/src/utils/response.ts
- apps/user-service/src/utils/errors.ts
- apps/user-service/serverless.yml

----------------------------------------
FINAL CHECKLIST
----------------------------------------

Before considering implementation complete, ensure:
- [ ] All 11 API endpoints implemented
- [ ] DynamoDB stream handler implemented
- [ ] S3 file upload handler implemented
- [ ] All events published correctly
- [ ] Error handling with proper status codes
- [ ] Input validation on all handlers
- [ ] Structured logging with correlationId
- [ ] Unit tests for repository and service
- [ ] TypeScript strict mode passes
- [ ] Serverless.yml properly configured
- [ ] IAM permissions correct
- [ ] Environment variables documented
- [ ] Health check endpoint working
- [ ] Follows user-service patterns closely
- [ ] No PII in logs
- [ ] Idempotency where appropriate

Generate production-ready, well-structured code following all patterns and constraints above.
