 

## Role
You are a **Senior Backend AWS Serverless Architect** with expertise in:
- AWS Lambda, API Gateway, DynamoDB, EventBridge
- TypeScript, Node.js, Serverless Framework
- Nx monorepo architecture
- Microservices design patterns
- Production-grade code quality and best practices

## Context

You are implementing a **Device Management Microservice** as part of a migration from a monolithic architecture. The microservice will handle all device-related operations including device registration, deletion, organization-device mappings, and device recommendations.

## Reference Documentation

**Primary Reference:** `docs/services/device-service/DEVICE_MICROSERVICE_MIGRATION_DOCUMENT.md`

This document contains:
- Complete database schema and table mappings
- All API endpoints with request/response structures
- Event triggers and dependencies
- Migration strategy and architecture proposal

## Project Structure Requirements

### Nx Monorepo Structure

The project follows an **Nx monorepo** structure. Your implementation must:

1. **Service Location:** `apps/device-service/`
2. **Follow existing service patterns** from:
   - `apps/user-service/` (reference implementation)
   - `apps/organization-service/` (reference implementation)

3. **Directory Structure:**
```
apps/device-service/
├── src/
│   ├── handlers/          # Lambda handlers (one per endpoint)
│   ├── services/          # Business logic layer
│   ├── repositories/     # Data access layer (DynamoDB)
│   ├── models/           # TypeScript models/interfaces
│   ├── validation/       # Zod validation schemas
│   ├── events/           # EventBridge event publishers
│   ├── utils/            # Utility functions and error classes
│   └── index.ts          # Entry point
├── serverless.yml        # Serverless Framework configuration
├── tsconfig.json
├── tsconfig.app.json
├── project.json          # Nx project configuration
└── package.json
```

## Required Libraries (Use Existing)

**MANDATORY:** Use these existing libraries from `libs/`:

### 1. `@api-hub/utils`
**Location:** `libs/utils/`
**Usage:**
```typescript
import { 
  ApiResponse,           // Unified API response handler
  ddbClient,            // DynamoDB client
  ddbDocClient,         // DynamoDB DocumentClient
  extractCorrelationId, // Extract correlation ID from event
  // ... other utilities
} from '@api-hub/utils';
```

**Key Features:**
- `ApiResponse.ok()`, `ApiResponse.created()`, `ApiResponse.badRequest()`, etc.
- CDN-based message resolution (pass message keys like `'DEVICE.DEVICE_PAIRED_SUCCESS'`)
- Automatic CORS headers
- Standard response structure

**Example:**
```typescript
return ApiResponse.created(
  { deviceId: result.deviceId },
  'DEVICE.DEVICE_PAIRED_SUCCESS',
  {  correlationId: correlationId, event }
);
```

### 2. `@api-hub/logger`
**Location:** `libs/logger/`
**Usage:**
```typescript
import { 
  createLogger,
  createChildLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError,
  logHttpRequest,
} from '@api-hub/logger';
```

**Pattern:**
```typescript
const baseLogger = createLogger({ service: 'device-service', redactPII: true });

// In handler:
const correlationId = extractCorrelationId(event);
const awsRequestId = context ? extractAwsRequestId(context) : undefined;
const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });

// Log requests:
logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices', statusCode, duration, correlationId);
```

### 3. `@api-hub/error-messages`
**Location:** `libs/error-messages/`
**Usage:** (Optional - ApiResponse handles this via CDN, but you can use for error constants)

## Code Patterns (Follow Existing Services)

### Handler Pattern

**Reference:** `apps/user-service/src/handlers/httpHandler.ts`

```typescript
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { DeviceService } from '../services/device.service';
import { deviceRegistrationSchema } from '../validation/device.validation';
import { DeviceNotFoundError } from '../utils/errors';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceService = new DeviceService();

export const main: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceRegistration_received' });

  // Parse body
  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'deviceRegistration_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/register', 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      {  correlationId: correlationId, event },
      { code: 'BAD_REQUEST' },
    );
  }

  // Extract user context from authorizer
  const authorizer = (event.requestContext as any)?.authorizer;
  const userId = authorizer?.userID || authorizer?.userId || (event as any).userID;
  const organizationId = authorizer?.organizationID || authorizer?.organizationId || (event as any).organizationID;

  // Validation
  const validation = deviceRegistrationSchema.safeParse({ ...body, userId, organizationId });
  if (!validation.success) {
    logger.warn({ event: 'deviceRegistration_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/register', 400, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      {  correlationId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    );
  }

  try {
    const result = await deviceService.registerDevice(validation.data, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/register', 201, duration, correlationId);
    return ApiResponse.created(
      { deviceId: result.deviceId, configDeviceId: result.configDeviceId },
      'DEVICE.DEVICE_PAIRED_SUCCESS',
      {  correlationId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof DeviceNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/register', 404, duration, correlationId);
      return ApiResponse.notFound(
        'DEVICE.DEVICE_NOT_FOUND',
        {  correlationId: correlationId, event },
        { code: 'DEVICE_NOT_FOUND' },
      );
    }
    logger.error({ event: 'deviceRegistration_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/register', 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'DEVICE.REGISTRATION_FAILED',
      {  correlationId: correlationId, event },
      { code: 'REGISTRATION_FAILED' },
    );
  }
};
```

### Service Layer Pattern

**Reference:** `apps/user-service/src/services/user.service.ts`

```typescript
import { DeviceRepository } from '../repositories/device.repository';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { Device, DeviceRegistrationData } from '../models';
import { DeviceNotFoundError, DeviceAlreadyPairedError } from '../utils/errors';
import { publishEvent } from '../events/event.publisher';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });

export class DeviceService {
  private repository: DeviceRepository;

  constructor() {
    this.repository = new DeviceRepository();
  }

  async registerDevice(
    data: DeviceRegistrationData,
    correlationId?: string,
  ): Promise<{ deviceId: string; configDeviceId: string }> {
    const logger = createChildLogger(baseLogger, { correlationId, userId: data.userId });
    logger.info({ event: 'service_registerDevice_start', configDeviceId: data.configDeviceId });

    try {
      // Business logic here
      const device = await this.repository.createDeviceUserEntry(data);
      
      // Publish event
      await publishEvent({
        eventType: 'Device.Paired',
        userId: data.userId,
        organizationId: data.organizationId,
        deviceId: device.deviceId,
        configDeviceId: data.configDeviceId,
        timestamp: Date.now(),
      });

      return { deviceId: device.deviceId, configDeviceId: data.configDeviceId };
    } catch (err) {
      logger.error({ event: 'service_registerDevice_error', err: serializeError(err) });
      throw err;
    }
  }
}
```

### Repository Pattern

**Reference:** `apps/user-service/src/repositories/organization.repository.ts` (for external API calls)
**Pattern for DynamoDB:** Use `ddbDocClient` from `@api-hub/utils`

```typescript
import { ddbDocClient } from '@api-hub/utils';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Device, DeviceUserEntry } from '../models';
import { createLogger } from '@api-hub/logger';

const logger = createLogger({ service: 'device-repository' });

export class DeviceRepository {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    this.docClient = ddbDocClient;
    this.tableName = process.env.USER_TABLE || '';
  }

  async createDeviceUserEntry(data: DeviceRegistrationData): Promise<DeviceUserEntry> {
    const deviceId = this.generateDeviceId(data.userId, data.configDeviceId);
    const now = Date.now();

    const item: DeviceUserEntry = {
      pk: `DEVICE_LIST#${data.userId}`,
      sk: `DETAILS#${data.configDeviceId}`,
      sk1: `DEVICE#${data.deviceCategory}`,
      sk2: `STATUS#ACTIVE`,
      userId: data.userId,
      deviceId,
      configDeviceId: data.configDeviceId,
      // ... all other fields from migration document
      createdDate: now,
      modifiedDate: now,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );

    return item;
  }

  private generateDeviceId(userId: string, configDeviceId: string): string {
    // SHA256 hash of userId-configDeviceId (as per migration doc)
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(`${userId}-${configDeviceId}`).digest('hex');
  }
}
```

### Validation Pattern

**Reference:** `apps/user-service/src/validation/user.validation.ts`

Use **Zod** for validation:

```typescript
import { z } from 'zod';

export const deviceRegistrationSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  devices: z.array(
    z.object({
      configDeviceId: z.string().min(1),
      displayName: z.string().min(1),
      deviceCategory: z.string().min(1),
      // ... all required fields from migration doc
      macAddress: z.string().optional(),
      // ... all optional fields
    })
  ).min(1),
});
```

### Error Classes Pattern

**Reference:** `apps/user-service/src/utils/errors.ts`

```typescript
export class DeviceNotFoundError extends Error {
  constructor(deviceId: string) {
    super(`Device not found: ${deviceId}`);
    this.name = 'DeviceNotFoundError';
  }
}

export class DeviceAlreadyPairedError extends Error {
  constructor(deviceId: string) {
    super(`Device already paired: ${deviceId}`);
    this.name = 'DeviceAlreadyPairedError';
  }
}
```

### Event Publishing Pattern

**Reference:** `apps/user-service/src/events/event.publisher.ts`

```typescript
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createLogger } from '@api-hub/logger';

const logger = createLogger({ service: 'event-publisher' });
const eventBridge = new EventBridgeClient({ region: process.env.REGION || 'us-east-1' });

export async function publishEvent(event: {
  eventType: string;
  [key: string]: any;
}): Promise<void> {
  const eventBusName = process.env.EVENT_BUS || 'device-service-bus-dev';

  try {
    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'device-service',
            DetailType: event.eventType,
            Detail: JSON.stringify(event),
            EventBusName: eventBusName,
          },
        ],
      })
    );
    logger.info({ event: 'event_published', eventType: event.eventType });
  } catch (err) {
    logger.error({ event: 'event_publish_failed', err, eventType: event.eventType });
    // Don't throw - event publishing failures shouldn't break the main flow
  }
}
```

## Serverless Configuration

**Reference:** `apps/user-service/serverless.yml` and `apps/organization-service/serverless.yml`

### Key Requirements:

1. **Service name:** `device-service`
2. **Runtime:** `nodejs22.x`
3. **Region:** `us-east-1`
4. **Stage:** `${opt:stage, 'dev'}`
5. **Environment variables:**
   - `USER_TABLE`: `${self:provider.stage}_common_user_data` (DynamoDB table)
   - `EVENT_BUS`: `device-service-bus-${self:provider.stage}`
   - `ERROR_MESSAGES_CDN_URL`: `https://d2p9v61861q1ox.cloudfront.net`
   - `REGION`: `${self:provider.region}`
   - `LOG_LEVEL`: Stage-based log levels

6. **IAM Permissions:**
   - DynamoDB: GetItem, PutItem, UpdateItem, DeleteItem, Query, BatchGetItem, BatchWriteItem
   - EventBridge: PutEvents
   - Lambda: Invoke (for backward compatibility with `complete_user_task`)

7. **Plugins:**
   - `serverless-esbuild`
   - `serverless-dotenv-plugin`
   - `serverless-auto-swagger`
   - `serverless-offline`

8. **Functions:** One Lambda per endpoint (see migration document Section 2)

## API Endpoints to Implement

Based on the migration document, implement these endpoints:

1. **POST `/devices/register`** - Device user registration (Section 2.1)
2. **POST `/devices/delete`** - Delete single device (Section 2.2)
3. **POST `/devices/delete-multiple`** - Delete multiple devices (Section 2.3)
4. **POST `/devices/list`** - Retrieve device list (Section 2.4)
5. **POST `/devices/search`** - Get device list (org/patient/recommend) (Section 2.5)
6. **POST `/devices/org/manage`** - Add/remove/update org devices (Section 2.6)
7. **POST `/devices/recommendations/add`** - Add device recommendation (Section 2.7)
8. **POST `/devices/recommendations/remove`** - Remove device recommendation (Section 2.8)

## Database Schema (DynamoDB)

**Table:** `{STAGE}_common_user_data`

### Key Patterns (from migration document):

1. **User-Device Entry:**
   - `pk`: `DEVICE_LIST#${userId}`
   - `sk`: `DETAILS#${configDeviceId}`
   - `sk1`: `DEVICE#${deviceCategory}`
   - `sk2`: `STATUS#ACTIVE` (or `STATUS#INACTIVE`)

2. **Organization-Device Mapping (Forward):**
   - `pk`: `ORG_DEVICES#${organizationId}`
   - `sk`: `${deviceId.toUpperCase().split(' ').join('_')}`

3. **Organization-Device Mapping (Reverse):**
   - `pk`: `ORG_DEVICES#${deviceId.toUpperCase().split(' ').join('_')}`
   - `sk`: `${organizationId}`

4. **Device Recommendation:**
   - `pk`: `RECOMMEND`
   - `sk`: `${deviceId.toUpperCase().split(' ').join('_')}#${patientUserId}`
   - `sk1`: `${patientUserId}`
   - `sk2`: `${doctorId}`
   - `sk3`: `${organizationId}`

5. **Global Device List:**
   - `pk`: `DEVICE_LIST`
   - `sk`: `CATEGORY#${category}#${deviceId}`
   - `sk3`: `${deviceId.toUpperCase().split(' ').join('_')}`
   - `sk4`: `${category.toUpperCase()}`

**IMPORTANT:** Follow the exact key structures from the migration document Section 1.

## Event Publishing

Publish events to EventBridge (see migration document Section 5.4):

1. **Device.Paired** - When device is successfully paired
2. **Device.Deleted** - When device is deleted
3. **Device.Recommended** - When device is recommended
4. **Organization.DeviceAdded** - When device is added to organization

**Event Structure:**
```typescript
{
  eventType: string;
  userId?: string;
  organizationId?: string;
  deviceId: string;
  configDeviceId?: string;
  patientUserId?: string;
  doctorId?: string;
  timestamp: number;
}
```

## Message Keys Convention

Follow the pattern: `MODULE.MESSAGE_CODE`

**Examples for Device Service:**
- `DEVICE.DEVICE_PAIRED_SUCCESS`
- `DEVICE.DEVICE_DELETED_SUCCESS`
- `DEVICE.DEVICE_NOT_FOUND`
- `DEVICE.DEVICE_ALREADY_PAIRED`
- `DEVICE.RECOMMENDATION_ADDED_SUCCESS`
- `DEVICE.ORGANIZATION_DEVICE_ADDED_SUCCESS`

Use `COMMON.*` for shared errors (validation, unauthorized, etc.)

## Special Business Logic

### Third-Party Apps
Allow these without organization validation:
- `GOOGLEFIT`, `APPLEHEALTH`, `FITBIT`, `GARMIN`, `MANUAL`

### Task Completion
For backward compatibility, invoke `{STAGE}_complete_user_task` Lambda with:
```json
{
  "userID": "string",
  "organizationID": "string",
  "body": {
    "taskId": "PAIR_DEVICE"
  }
}
```

Only for non-third-party devices.

### Device ID Generation
Generate deviceId as SHA256 hash of `${userId}-${configDeviceId}`

## Testing Requirements

1. **Unit Tests:**
   - Repository layer (mock DynamoDB)
   - Service layer (mock repositories)
   - Validation schemas
   - Utility functions

2. **Integration Tests:**
   - End-to-end API tests
   - DynamoDB integration
   - Event publishing

3. **Test Location:** `apps/device-service/src/**/__tests__/`

## Code Quality Standards

1. **TypeScript:** Strict mode enabled
2. **Error Handling:** Always use try-catch, log errors, return appropriate HTTP status codes
3. **Logging:** Log all operations with structured logging
4. **Validation:** Validate all inputs using Zod schemas
5. **Security:** Never log PII (use `redactPII: true` in logger)
6. **Performance:** Use connection pooling, batch operations where possible
7. **Documentation:** JSDoc comments for public methods

## Implementation Checklist

- [ ] Create `apps/device-service/` directory structure
- [ ] Set up `serverless.yml` with all functions
- [ ] Implement all 8 API endpoints
- [ ] Create repository layer for DynamoDB operations
- [ ] Create service layer with business logic
- [ ] Implement validation schemas
- [ ] Create error classes
- [ ] Implement event publishing
- [ ] Add logging throughout
- [ ] Use `ApiResponse` for all responses
- [ ] Use message keys from CDN
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Update `tsconfig.json` and `project.json`
- [ ] Add to Nx workspace

## Deliverables

Generate production-ready code that:

1. ✅ Follows Nx monorepo structure
2. ✅ Uses existing libraries (`@api-hub/utils`, `@api-hub/logger`)
3. ✅ Matches patterns from `user-service` and `organization-service`
4. ✅ Implements all endpoints from migration document
5. ✅ Follows DynamoDB schema exactly
6. ✅ Publishes events to EventBridge
7. ✅ Includes proper error handling and logging
8. ✅ Uses Zod validation
9. ✅ Returns unified API responses
10. ✅ Is production-ready (no TODOs, proper error handling, logging)

## Start Implementation

Begin by creating the complete service structure, starting with:
1. Directory structure
2. `serverless.yml` configuration
3. Models/interfaces
4. Repository layer
5. Service layer
6. Handlers
7. Validation schemas
8. Error classes
9. Event publisher

Generate all code files with complete implementations following the patterns and requirements above.
