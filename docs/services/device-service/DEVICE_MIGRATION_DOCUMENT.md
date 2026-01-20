# Device Management Microservice - Migration Document

## Executive Summary

This document provides a comprehensive analysis of all device-related functionality in the codebase, including table mappings, endpoints, request/response structures, and triggers. It serves as a blueprint for creating an independent device management microservice.

---

## 1. Database Tables & Mappings

### 1.1 Table: `{STAGE}_common_user_data` (DynamoDB)

All device-related data is stored in a single DynamoDB table using a single-table design pattern with composite keys.

---

### 1.2 Organization-Device Mapping

#### Entry 1: Organization → Device (Forward Mapping)
**Primary Key Structure:**
```
pk: `ORG_DEVICES#${organizationId}`
sk: `${deviceId.toUpperCase().split(' ').join('_')}`
sk1: `${device.category.toUpperCase().split(' ').join('_')}`
sk2: `${device.name.toUpperCase().split(' ').join('_')}`
sk3: `${device.category}#${device.name}`
```

**Attributes:**
- `organizationID`: String (Organization ID)
- `enabled`: Boolean (default: true)
- `isAutoSyncSupported`: Boolean (default: true)
- `name`: String (Organization name)
- `createdDate`: Number (Timestamp)
- `modifiedDate`: Number (Timestamp)

#### Entry 2: Device → Organization (Reverse Mapping)
**Primary Key Structure:**
```
pk: `ORG_DEVICES#${deviceId.toUpperCase().split(' ').join('_')}`
sk: `${organizationId}`
sk1: `${device.category.toUpperCase().split(' ').join('_')}`
sk2: `${device.name.toUpperCase().split(' ').join('_')}`
sk3: `${device.category}#${device.name}`
```

**Attributes:** Same as Entry 1

**Purpose:** Bidirectional lookup for organization-device relationships

---

### 1.3 User-Device Mapping

#### User Device Entry
**Primary Key Structure:**
```
pk: `DEVICE_LIST#${userId}`
sk: `DETAILS#${configDeviceId}`
sk1: `DEVICE#${deviceCategory}`
sk2: `STATUS#ACTIVE` (or inactive)
```

**Attributes:**
- `userId`: String (User ID)
- `deviceId`: String (Generated unique device ID - SHA256 hash of `userId-configDeviceId`)
- `configDeviceId`: String (Device configuration ID)
- `macAddress`: String (Device MAC address)
- `displayName`: String (Device display name)
- `deviceCategory`: String (Device category)
- `companyName`: String (Manufacturer name)
- `modelName`: String (Device model)
- `platform`: String (iOS, Android, etc.)
- `isAutoSyncEnabled`: Boolean
- `isAutoSyncSupported`: Boolean
- `isSync`: Boolean
- `userIndex`: Number (User index on device)
- `noOfUsers`: Number (Number of users on device)
- `lastReadingTimeStamp`: Number (Last reading timestamp)
- `lastSequenceNumber`: String
- `localName`: String
- `usesExtensionProtocol`: Boolean
- `supportsUserAuthentication`: Boolean
- `databaseUpdateFlag`: Boolean
- `databaseChangeIncrement`: Number
- `isDeviceDeleted`: Boolean
- `iOSIdentifier`: String
- `autoSyncDelay`: Number
- `isEagleDevice`: Boolean
- `deviceCategoryNum`: String
- `updates`: Array (Update history records)
  - `updatedBy`: String
  - `updatedAt`: Number
- `createdDate`: Number (Timestamp)
- `modifiedDate`: Number (Timestamp)

---

### 1.4 Device Recommendations Mapping

#### Device Recommendation Entry
**Primary Key Structure:**
```
pk: `RECOMMEND`
sk: `${deviceId.toUpperCase().split(' ').join('_')}#${patientUserId}`
sk1: `${patientUserId}`
sk2: `${doctorId}` (userId who recommended)
sk3: `${organizationId}`
sk4: `${deviceId.toUpperCase().split(' ').join('_')}`
sk5: `${patientUserId}#${device.category}#${device.name}`
```

**Attributes:**
- `doctorData`: Object
  - `doctorName`: String
  - `doctorId`: String
  - `recommendTime`: Number
- `organizationID`: String
- `status`: String (`UNPAIRED` or `PAIRED`)
- `createdDate`: Number
- `modifiedDate`: Number

**Indexes Used:**
- `pk-sk1-index`: Query recommendations by patient user ID
- `pk-sk3-index`: Query devices by category#name

---

### 1.5 Global Device List

#### Global Device Entry
**Primary Key Structure:**
```
pk: `DEVICE_LIST`
sk: `${CATEGORY}#${category}#${deviceId}`
sk3: `${deviceId.toUpperCase().split(' ').join('_')}`
sk4: `${category.toUpperCase()}`
```

**Attributes:**
- `enabled`: Boolean (default: true)
- `category`: String
- `name`: String
- `deviceId`: String
- `countriesSupported`: Array (Country codes)
- Additional device metadata

**Indexes Used:**
- `pk-sk3-index`: Query by device ID
- `pk-sk4-index`: Query by category

---

## 2. API Endpoints

### 2.1 POST `/device-user-registration`

**Description:** Pair/register a device with a user

**Lambda Function:** `{STAGE}_user_device_registration`

**Request Headers:**
- `Authorization`: Bearer token
- `Content-Type`: application/json

**Request Body:**
```json
{
  "devices": [
    {
      "configDeviceId": "string (required)",
      "displayName": "string (required)",
      "noOfUsers": "number (required)",
      "deviceCategory": "string (required)",
      "companyName": "string (required)",
      "modelName": "string (required)",
      "usesExtensionProtocol": "boolean (required)",
      "supportsUserAuthentication": "boolean (required)",
      "platform": "string (required)",
      "isAutoSyncEnabled": "boolean (required)",
      "isAutoSyncSupported": "boolean (required)",
      "autoSyncDelay": "number (required)",
      "isSync": "boolean (required)",
      "macAddress": "string (optional)",
      "localName": "string (optional)",
      "lastSequenceNumber": "string (optional)",
      "lastReadingTimeStamp": "string (optional)",
      "databaseUpdateFlag": "boolean (optional)",
      "databaseChangeIncrement": "number (optional)",
      "isDeviceDeleted": "boolean (optional)",
      "iOSIdentifier": "string (optional)",
      "isEagleDevice": "boolean (optional)",
      "userIndex": "number (optional)",
      "deviceCategoryNum": "string (optional)"
    }
  ],
  "userID": "string (optional - from authorizer)",
  "organizationId": "string (optional - from authorizer)"
}
```

**Response Structure:**
```json
{
  "success": true,
  "statusCode": 201,
  "data": [
    {
      "message": "Device successfully paired with the user",
      "statusCode": 201,
      "configDeviceId": "string",
      "deviceId": "string"
    }
  ]
}
```

**Error Response:**
```json
{
  "success": false,
  "errorCode": "ERROR_CODE",
  "message": {
    "code": "ERROR_CODE",
    "message": "Error message"
  },
  "statusCode": 400
}
```

**Special Behavior:**
- If device is paired successfully and is not a third-party app, triggers task completion: `{STAGE}_complete_user_task` with `taskId: PAIR_DEVICE`
- Third-party apps allowed: `GOOGLEFIT`, `APPLEHEALTH`, `FITBIT`, `GARMIN`, `MANUAL`
- Non-third-party devices must exist in organization device list

---

### 2.2 POST `/delete-device`

**Description:** Delete/deactivate a single device for a user

**Lambda Function:** `{STAGE}_delete_device`

**Request Headers:**
- `Authorization`: Bearer token
- `Content-Type`: application/json

**Request Body:**
```json
{
  "deviceId": "string (required)",
  "userID": "string (optional - from authorizer)"
}
```

**Response Structure:**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Device deleted successfully"
}
```

**Error Response:**
```json
{
  "success": false,
  "errorCode": "ERROR_CODE",
  "message": {
    "code": "ERROR_CODE",
    "message": "Error message"
  },
  "statusCode": 400
}
```

**Special Behavior:**
- Sets device status to inactive (updates `sk2` to `STATUS#INACTIVE`)
- Updates device entry with deletion timestamp

---

### 2.3 POST `/delete-multiple-devices`

**Description:** Delete/deactivate multiple devices for a user

**Lambda Function:** `{STAGE}_delete_multiple_devices`

**Request Headers:**
- `Authorization`: Bearer token
- `Content-Type`: application/json

**Request Body:**
```json
{
  "devices": ["string (configDeviceId)", ...],
  "userID": "string (optional - from authorizer)"
}
```

**Response Structure:**
```json
{
  "success": true,
  "statusCode": 201,
  "data": [
    {
      "success": true,
      "configDeviceId": "string",
      "message": "Device deleted successfully"
    },
    {
      "success": false,
      "configDeviceId": "string",
      "errorKey": "DEVICE.DEVICE_NOT_FOUND",
      "errorCode": "ERROR_CODE",
      "message": {
        "code": "ERROR_CODE",
        "message": "Error message"
      }
    }
  ]
}
```

**Special Behavior:**
- Processes each device independently
- Returns individual success/failure for each device
- Also updates recommendation status if device was recommended

---

### 2.4 POST `/retrieve-device-list`

**Description:** Retrieve list of devices for a user

**Lambda Function:** `{STAGE}_retrieve_device_list`

**Request Headers:**
- `Authorization`: Bearer token
- `Content-Type`: application/json

**Request Body:**
```json
{
  "deviceId": "string (optional)",
  "deviceType": "string (optional)",
  "userID": "string (optional - from authorizer)"
}
```

**Response Structure:**
```json
{
  "success": true,
  "statusCode": 200,
  "data": [
    {
      "userId": "string",
      "deviceId": "string",
      "configDeviceId": "string",
      "macAddress": "string",
      "displayName": "string",
      "deviceCategory": "string",
      "companyName": "string",
      "modelName": "string",
      "platform": "string",
      "isAutoSyncEnabled": "boolean",
      "isAutoSyncSupported": "boolean",
      "isSync": "boolean",
      "userIndex": "number",
      "noOfUsers": "number",
      "lastReadingTimeStamp": "number",
      "deviceImage": "string (URL)",
      "deviceCategoryNum": "number"
    }
  ]
}
```

**Special Behavior:**
- Filters devices by user ID
- Optionally filters by `deviceId` or `deviceType`
- Enriches response with device images from global device list
- Converts `deviceCategoryNum` to integer

---

### 2.5 POST `/get-device-list`

**Description:** Get device list based on different contexts (organization, patient, recommendations, categories)

**Lambda Function:** `{STAGE}_get_device_list`

**Request Headers:**
- `Authorization`: Bearer token
- `Content-Type`: application/json

**Request Body:**
```json
{
  "action": "string (required) - One of: 'organization', 'patient', 'recommend', 'deviceCategory'",
  "organizationID": "string (optional - from authorizer)",
  "userID": "string (optional - from authorizer)",
  "patientUserId": "string (optional - required for 'recommend' when doctor views patient)",
  "category": "string (optional)",
  "searchValue": "string (optional)",
  "countryCode": "string (optional)"
}
```

**Response Structure:**

**Action: 'organization' (Root user only):**
```json
{
  "success": true,
  "statusCode": 200,
  "data": [
    {
      "deviceId": "string",
      "category": "string",
      "name": "string",
      "enabled": "boolean",
      "countriesSupported": ["string"],
      ...
    }
  ]
}
```

**Action: 'patient' (Doctor viewing devices to recommend):**
```json
{
  "success": true,
  "statusCode": 200,
  "data": [
    {
      "deviceId": "string",
      "category": "string",
      "name": "string",
      ...
    }
  ]
}
```

**Action: 'recommend' (View recommended devices):**
```json
{
  "success": true,
  "statusCode": 200,
  "data": [
    {
      "deviceId": "string",
      "category": "string",
      "name": "string",
      "status": "string (UNPAIRED/PAIRED)",
      "doctorData": {
        "doctorName": "string",
        "doctorId": "string",
        "recommendTime": "number"
      },
      ...
    }
  ]
}
```

**Action: 'deviceCategory' (Get all categories):**
```json
{
  "success": true,
  "statusCode": 200,
  "data": ["category1", "category2", ...]
}
```

**Special Behavior:**
- `organization` action requires `ROOT` organization ID
- `recommend` with `patientUserId` returns patient's recommended devices
- `recommend` with `userID` returns user's own recommended devices
- `patient` action returns organization's available devices for recommendation
- Optionally filters by country code

---

### 2.6 POST `/add-remove-org-devices`

**Description:** Add, remove, or update devices in an organization (Root user only)

**Lambda Function:** `{STAGE}_add_remove_org_devices`

**Request Headers:**
- `Authorization`: Bearer token
- `Content-Type`: application/json

**Request Body:**
```json
{
  "action": "string (required) - One of: 'add', 'remove', 'update'",
  "organizationId": "string (required)",
  "devices": [
    {
      "deviceId": "string (required)",
      "category": "string (required)",
      "name": "string (required)"
    }
  ],
  "deviceId": "string (optional - required for 'update')",
  "enabled": "boolean (optional - for 'update')",
  "isAutoSyncSupported": "boolean (optional - for 'update')",
  "userID": "string (optional - from authorizer)",
  "organizationID": "string (optional - from authorizer - must be ROOT)"
}
```

**Response Structure:**

**Action: 'add' or 'remove':**
```json
{
  "success": true,
  "statusCode": 201,
  "message": [
    {
      "success": true,
      "deviceId": "string",
      "message": "Devices added in organization successfully"
    }
  ]
}
```

**Action: 'update':**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Device updated successfully"
}
```

**Special Behavior:**
- Requires `ROOT` organization ID
- Creates bidirectional mappings (organization→device and device→organization)
- Creates organization update history entry
- Validates organization exists and is not deleted

---

### 2.7 POST `/add-device-recommendation`

**Description:** Add device recommendations for a patient (Doctor functionality)

**Lambda Function:** `{STAGE}_add_device_recommendation`

**Request Headers:**
- `Authorization`: Bearer token
- `Content-Type`: application/json

**Request Body:**
```json
{
  "patientUserId": "string (required)",
  "devices": [
    {
      "deviceId": "string (required)",
      "category": "string (required)",
      "name": "string (required)"
    }
  ],
  "doctorName": "string (required)",
  "userID": "string (optional - from authorizer)",
  "organizationID": "string (optional - from authorizer)"
}
```

**Response Structure:**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Device recommended successfully"
}
```

**Special Behavior:**
- Creates device recommendation entry
- Creates user update entry for patient
- Prevents duplicate recommendations
- Sets status to `UNPAIRED` initially

---

### 2.8 POST `/remove-device-recommendation`

**Description:** Remove a device recommendation for a patient

**Lambda Function:** `{STAGE}_remove_device_recommendation`

**Request Headers:**
- `Authorization`: Bearer token
- `Content-Type`: application/json

**Request Body:**
```json
{
  "patientUserId": "string (required)",
  "deviceId": "string (required)"
}
```

**Response Structure:**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Device un-recommended successfully"
}
```

**Special Behavior:**
- Cannot remove already paired devices
- Creates user update entry with delete status
- Deletes recommendation entry

---

## 3. Triggers & Events

### 3.1 Outgoing Triggers (Device Service → Other Services)

#### 3.1.1 Task Completion Trigger
**Trigger:** When device is successfully paired with user
**Target Lambda:** `{STAGE}_complete_user_task`
**Invocation Type:** Event (async)
**Payload:**
```json
{
  "userID": "string",
  "organizationID": "string",
  "body": {
    "taskId": "PAIR_DEVICE"
  }
}
```

**Triggered From:**
- `device-user-registration` - When non-third-party device is paired
- `vital_readings_handler` - When first vital reading is received from device

**Location in Code:**
- `vitals_sync/device_user_registration/index.js:170`
- `vitals_sync/vital_readings_handler/index.js:604-613`

---

### 3.2 Incoming Triggers (Other Services → Device Service)

#### 3.2.1 User Account Deletion
**Trigger:** When user account is deleted
**Source:** `sign_up/delete_account/delete_user_devices`
**Action:** Deletes all user devices
**Location:** `sign_up/delete_account/delete_user_devices/index.js`

#### 3.2.2 Device Registration via Vital Readings
**Trigger:** When vital readings are received from an unregistered device
**Source:** `vitals_sync/vital_readings_handler`
**Action:** Auto-registers device if not already registered
**Location:** `vitals_sync/vital_readings_handler/index.js:585-595`

#### 3.2.3 Organization Device Updates
**Trigger:** When organization is created/updated with devices
**Source:** `facility_account_organization/new_update_facility_account_organization`
**Action:** Creates/updates organization-device mappings
**Location:** `facility_account_organization/new_update_facility_account_organization/index.js:688-802`

---

## 4. Dependencies & External Services

### 4.1 External Lambda Invocations

| Lambda Function | Purpose | Invocation Type |
|----------------|---------|----------------|
| `{STAGE}_complete_user_task` | Mark device pairing task as complete | Event (async) |

### 4.2 External Dependencies

- **DynamoDB Table:** `{STAGE}_common_user_data`
- **DynamoDB Table:** `{STAGE}_common_vitals` (for device registration trigger)
- **Error Messages CDN:** CloudFront URL for error messages
- **IAM Role:** `{EnvironmentType}_lambda_roles`

---

## 5. Microservice Architecture Proposal

### 5.1 Proposed Microservice Structure

```
device_microservice/
├── src/
│   ├── handlers/
│   │   ├── device_registration.js          # Pair device with user
│   │   ├── device_deletion.js              # Delete single device
│   │   ├── device_bulk_deletion.js         # Delete multiple devices
│   │   ├── device_retrieval.js             # Get user devices
│   │   ├── device_list.js                  # Get device lists (org/patient/recommend)
│   │   ├── org_device_management.js        # Manage org devices
│   │   ├── device_recommendation.js        # Manage recommendations
│   │   └── recommendation_removal.js       # Remove recommendations
│   ├── services/
│   │   ├── device_service.js               # Core device business logic
│   │   ├── org_device_service.js           # Org device logic
│   │   ├── recommendation_service.js       # Recommendation logic
│   │   └── validation_service.js           # Input validation
│   ├── repositories/
│   │   ├── device_repository.js            # Device data access
│   │   ├── org_device_repository.js        # Org device data access
│   │   └── recommendation_repository.js    # Recommendation data access
│   ├── models/
│   │   ├── device.js                       # Device entity
│   │   ├── org_device.js                   # Org device entity
│   │   └── recommendation.js               # Recommendation entity
│   ├── utils/
│   │   ├── response_helper.js              # Response formatting
│   │   ├── error_helper.js                 # Error handling
│   │   └── constants.js                    # Constants
│   └── config/
│       └── dynamodb.js                     # DynamoDB client config
├── infrastructure/
│   ├── saml.yaml                           # SAM template
│   ├── buildspec.yml                       # CI/CD config
│   └── parameters/
│       ├── dev_parameter.json
│       ├── qa_parameter.json
│       ├── stg_parameter.json
│       └── prd_parameter.json
├── tests/
│   ├── unit/
│   └── integration/
└── README.md
```

---

### 5.2 Data Access Layer (Repository Pattern)

**Device Repository:**
- `createDeviceUserEntry(deviceData)`
- `getUserDevices(userId, filters)`
- `getDeviceByConfigId(userId, configDeviceId)`
- `updateDeviceEntry(userId, deviceId, updates)`
- `deleteDevice(userId, deviceId)`
- `bulkDeleteDevices(userId, deviceIds)`

**Organization Device Repository:**
- `addOrgDevice(orgId, device)`
- `removeOrgDevice(orgId, deviceId)`
- `updateOrgDevice(orgId, deviceId, updates)`
- `getOrgDevices(orgId, filters)`
- `getDeviceOrgs(deviceId)`

**Recommendation Repository:**
- `createRecommendation(recommendationData)`
- `getUserRecommendations(userId)`
- `getRecommendation(userId, deviceId)`
- `updateRecommendationStatus(userId, deviceId, status)`
- `deleteRecommendation(userId, deviceId)`

---

### 5.3 Service Layer

**Device Service:**
- `registerDevice(userId, organizationId, device)`
- `deleteDevice(userId, deviceId)`
- `bulkDeleteDevices(userId, deviceIds)`
- `getUserDevices(userId, filters)`
- `validateDeviceAvailability(deviceId, organizationId)`

**Organization Device Service:**
- `addDevicesToOrganization(orgId, devices)`
- `removeDevicesFromOrganization(orgId, deviceIds)`
- `updateOrgDeviceSettings(orgId, deviceId, settings)`
- `getOrganizationDevices(orgId, filters)`

**Recommendation Service:**
- `recommendDevices(doctorId, patientId, orgId, devices, doctorName)`
- `removeRecommendation(patientId, deviceId)`
- `getUserRecommendations(userId)`
- `markRecommendationAsPaired(userId, deviceId)`

---

### 5.4 Event Publishing

**Proposed Event Bus:** AWS EventBridge

**Events to Publish:**
1. **Device.Paired**
   ```json
   {
     "eventType": "Device.Paired",
     "userId": "string",
     "organizationId": "string",
     "deviceId": "string",
     "configDeviceId": "string",
     "timestamp": "number"
   }
   ```

2. **Device.Deleted**
   ```json
   {
     "eventType": "Device.Deleted",
     "userId": "string",
     "deviceId": "string",
     "configDeviceId": "string",
     "timestamp": "number"
   }
   ```

3. **Device.Recommended**
   ```json
   {
     "eventType": "Device.Recommended",
     "patientUserId": "string",
     "doctorId": "string",
     "organizationId": "string",
     "deviceId": "string",
     "timestamp": "number"
   }
   ```

4. **Organization.DeviceAdded**
   ```json
   {
     "eventType": "Organization.DeviceAdded",
     "organizationId": "string",
     "deviceId": "string",
     "addedBy": "string",
     "timestamp": "number"
   }
   ```

---

### 5.5 API Gateway Routes

```
POST   /devices/register              → device_registration
POST   /devices/delete                → device_deletion
POST   /devices/delete-multiple       → device_bulk_deletion
POST   /devices/list                  → device_retrieval
POST   /devices/search                → device_list
POST   /devices/org/add-remove        → org_device_management
POST   /devices/recommendations/add   → device_recommendation
POST   /devices/recommendations/remove → recommendation_removal
```

---

### 5.6 Environment Variables

```yaml
REGION: ${AWS::Region}
USER_TABLE: ${Stage}_common_user_data
VITALS_TABLE: ${Stage}_common_vitals (if needed for triggers)
ERROR_MESSAGES_CDN_URL: CloudFront URL
STAGE: ${Stage}
EVENT_BUS_NAME: device-events (for EventBridge)
COMPLETE_TASK_LAMBDA: ${Stage}_complete_user_task (for backward compatibility)
```

---

### 5.7 Migration Strategy

#### Phase 1: Preparation
1. Create new microservice repository
2. Set up infrastructure (SAM template, CI/CD)
3. Create data access layer (repositories)
4. Create service layer
5. Implement core device operations

#### Phase 2: Implementation
1. Implement all endpoints
2. Implement event publishing
3. Set up event consumers for backward compatibility
4. Write comprehensive tests
5. Update API Gateway routing

#### Phase 3: Migration
1. Deploy to staging environment
2. Run parallel processing (old + new service)
3. Monitor and validate results
4. Gradual traffic shift
5. Monitor error rates and performance

#### Phase 4: Cleanup
1. Remove old device-related code from monolith
2. Update all service references
3. Archive old lambda functions
4. Update documentation

---

## 6. Data Flow Diagrams

### 6.1 Device Registration Flow

```
Client
  ↓
API Gateway (/device-user-registration)
  ↓
Device Registration Handler
  ↓
Device Service
  ↓
Validation Service (validate device availability)
  ↓
Device Repository (create/update device entry)
  ↓
DynamoDB (USER_TABLE)
  ↓
EventBridge (Device.Paired event)
  ↓
Task Service (complete_user_task - for backward compatibility)
```

### 6.2 Organization Device Management Flow

```
Client (Root User)
  ↓
API Gateway (/add-remove-org-devices)
  ↓
Org Device Management Handler
  ↓
Organization Device Service
  ↓
Org Device Repository
  ↓
DynamoDB (USER_TABLE - bidirectional entries)
  ↓
EventBridge (Organization.DeviceAdded/Removed)
```

### 6.3 Device Recommendation Flow

```
Doctor Client
  ↓
API Gateway (/add-device-recommendation)
  ↓
Device Recommendation Handler
  ↓
Recommendation Service
  ↓
Recommendation Repository
  ↓
DynamoDB (USER_TABLE - RECOMMEND entries)
  ↓
EventBridge (Device.Recommended)
  ↓
Notification Service (notify patient)
```

---

## 7. Testing Strategy

### 7.1 Unit Tests
- Repository layer (mock DynamoDB)
- Service layer (mock repositories)
- Validation logic
- Utility functions

### 7.2 Integration Tests
- End-to-end API tests
- DynamoDB integration
- Event publishing
- Lambda invocations

### 7.3 Load Tests
- Device registration under load
- Bulk device operations
- Concurrent recommendations

---

## 8. Security Considerations

1. **Authorization:**
   - All endpoints require valid JWT token
   - Organization device management requires ROOT organization
   - Recommendations require doctor role

2. **Input Validation:**
   - All inputs validated using Joi schemas
   - SQL injection protection (DynamoDB handles this)
   - XSS prevention in error messages

3. **Data Privacy:**
   - User devices are user-scoped
   - Organization data is org-scoped
   - Recommendations are patient-scoped

---

## 9. Monitoring & Logging

### 9.1 CloudWatch Metrics
- Device registration count
- Device deletion count
- Recommendation count
- Error rates by endpoint
- Latency percentiles

### 9.2 CloudWatch Logs
- All API requests/responses
- All database operations
- All event publications
- Error stack traces

### 9.3 Alarms
- High error rates (>5%)
- High latency (>2s p95)
- Unusual deletion patterns
- Failed event publications

---

## 10. Appendix: File Locations

### Current Implementation Files

**Device Registration:**
- `vitals_sync/device_user_registration/index.js`
- `vitals_sync/device_user_registration/dynamodb.js`
- `vitals_sync/device_user_registration/constants.js`
- `vitals_sync/device_user_registration/input-validation.js`

**Device Deletion:**
- `vitals_sync/delete_device/index.js`
- `vitals_sync/delete_device/dynamodb.js`
- `vitals_sync/delete_multiple_devices/index.js`
- `vitals_sync/delete_multiple_devices/dynamodb.js`

**Device Retrieval:**
- `vitals_sync/retrieve_device_list/index.js`
- `vitals_sync/retrieve_device_list/dynamoDB.js`
- `vitals_sync/get_device_list/index.js`
- `vitals_sync/get_device_list/dynamodb.js`

**Organization Devices:**
- `vitals_sync/add_remove_org_devices/index.js`
- `vitals_sync/add_remove_org_devices/dynamodb.js`
- `facility_account_organization/new_update_facility_account_organization/index.js` (org device creation)

**Recommendations:**
- `vitals_sync/add_device_recommendation/index.js`
- `vitals_sync/add_device_recommendation/dynamodb.js`
- `vitals_sync/remove_device_recommendation/index.js`
- `vitals_sync/remove_device_recommendation/dynamodb.js`

**Infrastructure:**
- `vitals_sync/saml.yaml` (Lambda definitions)
- `api_gateway/saml.yaml` (API Gateway routes)
- `vitals_sync/buildspec.yml` (CI/CD)

---

## 11. Migration Checklist

- [ ] Create new microservice repository
- [ ] Set up SAM template structure
- [ ] Implement repository layer
- [ ] Implement service layer
- [ ] Implement API handlers
- [ ] Set up EventBridge event bus
- [ ] Implement event publishing
- [ ] Create API Gateway routes
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Set up CI/CD pipeline
- [ ] Deploy to staging
- [ ] Run parallel processing
- [ ] Monitor and validate
- [ ] Gradual traffic migration
- [ ] Update dependent services
- [ ] Remove old code
- [ ] Update documentation

---

**Document Version:** 1.0  
**Last Updated:** 2024  
**Author:** Senior Migration Expert
