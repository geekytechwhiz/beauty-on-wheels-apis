# Organization Service Implementation Prompt

## Overview

This document provides a comprehensive Cursor prompt (`prompts/organization-service.md`) that can be used to generate production-ready code for the organization microservice. The prompt has been created by analyzing:

1. The organization microservice technical documentation (`organization.doc`)
2. Existing `user-service` implementation patterns
3. Available shared libraries in the `libs/` folder
4. Architecture constraints and best practices

## Key Features Covered

The prompt includes detailed specifications for:

### 1. Core CRUD Operations
- Create Organization
- Get Organization
- Update Organization
- Delete Organization (soft delete)

### 2. Organization-User Mapping
- Assign User to Organization
- Remove User from Organization
- List Organization Users

### 3. Organization-Device Mapping
- Assign Device to Organization
- Remove Device from Organization
- List Organization Devices

### 4. Metadata & Files
- Update Organization Metadata
- List Organization Files
- S3 File Upload Handler (EventBridge trigger)

### 5. Event-Driven Processing
- DynamoDB Stream Handler for audit/analytics
- Event publishing via SNS
- Event types: Created, Updated, Deleted, UserAssigned, UserRemoved, DeviceAssigned, DeviceRemoved, MetadataUpdated, FileUploaded

## Architecture Alignment

The prompt ensures alignment with:

- **Nx Monorepo Structure**: Respects workspace boundaries
- **Existing Patterns**: Mirrors `user-service` implementation closely
- **Reusable Components**: Leverages `@api-hub/logger`, response utilities, DB config patterns
- **AWS Best Practices**: Proper IAM, error handling, structured logging
- **TypeScript Strict Mode**: Full type safety

## DynamoDB Table Design

The prompt implements the exact table design from the documentation:

```
PK: ORG#{organizationId}
SK: 
  - ORG_DETAILS (organization profile)
  - ORG_USER#{userId} (user mappings)
  - ORG_DEVICE#{deviceId} (device mappings)
  - ORG_METADATA (metadata)
  - ORG_FILE#{fileId} (file references)
```

## Implementation Strategy

The prompt provides:
1. **Complete folder structure** matching `user-service`
2. **Step-by-step implementation order**
3. **Reusable patterns** from existing codebase
4. **Validation schemas** for all inputs
5. **Event definitions** for async processing
6. **Error handling** with proper HTTP status codes
7. **Testing requirements** and patterns

## Usage

To use this prompt with Cursor:

1. Open Cursor IDE
2. Navigate to the prompt: `prompts/organization-service.md`
3. Reference the prompt in a new chat/conversation
4. Ask Cursor to generate the organization-service based on the prompt

Example usage:
```
@prompts/organization-service.md

Generate the organization-service following all specifications in this prompt. 
Start with project setup and work through all components systematically.
```

## Key Differences from User Service

While following similar patterns, the organization service has some differences:

1. **Table Structure**: Organization-centric (ORG# prefix) vs User-centric (USER# prefix)
2. **Additional Mappings**: Device mappings in addition to user mappings
3. **File Handling**: Organization files instead of user files
4. **Event Types**: Organization-specific events

## Dependencies

The prompt references these shared libraries:
- `@api-hub/logger` - Structured logging
- `@api-hub/utils` - Utility functions (if needed)
- AWS SDK v3 packages for DynamoDB, SNS, S3, EventBridge

## Environment Variables Required

The prompt specifies these environment variables:
- `ORGANIZATION_TABLE` - DynamoDB table name
- `ORGANIZATION_FILES_BUCKET` - S3 bucket for organization files
- `ORGANIZATION_EVENTS_TOPIC_ARN` - SNS topic ARN for events
- `EVENT_BUS` - EventBridge event bus name
- `DEFAULT_REGION` - AWS region

## Testing Approach

The prompt recommends:
1. Unit tests for repositories (mock DynamoDB)
2. Unit tests for services (mock repositories)
3. Unit tests for validation schemas
4. Integration tests for handlers (optional, using serverless-offline)

## Next Steps After Code Generation

After the code is generated:

1. **Review** generated code against the prompt specifications
2. **Test** all endpoints locally using serverless-offline
3. **Deploy** to dev environment and verify
4. **Update** infrastructure code (if table is managed separately)
5. **Document** any deviations or extensions
6. **Integrate** with other services as needed

## Maintenance

Keep the prompt updated if:
- Architecture patterns change
- New requirements are added
- Shared libraries are updated
- Best practices evolve

## Support

For questions or issues:
- Review the existing `user-service` implementation
- Check the technical documentation (`organization.doc`)
- Refer to AWS documentation for DynamoDB, S3, SNS patterns
- Consult architecture documents in `docs/`
