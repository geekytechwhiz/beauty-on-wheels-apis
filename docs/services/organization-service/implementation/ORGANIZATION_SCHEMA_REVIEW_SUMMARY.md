# Organization Service Schema Review - Summary

## Executive Summary

As a senior AWS architect, I've reviewed the Organization Service database schema and identified **critical issues** that need to be addressed:

1. ✅ **Missing "List All Organizations" Pattern** - FIXED with GSI1
2. ✅ **Data Duplication** - REMOVED duplicate mappings
3. ✅ **Clarified Service Boundaries** - Documented cross-service queries

---

## Issue 1: How to Fetch All Organizations List

### Problem
The original schema design used `ORG#{organizationId}` as the partition key, which makes it **impossible to efficiently list all organizations** because:
- Each organization has a unique partition key
- DynamoDB cannot query across different partition keys
- A Scan operation would be required (inefficient and expensive)

### Solution: GSI1 (Organization List Index)

**Added GSI1 Configuration:**
```
GSI1PK: "ORG_LIST" (constant value for all organizations)
GSI1SK: "ORG#{organizationId}" (unique per organization)
Projection: ALL
```

**Implementation:**
When creating/updating an organization, always set:
```typescript
{
  pk: 'ORG#{organizationId}',
  sk: 'ORG_DETAILS',
  gsi1pk: 'ORG_LIST',           // Constant value
  gsi1sk: 'ORG#{organizationId}', // Same as pk
  // ... other attributes
}
```

**Query Example:**
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

**Benefits:**
- ✅ Efficient O(1) query performance
- ✅ Supports pagination
- ✅ Can filter by status using FilterExpression
- ✅ No expensive Scan operations needed

---

## Issue 2: Data Duplication - Organization-User Mapping

### Problem Identified
The schema included `ORG#{orgId}` → `ORG_USER#{userId}` mapping, which **duplicates** data already stored in User Service.

### Current State (User Service)
**User Service** already stores:
- `ORG#{orgId}` → `USER#{userId}` (organization to user mapping)
- Access pattern: `listUsersByOrg(orgId)` uses `ORG#{orgId}` → `begins_with(USER#)`

### Decision: REMOVE from Organization Service
**Reasoning:**
1. **Single Source of Truth**: User Service owns user-organization relationships
2. **No Synchronization Issues**: Avoids keeping duplicate data in sync
3. **Service Autonomy**: Each service owns its domain data
4. **Microservices Best Practice**: Services query other services when needed

### How to List Users in Organization
```typescript
// Query User Service (not Organization Service)
const users = await userService.listUsersByOrg(organizationId);
// Uses: ORG#{orgId} → begins_with(USER#)
```

---

## Issue 3: Data Duplication - Organization-Device Mapping

### Problem Identified
The schema included `ORG#{orgId}` → `ORG_DEVICE#{deviceId}` mapping, which **duplicates** data already stored in Device Service.

### Current State (Device Service)
**Device Service** already stores:
- `DEVICE#{deviceId}` → `DEVICE_ORG#{orgId}` (device to organization mapping)
- Access pattern: `listDeviceOrganizations(deviceId)` uses `DEVICE#{deviceId}` → `begins_with(DEVICE_ORG#)`

### Decision: REMOVE from Organization Service
**Reasoning:**
1. **Single Source of Truth**: Device Service owns device-organization relationships
2. **No Synchronization Issues**: Avoids keeping duplicate data in sync
3. **Service Autonomy**: Each service owns its domain data
4. **Microservices Best Practice**: Services query other services when needed

### How to List Devices in Organization
```typescript
// Option 1: Query Device Service (if GSI exists)
const devices = await deviceService.listDevicesByOrg(organizationId);

// Option 2: Scan Device Service with FilterExpression
// (Less efficient, but works if GSI not available)
```

---

## Updated Schema Summary

### What Organization Service Stores

✅ **Organization Profile** (`ORG_DETAILS`)
- Organization profile information (name, contact, address, etc.)
- Primary key: `ORG#{organizationId}` → `ORG_DETAILS`
- GSI1: `ORG_LIST` → `ORG#{organizationId}` (for listing all orgs)

✅ **Organization Metadata** (`ORG_METADATA`)
- Custom metadata as JSON object
- Primary key: `ORG#{organizationId}` → `ORG_METADATA`

✅ **Organization File References** (`ORG_FILE`)
- File references after S3 uploads
- Primary key: `ORG#{organizationId}` → `ORG_FILE#{fileId}`

❌ **Organization-User Mapping** - REMOVED (handled by User Service)
❌ **Organization-Device Mapping** - REMOVED (handled by Device Service)

---

## Cross-Service Query Patterns

### Get Organization with Users and Devices

```typescript
// Sequential approach
const org = await organizationService.getOrganization(orgId);
const users = await userService.listUsersByOrg(orgId);
const devices = await deviceService.listDevicesByOrg(orgId);

// Parallel approach (faster)
const [org, users, devices] = await Promise.all([
  organizationService.getOrganization(orgId),
  userService.listUsersByOrg(orgId),
  deviceService.listDevicesByOrg(orgId)
]);
```

### Service Responsibilities

| Service | Owns | Queries |
|---------|------|---------|
| **Organization Service** | Organization profiles, metadata, files | - |
| **User Service** | User profiles, user-org mappings | Organization Service (for org details) |
| **Device Service** | Device profiles, device-org mappings | Organization Service (for org details) |

---

## Key Takeaways

1. ✅ **GSI1 is REQUIRED** for listing all organizations efficiently
2. ✅ **No duplicate mappings** - Each relationship stored once in its owning service
3. ✅ **Clear service boundaries** - Each service owns its domain data
4. ✅ **Cross-service queries** - Services query other services via API when needed
5. ✅ **Single source of truth** - Prevents data synchronization issues

---

## Implementation Checklist

- [x] Add GSI1 to Organization Table schema
- [x] Update organization creation to set `gsi1pk` and `gsi1sk`
- [x] Remove Organization-User mapping from Organization Service
- [x] Remove Organization-Device mapping from Organization Service
- [x] Update API handlers to remove user/device mapping endpoints
- [x] Document cross-service query patterns
- [x] Update service documentation to reflect changes

---

**Document Version:** 2.0  
**Last Updated:** 2025-01-13  
**Author:** Senior AWS Architect Review
