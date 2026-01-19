# Organization Service: Database Schema Documentation

## 1. Overview

The organization-service is responsible for **organization profile management only**. Organization-user and organization-device relationships are **NOT stored in this service** to avoid data duplication. These relationships are managed by:
- **User Service**: Stores `ORG#{orgId}` → `USER#{userId}` mappings
- **Device Service**: Stores `DEVICE#{deviceId}` → `DEVICE_ORG#{orgId}` mappings

The organization-service focuses on:
- Organization profile CRUD operations
- Organization metadata management
- Organization file references
- Organization listing (via GSI1)

Authentication and role management are handled by dedicated services.

## 2. User Flows

### a. Organization Profile Management
- **Create Organization**: Create a new organization with profile information
- **Get Organization**: Fetch organization profile by organizationId
- **Update Organization**: Update organization profile fields (name, contact, address, etc.)
- **Delete Organization**: Remove organization profile (soft delete preferred)
- **List All Organizations**: Query all organizations using GSI1 (see Section 20)

### b. Organization-User Mapping (Handled by User Service)
- **Note:** Organization-User mappings are **NOT stored in Organization Service**
- **User Service** handles: `ORG#{orgId}` → `USER#{userId}` mappings
- To list users in an organization: Query User Service API: `GET /user-service/organization/{orgId}/users`
- This avoids data duplication and maintains single source of truth

### c. Organization-Device Mapping (Handled by Device Service)
- **Note:** Organization-Device mappings are **NOT stored in Organization Service**
- **Device Service** handles: `DEVICE#{deviceId}` → `DEVICE_ORG#{orgId}` mappings
- To list devices in an organization: Query Device Service API (if available) or filter devices by organizationId
- This avoids data duplication and maintains single source of truth

### d. Organization Metadata & Files
- **Update Metadata**: Store or update custom organization metadata
- **Upload File**: Organization uploads file to S3, Lambda updates organization record with file reference
- **List Files**: List all files associated with an organization

### e. Event-Driven Flows
- **Profile Change Events**: DynamoDB Streams trigger audit, analytics, or notification Lambdas
- **File Upload Events**: S3 events trigger file reference creation

## 3. AWS Architecture Diagram

```
API Gateway → Lambda → DynamoDB (OrganizationTable)
                           ├─ DynamoDB Streams → Lambda (audit/analytics/notifications)
                           ├─ S3 → Lambda (file upload reference via EventBridge)
                           └─ SQS → Lambda (async processing, if needed)
```

Components:
- **API Gateway**: Entry point for all organization-service APIs
- **Organization-Service Lambdas**: Handle business logic for organization CRUD, mappings, metadata, and file references
- **DynamoDB OrganizationTable**: Stores all organization data
- **DynamoDB Streams**: Triggers for audit, analytics, and notifications
- **S3**: For organization file uploads
- **EventBridge**: For S3 event routing to Lambda
- **SQS**: For async processing (optional)

## 4. DynamoDB Table Design & Access Patterns

### Table: OrganizationTable

**Primary Key Structure:**
- **PK (Partition Key)**: `pk` (String)
- **SK (Sort Key)**: `sk` (String)

**Global Secondary Indexes (GSI):**

**GSI1 (Organization List Index) - REQUIRED:**
- **PK (GSI1PK):** `ORG_LIST` (constant value for all organizations)
- **SK (GSI1SK):** `ORG#{organizationId}`
- **Projection:** ALL
- **Purpose:** Enable efficient querying of ALL organizations
- **Access Pattern:** List all organizations, filter by status, pagination

### Item Types and Key Patterns

| PK | SK | Purpose |
|---|---|---------|
| `ORG#{organizationId}` | `ORG_DETAILS` | Main organization profile record |
| `ORG#{organizationId}` | `ORG_USER#{userId}` | **REMOVED - Duplicate of User Service** |
| `ORG#{organizationId}` | `ORG_DEVICE#{deviceId}` | **REMOVED - Duplicate of Device Service** |
| `ORG#{organizationId}` | `ORG_METADATA` | Organization metadata (JSON object) |
| `ORG#{organizationId}` | `ORG_FILE#{fileId}` | Organization file reference |

### Detailed Item Schemas

#### 1. Organization Profile (ORG_DETAILS)

**Key Pattern:**
- PK: `ORG#{organizationId}`
- SK: `ORG_DETAILS`

**Attributes:**
```typescript
{
  pk: string;                    // "ORG#{organizationId}"
  sk: string;                    // "ORG_DETAILS"
  gsi1pk: string;                 // "ORG_LIST" (constant for GSI1)
  gsi1sk: string;                 // "ORG#{organizationId}" (for listing all orgs)
  organizationId: string;         // UUID
  name: string;                   // Organization name (required)
  email?: string;                 // Organization email
  phone?: string;                 // Organization phone number
  address?: string;               // Street address
  city?: string;                  // City
  state?: string;                 // State/Province
  country?: string;               // Country
  postalCode?: string;            // Postal/ZIP code
  status: string;                 // 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
  createdDate: number;            // Unix timestamp (milliseconds)
  modifiedDate: number;          // Unix timestamp (milliseconds)
  deleted?: boolean;              // Soft delete flag
  itemType: string;               // "ORG_DETAILS"
  // Additional optional fields
  website?: string;               // Organization website URL
  taxId?: string;                // Tax identification number
  registrationNumber?: string;    // Business registration number
  description?: string;          // Organization description
  industry?: string;              // Industry type
  size?: string;                  // Organization size (e.g., "SMALL", "MEDIUM", "LARGE")
}
```

**Important:** When creating/updating an organization, you MUST also set:
- `gsi1pk = "ORG_LIST"` (constant value)
- `gsi1sk = "ORG#{organizationId}"` (same as pk value)

This enables querying all organizations via GSI1.

#### 2. Organization Metadata (ORG_METADATA)

**Note:** Organization-User and Organization-Device mappings are **NOT stored in Organization Service** because:
- **User Service** already stores: `ORG#{orgId}` → `USER#{userId}` (organization to user mapping)
- **Device Service** already stores: `DEVICE#{deviceId}` → `DEVICE_ORG#{orgId}` (device to organization mapping)
- Storing these in Organization Service would create **data duplication** and consistency issues

**To list users/devices for an organization:**
- Query User Service: `listUsersByOrg(organizationId)` - uses `ORG#{orgId}` → `begins_with(USER#)`
- Query Device Service: `listDeviceOrganizations(deviceId)` - uses `DEVICE#{deviceId}` → `begins_with(DEVICE_ORG#)`
- Or use cross-service queries/aggregation if needed

#### 3. Organization Metadata (ORG_METADATA)

**Key Pattern:**
- PK: `ORG#{organizationId}`
- SK: `ORG_METADATA`

**Attributes:**
```typescript
{
  pk: string;                    // "ORG#{organizationId}"
  sk: string;                    // "ORG_METADATA"
  organizationId: string;        // UUID
  metadata: Record<string, unknown>; // JSON object with key-value pairs
  updatedAt: string;             // ISO 8601 timestamp
  itemType: string;              // "ORG_METADATA"
  // Additional optional fields
  updatedBy?: string;            // User ID who updated metadata
  version?: number;              // Metadata version number
}
```

#### 4. Organization File Reference (ORG_FILE)

**Key Pattern:**
- PK: `ORG#{organizationId}`
- SK: `ORG_FILE#{fileId}`

**Attributes:**
```typescript
{
  pk: string;                    // "ORG#{organizationId}"
  sk: string;                    // "ORG_FILE#{fileId}"
  organizationId: string;        // UUID
  fileId: string;                // UUID
  fileName: string;              // Original file name
  s3Key: string;                 // S3 object key
  uploadedAt: string;            // ISO 8601 timestamp
  itemType: string;              // "ORG_FILE"
  // Additional optional fields
  fileSize?: number;             // File size in bytes
  contentType?: string;          // MIME type
  uploadedBy?: string;            // User ID who uploaded the file
  description?: string;          // File description
  tags?: string[];               // File tags for categorization
}
```

## 5. DynamoDB Access Patterns

| Operation | PK | SK | Description |
|-----------|----|----|-------------|
| Create Organization | `ORG#{organizationId}` | `ORG_DETAILS` | Create new organization profile |
| Get Organization by ID | `ORG#{organizationId}` | `ORG_DETAILS` | Fetch organization profile |
| Update Organization | `ORG#{organizationId}` | `ORG_DETAILS` | Update organization profile fields |
| Delete Organization | `ORG#{organizationId}` | `ORG_DETAILS` | Soft delete (set deleted flag) |
| **List All Organizations** | `ORG_LIST` (GSI1PK) | `ORG#{organizationId}` (GSI1SK) | Query all organizations using GSI1 |
| **List Organizations by Status** | `ORG_LIST` (GSI1PK) | `ORG#{organizationId}` (GSI1SK) + FilterExpression | Filter organizations by status |
| **List Active Organizations** | `ORG_LIST` (GSI1PK) | `ORG#{organizationId}` (GSI1SK) + FilterExpression | Query active organizations only |
| Get Organization Metadata | `ORG#{organizationId}` | `ORG_METADATA` | Fetch organization metadata |
| Update Organization Metadata | `ORG#{organizationId}` | `ORG_METADATA` | Create or update metadata |
| List Organization Files | `ORG#{organizationId}` | `begins_with(ORG_FILE#)` | Query all files for organization |
| Create File Reference | `ORG#{organizationId}` | `ORG_FILE#{fileId}` | Create file reference after S3 upload |
| Audit/Stream Processing | Stream | Stream | DynamoDB Streams for change events |

## 6. Methods and Key Mappings

| Method | PK Mapping | SK Mapping | Integration |
|--------|------------|------------|-------------|
| `createOrganization()` | `ORG#{organizationId}` | `ORG_DETAILS` | Called by Admin UI / API |
| `getOrganizationById()` | `ORG#{organizationId}` | `ORG_DETAILS` | Organization profile view |
| `updateOrganization()` | `ORG#{organizationId}` | `ORG_DETAILS` | Profile edit |
| `deleteOrganization()` | `ORG#{organizationId}` | `ORG_DETAILS` | Soft delete, audit-safe |
| `listAllOrganizations()` | `ORG_LIST` (GSI1PK) | `ORG#{organizationId}` (GSI1SK) | Admin dashboard, organization listing |
| `listOrganizationsByStatus()` | `ORG_LIST` (GSI1PK) | `ORG#{organizationId}` (GSI1SK) + FilterExpression | Filter by status (ACTIVE, INACTIVE, etc.) |
| `updateOrganizationMetadata()` | `ORG#{organizationId}` | `ORG_METADATA` | Metadata management |
| `listOrganizationFiles()` | `ORG#{organizationId}` | `begins_with(ORG_FILE#)` | File management |
| `uploadOrganizationFile()` | `ORG#{organizationId}` | `ORG_FILE#{fileId}` | S3 event handler |
| `onOrganizationChange()` | Stream event | Stream event | Notifications, audit, analytics |

## 7. Table Configuration

### DynamoDB Table Settings

**Table Name:** `organization-table-${stage}`

**Billing Mode:** On-Demand (recommended for variable workloads) or Provisioned

**Stream Specification:**
- **Stream Enabled:** Yes
- **Stream View Type:** NEW_AND_OLD_IMAGES (for audit and change tracking)

**Point-in-Time Recovery:** Enabled (recommended for production)

**Encryption:**
- **Encryption Type:** AWS owned keys (default) or AWS managed keys (KMS)

**Tags:**
- Service: organization-service
- Stage: ${stage}
- ManagedBy: serverless

### Capacity Settings (if using Provisioned mode)

**Read Capacity Units:** 5 (adjust based on workload)
**Write Capacity Units:** 5 (adjust based on workload)

**Auto Scaling:** Recommended for production workloads

## 8. Indexes and Query Optimization

### Current Design (GSI1 Required for Listing All Organizations)

**GSI1 (Organization List Index) - REQUIRED:**
- **PK (GSI1PK):** `ORG_LIST` (constant value)
- **SK (GSI1SK):** `ORG#{organizationId}`
- **Projection:** ALL
- **Purpose:** Enable efficient querying of ALL organizations
- **Usage:** 
  - List all organizations: Query GSI1 where `gsi1pk = "ORG_LIST"`
  - Filter by status: Add FilterExpression on `status` attribute
  - Pagination: Use `ExclusiveStartKey` for pagination

**Why GSI1 is Required:**
- Without GSI1, you cannot efficiently list all organizations because each organization has a unique partition key (`ORG#{organizationId}`)
- DynamoDB cannot query across different partition keys efficiently
- A Scan operation would be required, which is inefficient and expensive
- GSI1 provides a single partition (`ORG_LIST`) containing all organizations

### Reverse Lookups (Not Needed in Organization Service)

**User-Organization Lookup:**
- Already handled by **User Service**: `USER#{userId}` → `ORG#{orgId}` mapping
- Query User Service: `listUserOrganizations(userId)`

**Device-Organization Lookup:**
- Already handled by **Device Service**: `DEVICE#{deviceId}` → `DEVICE_ORG#{orgId}` mapping
- Query Device Service: `listDeviceOrganizations(deviceId)`

**Organization-User Lookup:**
- Query **User Service**: `listUsersByOrg(organizationId)` using `ORG#{orgId}` → `begins_with(USER#)`

**Organization-Device Lookup:**
- Query **Device Service**: Filter devices by organizationId (requires GSI in Device Service or scan)
- Or maintain reverse mapping in Device Service if needed

## 9. Data Consistency and Transactions

### Consistency Model
- **Read Consistency:** Eventually consistent (default) or strongly consistent when needed
- **Write Consistency:** Strongly consistent (DynamoDB default)

### Transaction Support
For operations requiring atomicity across multiple items:
- Use DynamoDB Transactions API (`TransactWriteItems`)
- Example: Creating organization and initial user assignment in a single transaction

### Idempotency
- All write operations should be idempotent
- Use conditional expressions to prevent duplicate writes
- Example: `ConditionExpression: 'attribute_not_exists(pk)'` for create operations

## 10. Data Retention and Lifecycle

### Soft Deletes
- Organizations are soft-deleted by setting `deleted: true` flag
- Soft-deleted organizations are filtered out in queries
- Hard deletes can be performed after a retention period (e.g., 90 days)

### TTL (Time To Live) - Optional
- Consider adding TTL attribute for automatic cleanup of:
  - Old file references (after retention period)
  - Soft-deleted organizations (after retention period)
  - Audit logs (if stored in same table)

## 11. Access Control and Security

### IAM Permissions Required

**DynamoDB Permissions:**
```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem",
    "dynamodb:Query",
    "dynamodb:BatchGetItem",
    "dynamodb:BatchWriteItem",
    "dynamodb:TransactWriteItems",
    "dynamodb:DescribeTable"
  ],
  "Resource": [
    "arn:aws:dynamodb:${region}:${accountId}:table/organization-table-*",
    "arn:aws:dynamodb:${region}:${accountId}:table/organization-table-*/index/*"
  ]
}
```

### Data Encryption
- **At Rest:** DynamoDB encryption (AWS managed keys or KMS)
- **In Transit:** TLS/SSL for all API calls

### PII Handling
- Email addresses and phone numbers are considered PII
- Ensure compliance with data protection regulations
- Logging should not include full PII (redact or hash sensitive data)

## 12. Performance Considerations

### Query Optimization
- Use `begins_with()` for prefix queries (e.g., listing users, devices, files)
- Limit result sets using `Limit` parameter
- Implement pagination for large result sets using `ExclusiveStartKey`

### Batch Operations
- Use `BatchGetItem` for fetching multiple organizations
- Use `BatchWriteItem` for bulk updates (up to 25 items per batch)

### Caching Strategy
- Consider caching frequently accessed organization profiles
- Use CloudFront or ElastiCache for read-heavy workloads
- Cache invalidation on updates

## 13. Monitoring and Observability

### CloudWatch Metrics to Monitor
- `ConsumedReadCapacityUnits`
- `ConsumedWriteCapacityUnits`
- `ThrottledRequests`
- `UserErrors`
- `SystemErrors`

### DynamoDB Streams Metrics
- `IteratorAge` (for stream processing lag)
- Stream record processing errors

### Alarms
- Set up alarms for throttling
- Monitor stream processing lag
- Alert on high error rates

## 14. Migration and Backup

### Backup Strategy
- Enable Point-in-Time Recovery (PITR)
- Regular on-demand backups for major changes
- Cross-region replication for disaster recovery (optional)

### Data Migration
- Use AWS DMS or custom scripts for data migration
- Test migration scripts in non-production environments
- Plan for zero-downtime migration if needed

## 15. Comparison with User Service Schema

### Similarities
- Both use single-table design with composite keys
- Both use prefix patterns for queries (`begins_with()`)
- Both support soft deletes
- Both use DynamoDB Streams for change events
- Both have metadata and file reference patterns

### Differences
- **Organization Service** does NOT store user/device mappings (to avoid duplication)
- **User Service** has doctor-patient relationships (not in Organization Service)
- **Organization Service** focuses on organization profile management only
- **User Service** stores organization-user mappings from organization's perspective

### Integration Points & Data Ownership

**User-Organization Mapping:**
- **User Service** stores: `ORG#{orgId}` → `USER#{userId}` (organization to user mapping)
- **Organization Service** does NOT duplicate this mapping
- To list users in an organization: Query User Service with `ORG#{orgId}` → `begins_with(USER#)`

**Device-Organization Mapping:**
- **Device Service** stores: `DEVICE#{deviceId}` → `DEVICE_ORG#{orgId}` (device to organization mapping)
- **Organization Service** does NOT duplicate this mapping
- To list devices in an organization: Query Device Service (may require GSI or scan with filter)

**Why No Duplication:**
- **Single Source of Truth**: Each relationship is stored in ONE service only
- **Consistency**: Avoids data synchronization issues
- **Service Autonomy**: Each service owns its domain data
- **Query Direction**: Services query other services when needed (via API calls or events)

## 16. Example Queries

### Get Organization Profile
```typescript
const params = {
  TableName: 'organization-table-dev',
  Key: {
    pk: 'ORG#550e8400-e29b-41d4-a716-446655440000',
    sk: 'ORG_DETAILS'
  }
};
const result = await docClient.get(params);
```

### List All Users in Organization
```typescript
const params = {
  TableName: 'organization-table-dev',
  KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
  ExpressionAttributeValues: {
    ':pk': 'ORG#550e8400-e29b-41d4-a716-446655440000',
    ':skPrefix': 'ORG_USER#'
  }
};
const result = await docClient.query(params);
```

### List All Devices in Organization
```typescript
const params = {
  TableName: 'organization-table-dev',
  KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
  ExpressionAttributeValues: {
    ':pk': 'ORG#550e8400-e29b-41d4-a716-446655440000',
    ':skPrefix': 'ORG_DEVICE#'
  }
};
const result = await docClient.query(params);
```

### List All Files for Organization
```typescript
const params = {
  TableName: 'organization-table-dev',
  KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
  ExpressionAttributeValues: {
    ':pk': 'ORG#550e8400-e29b-41d4-a716-446655440000',
    ':skPrefix': 'ORG_FILE#'
  }
};
const result = await docClient.query(params);
```

### List All Organizations (Using GSI1)
```typescript
const params = {
  TableName: 'organization-table-dev',
  IndexName: 'GSI1', // Use GSI1 index
  KeyConditionExpression: 'gsi1pk = :gsi1pk',
  FilterExpression: 'attribute_not_exists(deleted) AND status = :status', // Optional: filter active orgs
  ExpressionAttributeValues: {
    ':gsi1pk': 'ORG_LIST',
    ':status': 'ACTIVE'
  },
  // Pagination support
  Limit: 20,
  // ExclusiveStartKey: { gsi1pk: 'ORG_LIST', gsi1sk: 'ORG#lastOrgId' } // For pagination
};
const result = await docClient.query(params);
```

### List All Organizations (No Filters)
```typescript
const params = {
  TableName: 'organization-table-dev',
  IndexName: 'GSI1',
  KeyConditionExpression: 'gsi1pk = :gsi1pk',
  ExpressionAttributeValues: {
    ':gsi1pk': 'ORG_LIST'
  }
};
const result = await docClient.query(params);
```

### Create Organization with Conditional Expression
```typescript
const params = {
  TableName: 'organization-table-dev',
  Item: {
    pk: 'ORG#550e8400-e29b-41d4-a716-446655440000',
    sk: 'ORG_DETAILS',
    organizationId: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Acme Corporation',
    status: 'ACTIVE',
    createdDate: Date.now(),
    modifiedDate: Date.now(),
    itemType: 'ORG_DETAILS'
  },
  ConditionExpression: 'attribute_not_exists(pk)'
};
await docClient.put(params);
```

## 17. Validation Rules

### Organization Profile Validation
- `organizationId`: Required, must be valid UUID
- `name`: Required, 1-255 characters
- `email`: Optional, must be valid email format if provided
- `phone`: Optional, must be valid phone format if provided
- `status`: Required, must be one of: 'ACTIVE', 'INACTIVE', 'SUSPENDED'
- `createdDate`: Required, must be valid timestamp
- `modifiedDate`: Required, must be valid timestamp

### Organization-User Mapping Validation
- `organizationId`: Required, must be valid UUID
- `userId`: Required, must be valid UUID
- `assignedAt`: Required, must be valid ISO 8601 timestamp
- `role`: Optional, string
- `status`: Optional, must be one of: 'ACTIVE', 'INACTIVE', 'REMOVED' if provided

### Organization-Device Mapping Validation
- `organizationId`: Required, must be valid UUID
- `deviceId`: Required, must be valid UUID or device identifier
- `assignedAt`: Required, must be valid ISO 8601 timestamp
- `status`: Optional, must be one of: 'ACTIVE', 'INACTIVE', 'REMOVED' if provided

### Organization Metadata Validation
- `organizationId`: Required, must be valid UUID
- `metadata`: Required, must be non-empty object
- `updatedAt`: Required, must be valid ISO 8601 timestamp

### Organization File Reference Validation
- `organizationId`: Required, must be valid UUID
- `fileId`: Required, must be valid UUID
- `fileName`: Required, non-empty string
- `s3Key`: Required, valid S3 key format
- `uploadedAt`: Required, must be valid ISO 8601 timestamp

## 18. Error Handling

### Common Error Scenarios

1. **Organization Not Found**
   - Error: `OrganizationNotFoundError`
   - HTTP Status: 404
   - Condition: `attribute_not_exists(pk)` when getting organization

2. **Organization Already Exists**
   - Error: `OrganizationAlreadyExistsError`
   - HTTP Status: 409
   - Condition: `attribute_exists(pk)` when creating organization

3. **Validation Errors**
   - Error: `OrganizationValidationError`
   - HTTP Status: 400
   - Condition: Invalid input data

4. **DynamoDB Errors**
   - Error: `DynamoDBError`
   - HTTP Status: 500
   - Condition: DynamoDB service errors (throttling, etc.)

## 19. Testing Considerations

### Unit Test Scenarios
- Repository methods with mocked DynamoDB client
- Service layer business logic
- Validation schemas
- Error handling

### Integration Test Scenarios
- End-to-end API tests with DynamoDB Local
- Stream handler tests with mock stream events
- S3 event handler tests

### Test Data
- Use consistent test organization IDs
- Clean up test data after tests
- Use separate test table or environment

## 20. How to Fetch All Organizations

### Problem Statement
With the primary key design (`ORG#{organizationId}`), each organization has a unique partition key. DynamoDB cannot efficiently query across different partition keys, making it impossible to list all organizations without a GSI.

### Solution: GSI1 (Organization List Index)

**GSI1 Configuration:**
- **GSI1PK:** `ORG_LIST` (constant value for all organization records)
- **GSI1SK:** `ORG#{organizationId}` (unique per organization)

**Implementation:**
When creating or updating an organization, always set:
```typescript
{
  pk: 'ORG#{organizationId}',
  sk: 'ORG_DETAILS',
  gsi1pk: 'ORG_LIST',           // Constant value
  gsi1sk: 'ORG#{organizationId}', // Same as pk
  // ... other attributes
}
```

### Query Examples

#### 1. List All Organizations
```typescript
const params = {
  TableName: 'organization-table-dev',
  IndexName: 'GSI1',
  KeyConditionExpression: 'gsi1pk = :gsi1pk',
  ExpressionAttributeValues: {
    ':gsi1pk': 'ORG_LIST'
  }
};
const result = await docClient.query(params);
```

#### 2. List Active Organizations Only
```typescript
const params = {
  TableName: 'organization-table-dev',
  IndexName: 'GSI1',
  KeyConditionExpression: 'gsi1pk = :gsi1pk',
  FilterExpression: 'status = :status AND attribute_not_exists(deleted)',
  ExpressionAttributeValues: {
    ':gsi1pk': 'ORG_LIST',
    ':status': 'ACTIVE'
  }
};
const result = await docClient.query(params);
```

#### 3. List Organizations with Pagination
```typescript
const params = {
  TableName: 'organization-table-dev',
  IndexName: 'GSI1',
  KeyConditionExpression: 'gsi1pk = :gsi1pk',
  ExpressionAttributeValues: {
    ':gsi1pk': 'ORG_LIST'
  },
  Limit: 20,
  ExclusiveStartKey: lastEvaluatedKey // From previous query
};
const result = await docClient.query(params);
```

### Performance Considerations
- **GSI1 Query Performance**: O(1) for partition key lookup, efficient for listing
- **FilterExpression**: Applied after query, doesn't reduce read capacity units
- **Pagination**: Use `Limit` and `ExclusiveStartKey` for large result sets
- **Caching**: Consider caching organization lists if frequently accessed

### Alternative Approaches (Not Recommended)
1. **Scan Operation**: Inefficient, scans entire table, expensive
2. **Separate Table**: Adds complexity, requires synchronization
3. **ElastiCache**: Can cache results but requires cache invalidation strategy

## 21. Data Duplication Analysis

### Removed Mappings (Duplicates)

#### ❌ Organization-User Mapping (REMOVED)
**Reason:** Already stored in User Service
- **User Service:** `ORG#{orgId}` → `USER#{userId}`
- **Organization Service:** ~~`ORG#{orgId}` → `ORG_USER#{userId}`~~ (REMOVED)

**How to List Users in Organization:**
```typescript
// Query User Service
const users = await userService.listUsersByOrg(organizationId);
// Uses: ORG#{orgId} → begins_with(USER#)
```

#### ❌ Organization-Device Mapping (REMOVED)
**Reason:** Already stored in Device Service
- **Device Service:** `DEVICE#{deviceId}` → `DEVICE_ORG#{orgId}`
- **Organization Service:** ~~`ORG#{orgId}` → `ORG_DEVICE#{deviceId}`~~ (REMOVED)

**How to List Devices in Organization:**
```typescript
// Option 1: Query Device Service (if GSI exists)
const devices = await deviceService.listDevicesByOrg(organizationId);

// Option 2: Scan Device Service with FilterExpression
// (Less efficient, but works if GSI not available)
```

### Why This Design is Correct

1. **Single Source of Truth**: Each relationship stored once
2. **Service Boundaries**: Each service owns its domain data
3. **No Synchronization Issues**: No need to keep duplicate data in sync
4. **Clear Ownership**: User Service owns user-org relationships, Device Service owns device-org relationships
5. **Query Direction**: Services query other services when needed (microservices pattern)

### Cross-Service Queries

If you need to get organization with its users and devices:
```typescript
// Option 1: Sequential API calls
const org = await organizationService.getOrganization(orgId);
const users = await userService.listUsersByOrg(orgId);
const devices = await deviceService.listDevicesByOrg(orgId);

// Option 2: Parallel API calls (faster)
const [org, users, devices] = await Promise.all([
  organizationService.getOrganization(orgId),
  userService.listUsersByOrg(orgId),
  deviceService.listDevicesByOrg(orgId)
]);

// Option 3: Event-driven aggregation (for read-heavy scenarios)
// Use EventBridge to maintain read-optimized views if needed
```

## 22. Future Enhancements

### Potential Schema Extensions
1. **Organization Hierarchy**: Support parent-child organization relationships
2. **Organization Settings**: Dedicated item type for organization configuration
3. **Organization Audit Log**: Store audit trail in same table
4. **Organization Tags**: Support tagging for categorization
5. **Organization Permissions**: Store permission mappings

### Performance Optimizations
1. ✅ **GSI1 for listing** - Already implemented
2. Implement read replicas for read-heavy workloads
3. Add caching layer (ElastiCache/CloudFront) for organization lists
4. Implement pagination for all list operations
5. Consider composite GSI for status-based queries (e.g., `STATUS#ACTIVE` → `ORG#{orgId}`)

---

**Document Version:** 1.0  
**Last Updated:** 2025-01-13  
**Author:** Senior AWS Architect Review
