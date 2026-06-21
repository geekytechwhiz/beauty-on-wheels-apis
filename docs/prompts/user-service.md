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

  apps/user-service

This service is responsible ONLY for:
- User profile management
- User–organization mapping
- User metadata
- User file references

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

----------------------------------------
FOLDER STRUCTURE (MUST MATCH)
----------------------------------------

apps/user-service/
├── src/
│   ├── handlers/              # Lambda handlers (thin)
│   ├── services/              # Business logic
│   ├── repositories/          # DynamoDB access layer
│   ├── validation/            # Input & event validation
│   ├── events/                # Event definitions & publishers
│   ├── models/                # Domain models
│   ├── utils/                 # Service-specific utilities
│   ├── index.ts
│   └── serverless.yml
├── project.json
└── tsconfig.json

Shared contracts or DTOs must go into:
  libs/contracts or libs/dtos (if needed)

----------------------------------------
AWS ARCHITECTURE
----------------------------------------

API Gateway → Lambda → DynamoDB (UserTable)
                           ├─ DynamoDB Streams → Lambda
                           ├─ S3 → Lambda (file upload reference)
                           └─ SQS → Lambda (reminders)

----------------------------------------
DYNAMODB TABLE DESIGN
----------------------------------------

Table: UserTable

PK: pk
SK: sk

Items:

1) User Profile
   pk = USER#{userId}
   sk = ORG#{organizationId}

2) User → Organization Mapping
   pk = ORG#{organizationId}
   sk = USER#{userId}

3) User Metadata
   pk = USER#{userId}
   sk = USER_METADATA

4) User File Reference
   pk = USER#{userId}
   sk = USER_FILE#{fileId}

----------------------------------------
API & EVENT FLOWS TO IMPLEMENT
----------------------------------------

### API Gateway → Lambda

1) createUser
   - Triggered by auth-service AFTER signup
   - Create USER_DETAILS record
   - Publish UserCreated.v1 event

2) getUser
   - Fetch USER_DETAILS

3) updateUser
   - Update USER_DETAILS
   - Publish UserProfileUpdated.v1 event

4) deleteUser
   - Soft delete preferred
   - Publish UserDeleted.v1 event

5) assignUserToOrganization
   - Create USER_ORG#{orgId} item

6) updateUserMetadata
   - Create or update USER_METADATA item

7) listUserOrganizations
   - Query begins_with(USER_ORG#)

8) listUserFiles
   - Query begins_with(USER_FILE#)

----------------------------------------
ASYNC / EVENT-DRIVEN HANDLERS
----------------------------------------

9) uploadUserFile (S3 → Lambda)
   - Receive S3 event
   - Generate fileId
   - Create USER_FILE#{fileId} item

10) userReminderEvent (SQS → Lambda)
   - Validate message
   - Idempotent processing
   - Log correlationId

11) userProfileStreamHandler (DynamoDB Stream)
   - Handle INSERT / MODIFY
   - Emit audit / analytics events
   - Must be idempotent

----------------------------------------
EVENT RULES (MANDATORY)
----------------------------------------

- Events are facts, not commands
- Events must be immutable
- Version events explicitly (e.g., UserCreated.v1)
- Validate event schema before publishing or consuming
- Log eventName + correlationId
- Event schemas owned by user-service

----------------------------------------
ERROR HANDLING
----------------------------------------

- Use domain-specific error classes
- Never swallow errors
- Map errors explicitly at API boundary
- Retry-safe logic for SQS & Streams
- No unbounded loops

----------------------------------------
TESTING (SKELETON ONLY)
----------------------------------------

- Unit tests for services
- Mock AWS SDK v3
- No real AWS calls

----------------------------------------
OUTPUT EXPECTATION
----------------------------------------

Generate:
- Full TypeScript implementation
- Handlers, services, repositories, validations
- Event definitions & publishers
- serverless.yml with all functions wired
- Clear, readable, maintainable code
- NO placeholders
- NO TODOs
- NO architecture changes

Do NOT explain.
Do NOT summarize.
Generate code only.

