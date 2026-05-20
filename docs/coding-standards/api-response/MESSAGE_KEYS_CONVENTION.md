# Message Keys Naming Convention

## Format

All message keys follow the pattern:

```
MODULE.MESSAGE_CODE
```

Where:
- **MODULE**: Service/module name in UPPERCASE (e.g., `USER`, `ORDER`, `REWARDS`, `COMMON`)
- **MESSAGE_CODE**: Specific message identifier in UPPERCASE_SNAKE_CASE

## Examples

```json
{
  "HEALTH.HEALTH_CHECK_OK": { ... },
  "USER.USER_CREATED_SUCCESS": { ... },
  "USER.USER_NOT_FOUND": { ... },
  "ORGANIZATION.ORGANIZATION_ALREADY_EXISTS": { ... },
  "ORDER.ORDER_CREATED_SUCCESS": { ... },
  "REWARDS.REWARD_ALREADY_REDEEMED": { ... },
  "COMMON.VALIDATION_ERROR": { ... },
  "COMMON.BAD_REQUEST": { ... }
}
```

## Module Categories

### Service-Specific Modules

Each service/entity gets its own module:

- **`HEALTH.*`** - Health check messages
- **`USER.*`** - User-related messages
- **`ORGANIZATION.*`** - Organization-related messages
- **`ORDER.*`** - Order-related messages
- **`REWARDS.*`** - Rewards system messages
- **`PAYMENT.*`** - Payment processing messages
- **`NOTIFICATION.*`** - Notification messages
- **`DEVICE.*`** - Device management messages
- **`FHIR.*`** - FHIR gateway messages

### Common Module

Use `COMMON.*` for messages shared across services:

- **`COMMON.VALIDATION_ERROR`** - Generic validation errors
- **`COMMON.BAD_REQUEST`** - Invalid request format
- **`COMMON.INVALID_JSON`** - JSON parsing errors
- **`COMMON.UNAUTHORIZED`** - Authentication errors
- **`COMMON.FORBIDDEN`** - Authorization errors
- **`COMMON.INTERNAL_ERROR`** - Generic server errors
- **`COMMON.RATE_LIMIT_EXCEEDED`** - Rate limiting

## Message Code Patterns

### Success Messages

Pattern: `{MODULE}.{ENTITY}_{ACTION}_SUCCESS`

```
USER.USER_CREATED_SUCCESS
USER.USER_UPDATED_SUCCESS
USER.USER_DELETED_SUCCESS
ORDER.ORDER_PLACED_SUCCESS
PAYMENT.PAYMENT_PROCESSED_SUCCESS
```

### Error Messages - Not Found

Pattern: `{MODULE}.{ENTITY}_NOT_FOUND`

```
USER.USER_NOT_FOUND
ORDER.ORDER_NOT_FOUND
ORGANIZATION.ORGANIZATION_NOT_FOUND
DEVICE.DEVICE_NOT_FOUND
```

### Error Messages - Already Exists

Pattern: `{MODULE}.{ENTITY}_ALREADY_EXISTS`

```
USER.USER_ALREADY_EXISTS
ORDER.ORDER_ALREADY_EXISTS
ORGANIZATION.ORGANIZATION_ALREADY_EXISTS
```

### Error Messages - Validation

Pattern: `{MODULE}.{ENTITY}_{FIELD}_INVALID` or `{MODULE}.{ERROR_TYPE}`

```
USER.EMAIL_INVALID
USER.PHONE_INVALID
ORDER.QUANTITY_INVALID
COMMON.VALIDATION_ERROR
```

### Info/Warning Messages

Pattern: `{MODULE}.{DESCRIPTIVE_NAME}`

```
REWARDS.REWARD_ALREADY_REDEEMED
PAYMENT.PAYMENT_PENDING
ORDER.ORDER_PROCESSING
NOTIFICATION.EMAIL_SENT
```

## Usage in Code

### Success Response

```typescript
// User service
return ApiResponse.created(
  { userId: newUser.id },
  'USER.USER_CREATED_SUCCESS',
  {  correlationId: correlationId, event }
);

// Order service
return ApiResponse.ok(
  order,
  'ORDER.ORDER_PLACED_SUCCESS',
  {  correlationId: correlationId, event }
);
```

### Error Response

```typescript
// User not found
return ApiResponse.notFound(
  'USER.USER_NOT_FOUND',
  {  correlationId: correlationId, event },
  { code: 'USER_NOT_FOUND' }
);

// Validation error (common)
return ApiResponse.unprocessableEntity(
  'COMMON.VALIDATION_ERROR',
  {  correlationId: correlationId, event },
  { code: 'VALIDATION_ERROR', details: errors }
);

// Reward already redeemed (info severity)
return ApiResponse.conflict(
  'REWARDS.REWARD_ALREADY_REDEEMED',
  {  correlationId: correlationId, event },
  { code: 'REWARD_ALREADY_REDEEMED' }
);
```

## CDN JSON Structure

Example `en.json`:

```json
{
  "HEALTH.HEALTH_CHECK_OK": {
    "title": "Success",
    "description": "Health check ok",
    "severity": "SUCCESS"
  },
  "USER.USER_CREATED_SUCCESS": {
    "title": "Success",
    "description": "User created successfully",
    "severity": "SUCCESS"
  },
  "USER.USER_NOT_FOUND": {
    "title": "User not found",
    "description": "The requested user could not be found",
    "severity": "ERROR"
  },
  "REWARDS.REWARD_ALREADY_REDEEMED": {
    "title": "Reward already redeemed",
    "description": "This reward has already been redeemed. Please check your redemption history.",
    "severity": "INFO"
  },
  "COMMON.VALIDATION_ERROR": {
    "title": "Validation failed",
    "description": "Invalid request data",
    "severity": "ERROR"
  }
}
```

## Benefits of Namespacing

1. **Organization**: Easy to find messages by service
2. **Scalability**: Add new modules without conflicts
3. **Clarity**: Clear ownership of messages
4. **Maintenance**: Update service messages independently
5. **Reusability**: `COMMON.*` messages shared across services

## Migration from Old Format

**Before:**
```json
{
  "HEALTH_CHECK_OK": { ... },
  "USER_CREATED_SUCCESS": { ... },
  "USER_NOT_FOUND": { ... }
}
```

**After:**
```json
{
  "HEALTH.HEALTH_CHECK_OK": { ... },
  "USER.USER_CREATED_SUCCESS": { ... },
  "USER.USER_NOT_FOUND": { ... }
}
```

**In Code:**
```typescript
// Before
'USER_CREATED_SUCCESS'

// After
'USER.USER_CREATED_SUCCESS'
```

## Complete Module Reference

### Core Services
- `USER.*` - User management
- `ORGANIZATION.*` - Organization management
- `ORDER.*` - Order processing
- `PAYMENT.*` - Payment processing
- `DEVICE.*` - Device management

### Features
- `REWARDS.*` - Rewards and loyalty
- `NOTIFICATION.*` - Notifications
- `FHIR.*` - FHIR gateway
- `APPOINTMENT.*` - Appointments
- `PRESCRIPTION.*` - Prescriptions

### System
- `HEALTH.*` - Health checks
- `COMMON.*` - Shared messages
- `AUTH.*` - Authentication/authorization

## Best Practices

1. **Use module matching service name**
   ```typescript
   // In user-service
   'USER.USER_CREATED_SUCCESS' ✅
   ```

2. **Use COMMON for shared errors**
   ```typescript
   'COMMON.VALIDATION_ERROR' ✅
   'COMMON.UNAUTHORIZED' ✅
   ```

3. **Keep module names short and clear**
   ```typescript
   'ORG.*' ❌ (too short)
   'ORGANIZATION.*' ✅
   ```

4. **Be consistent with naming**
   ```typescript
   'USER.USER_NOT_FOUND' ✅
   'USER.NOT_FOUND' ❌ (missing entity)
   ```

5. **Document module ownership**
   - Each service owns its module namespace
   - `COMMON.*` owned by shared utilities team
