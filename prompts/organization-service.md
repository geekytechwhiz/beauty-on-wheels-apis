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
- Organization profile management (CRUD)
- Organization metadata management
- Organization file references
- Organization listing (via GSI1)

Organization–User and Organization–Device relationships are NOT stored here.
Do NOT implement any mapping logic or storage for those relationships.

Ownership of relationships:
- User Service stores: ORG#{orgId} → USER#{userId}
- Device Service stores: DEVICE#{deviceId} → DEVICE_ORG#{orgId}

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

apps/organization-service/
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

API Gateway → Lambda → DynamoDB (OrganizationTable)
                           ├─ DynamoDB Streams → Lambda
                           └─ S3 → Lambda (file upload reference)

----------------------------------------
DYNAMODB TABLE DESIGN
----------------------------------------

Table: organization-table-${stage}

PK: pk
SK: sk

Global Secondary Index:
GSI1
  gsi1pk = ORG_LIST
  gsi1sk = ORG#{organizationId}
  Projection = ALL
Purpose: list all organizations

Items:

1) Organization Profile (ORG_DETAILS)
   pk = ORG#{organizationId}
   sk = ORG_DETAILS
   gsi1pk = ORG_LIST
   gsi1sk = ORG#{organizationId}

2) Organization Metadata (ORG_METADATA)
   pk = ORG#{organizationId}
   sk = ORG_METADATA

3) Organization File Reference (ORG_FILE)
   pk = ORG#{organizationId}
   sk = ORG_FILE#{fileId}

----------------------------------------
ITEM SCHEMAS
----------------------------------------

Organization Profile – ORG_DETAILS
{
  pk: string;
  sk: string;
  gsi1pk: "ORG_LIST";
  gsi1sk: "ORG#{organizationId}";
  organizationId: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  createdDate: number;
  modifiedDate: number;
  deleted?: boolean;
  itemType: "ORG_DETAILS";
  website?: string;
  taxId?: string;
  registrationNumber?: string;
  description?: string;
  industry?: string;
  size?: "SMALL" | "MEDIUM" | "LARGE";
}

Organization Metadata – ORG_METADATA
{
  pk: string;
  sk: "ORG_METADATA";
  organizationId: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
  itemType: "ORG_METADATA";
  updatedBy?: string;
  version?: number;
}

Organization File Reference – ORG_FILE
{
  pk: string;
  sk: "ORG_FILE#{fileId}";
  organizationId: string;
  fileId: string;
  fileName: string;
  s3Key: string;
  uploadedAt: string;
  itemType: "ORG_FILE";
  fileSize?: number;
  contentType?: string;
  uploadedBy?: string;
  description?: string;
  tags?: string[];
}

----------------------------------------
API & EVENT FLOWS TO IMPLEMENT
----------------------------------------

### API Gateway → Lambda

1) createOrganization
   - Create ORG_DETAILS record
   - Enforce unique organizationId
   - Publish OrganizationCreated.v1 event

2) getOrganization
   - Fetch ORG_DETAILS by pk/sk

3) updateOrganization
   - Update ORG_DETAILS fields
   - Publish OrganizationUpdated.v1 event

4) deleteOrganization
   - Soft delete preferred (set deleted flag)
   - Publish OrganizationDeleted.v1 event

5) listOrganizations
   - Query GSI1 with gsi1pk = ORG_LIST
   - Support optional status filter

6) updateOrganizationMetadata
   - Create or update ORG_METADATA item

7) listOrganizationFiles
   - Query begins_with(ORG_FILE#) on sk

### Async / Event-Driven Handlers

8) uploadOrganizationFile (S3 → Lambda)
   - Receive S3 event
   - Generate fileId
   - Create ORG_FILE#{fileId} item

9) organizationProfileStreamHandler (DynamoDB Stream)
   - Handle INSERT / MODIFY
   - Emit audit / analytics events
   - Must be idempotent

----------------------------------------
ACCESS PATTERNS
----------------------------------------

- Create Org:            PK ORG#{id}, SK ORG_DETAILS
- Get Org:               PK ORG#{id}, SK ORG_DETAILS
- Update Org:            PK ORG#{id}, SK ORG_DETAILS
- Soft Delete:           PK ORG#{id}, SK ORG_DETAILS
- List Orgs:             GSI1 (gsi1pk = ORG_LIST)
- Filter by Status:      GSI1 + Filter
- Metadata:              PK ORG#{id}, SK ORG_METADATA
- Files:                 PK ORG#{id}, begins_with(SK, ORG_FILE#)

----------------------------------------
VALIDATION RULES
----------------------------------------

Organization Profile
- organizationId: UUID (required)
- name: 1–255 chars
- status: ACTIVE | INACTIVE | SUSPENDED

Metadata
- Non-empty object
- ISO timestamp

File Reference
- Valid UUIDs
- Valid S3 key
- ISO timestamp

----------------------------------------
ERROR HANDLING
----------------------------------------

- OrganizationNotFound → 404
- OrganizationAlreadyExists → 409
- ValidationError → 400
- DynamoDBError → 500

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
