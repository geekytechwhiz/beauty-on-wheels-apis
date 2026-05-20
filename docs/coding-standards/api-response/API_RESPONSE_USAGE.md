# ApiResponse Usage Guide

## Overview

`ApiResponse` provides a unified response structure with **built-in CDN message resolution**. You can pass either:
1. **A message object** directly (for custom/dynamic messages)
2. **A message key string** (fetches localized message from CDN)

## Quick Start

### ✅ New Way (Recommended): Pass Message Key

```typescript
import { ApiResponse } from '@api-hub/utils';

export const handler = async (event: APIGatewayProxyEvent) => {
  const correlationId = extractCorrelationId(event);
  
  // Just pass the message key - ApiResponse handles CDN fetch internally
  return ApiResponse.ok(
    { userId: '123' },
    'USER.USER_CREATED_SUCCESS',  // ← Namespaced message key (fetches from CDN)
    {  correlationId: correlationId, event }  // ← Include event for language detection
  );
};
```

### ⚙️ Old Way (Still Supported): Pass Message Object

```typescript
return ApiResponse.ok(
  { userId: '123' },
  { title: 'Success', description: 'User created successfully' },  // ← Direct message
  { requestId: correlationId }  // ← No event needed
);
```

## Success Responses

### 200 OK

```typescript
// With message key (fetches from CDN)
return ApiResponse.ok(
  data,
  'USER.OPERATION_SUCCESS',  // Format: MODULE.MESSAGE_CODE
  {  correlationId: correlationId, event }
);

// With direct message
return ApiResponse.ok(
  data,
  { title: 'Success', description: 'Operation completed' },
  { requestId: correlationId }
);
```

### 201 Created

```typescript
return ApiResponse.created(
  { userId: newUser.id },
  'USER.USER_CREATED_SUCCESS',
  {  correlationId: correlationId, event }
);
```

### 202 Accepted

```typescript
return ApiResponse.accepted(
  { jobId: '456' },
  'COMMON.JOB_ACCEPTED',
  {  correlationId: correlationId, event }
);
```

## Error Responses

### 400 Bad Request

```typescript
// With message key (automatically uses getErrorMessage)
return ApiResponse.badRequest(
  'COMMON.BAD_REQUEST',
  {  correlationId: correlationId, event },
  { code: 'BAD_REQUEST', details: [{ message: 'Invalid input' }] }
);

// With direct message
return ApiResponse.badRequest(
  { title: 'Invalid request', description: 'Missing required field' },
  { requestId: correlationId },
  { code: 'BAD_REQUEST' }
);
```

### 401 Unauthorized

```typescript
return ApiResponse.unauthorized(
  'COMMON.UNAUTHORIZED',
  {  correlationId: correlationId, event },
  { code: 'UNAUTHORIZED' }
);
```

### 403 Forbidden

```typescript
return ApiResponse.forbidden(
  'COMMON.FORBIDDEN',
  {  correlationId: correlationId, event },
  { code: 'FORBIDDEN' }
);
```

### 404 Not Found

```typescript
return ApiResponse.notFound(
  'USER.USER_NOT_FOUND',
  {  correlationId: correlationId, event },
  { code: 'USER_NOT_FOUND' }
);
```

### 409 Conflict

```typescript
return ApiResponse.conflict(
  'USER.USER_ALREADY_EXISTS',
  {  correlationId: correlationId, event },
  { code: 'USER_ALREADY_EXISTS' }
);
```

### 422 Unprocessable Entity

```typescript
return ApiResponse.unprocessableEntity(
  'COMMON.VALIDATION_ERROR',
  {  correlationId: correlationId, event },
  {
    code: 'VALIDATION_ERROR',
    details: validation.error.issues.map(e => ({
      field: e.path.join('.'),
      message: e.message,
    })),
  }
);
```

### 500 Internal Server Error

```typescript
return ApiResponse.internalServerError(
  'COMMON.INTERNAL_ERROR',
  {  correlationId: correlationId, event },
  { code: 'INTERNAL_ERROR' }
);
```

## Complete Handler Example

```typescript
import { APIGatewayProxyHandler } from 'aws-lambda';
import { ApiResponse } from '@api-hub/utils';
import { extractCorrelationId, createLogger } from '@api-hub/logger';
import { UserService } from '../services/user.service';
import { UserNotFoundError, UserAlreadyExistsError } from '../utils/errors';

const userService = new UserService();

export const createUser: any = async (event) => {
  const correlationId = extractCorrelationId(event);
  
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    // Message key with event = CDN-based localized message
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      {  correlationId: correlationId, event },
      { code: 'BAD_REQUEST' }
    );
  }
  
  try {
    const user = await userService.createUser(body);
    
    // Success with CDN message (namespaced by module)
    return ApiResponse.created(
      { userId: user.id },
      'USER.USER_CREATED_SUCCESS',
      {  correlationId: correlationId, event }
    );
  } catch (err) {
    if (err instanceof UserAlreadyExistsError) {
      return ApiResponse.conflict(
        'USER.USER_ALREADY_EXISTS',
        {  correlationId: correlationId, event },
        { code: 'USER_ALREADY_EXISTS' }
      );
    }
    
    if (err instanceof UserNotFoundError) {
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        {  correlationId: correlationId, event },
        { code: 'USER_NOT_FOUND' }
      );
    }
    
    // Generic error with CDN message (use COMMON for shared errors)
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      {  correlationId: correlationId, event },
      { code: 'CREATE_USER_FAILED' }
    );
  }
};
```

## When to Use Message Keys vs Objects

### Use Message Keys (String) When:
✅ You want localized messages (multi-language support)  
✅ Messages are standardized across the app  
✅ Message content is managed by non-developers (content team)  
✅ You want centralized message management (CDN)

**Requires:** Include `event` in options

```typescript
return ApiResponse.ok(data, 'SUCCESS_KEY', { requestId, event });
```

### Use Message Objects When:
✅ Message is dynamic/computed at runtime  
✅ Message contains user-specific data  
✅ Quick prototyping without CDN setup  
✅ Custom one-off messages

**No event needed:**

```typescript
return ApiResponse.ok(
  data,
  { title: 'Welcome', description: `Hello ${user.name}!` },
  { requestId }
);
```

## Response Structure

Both patterns produce the same output structure:

```json
{
  "success": true,
  "statusCode": 200,
  "message": {
    "title": "Success",
    "description": "User created successfully",
    "severity": "SUCCESS"
  },
  "data": {
    "userId": "123"
  },
  "error": null,
  "meta": {
    "requestId": "req-abc-123",
    "timestamp": "2026-01-19T10:30:00.000Z",
    "version": "v1"
  }
}
```

## Language Detection

When you pass a message key + event: any, the system:

1. Extracts language from `Accept-Language` header
2. Fetches `${CDN_URL}/error-messages/${language}.json`
3. Returns localized message or falls back to English

**Example:**
- Request: `Accept-Language: es-ES`
- Fetches: `${CDN_URL}/error-messages/es.json`
- Returns: Spanish message

See [MESSAGE_RESOLVER_GUIDE.md](./MESSAGE_RESOLVER_GUIDE.md) for full CDN setup.

## Benefits of New API

### Before (Manual CDN fetch):
```typescript
const message = await getMessage(event: any, 'HEALTH_CHECK_OK');
return ApiResponse.ok(data, message, { requestId: correlationId });
```

### After (Automatic CDN fetch):
```typescript
return ApiResponse.ok(data, 'HEALTH_CHECK_OK', {  correlationId: correlationId, event });
```

**Advantages:**
- ✨ Cleaner, more concise code
- 🎯 One-line response with localization
- 🔄 Consistent pattern across all endpoints
- 🚀 Still supports direct messages when needed

## Migration Guide

### Step 1: Add event to options

**Old:**
```typescript
return ApiResponse.ok(data, message, { requestId });
```

**New:**
```typescript
return ApiResponse.ok(data, message, { requestId, event });
```

### Step 2: Replace manual getMessage calls

**Old:**
```typescript
const message = await getMessage(event: any, 'SUCCESS_KEY');
return ApiResponse.ok(data, message, { requestId });
```

**New:**
```typescript
return ApiResponse.ok(data, 'SUCCESS_KEY', { requestId, event });
```

### Step 3: Update all response calls

All `ApiResponse` methods are now `async`, so ensure handlers use `await`:

```typescript
return await ApiResponse.ok(...);  // ✅ Good
return ApiResponse.ok(...);         // ✅ Also works (returns Promise)
```

## Type Safety

TypeScript will enforce correct usage:

```typescript
// ✅ Valid: Message object
ApiResponse.ok(data, { title: 'Hi', description: 'Done' }, { requestId });

// ✅ Valid: Message key + event
ApiResponse.ok(data, 'KEY', { requestId, event });

// ❌ Invalid: Message key without event
ApiResponse.ok(data, 'KEY', { requestId });  
// Warning: "Message key provided but no event in options. Using defaults."
```

## Best Practices

1. **Always pass event when using message keys**
   ```typescript
   {  correlationId: correlationId, event }  // ✅
   ```

2. **Use namespaced message keys for standard responses**
   ```typescript
   return ApiResponse.ok(data, 'USER.USER_CREATED_SUCCESS', { requestId, event });
   ```

3. **Use message objects for dynamic content**
   ```typescript
   return ApiResponse.ok(data, {
     title: 'Welcome',
     description: `${count} items processed`
   }, { requestId });
   ```

4. **Include error details for validation errors**
   ```typescript
   return ApiResponse.unprocessableEntity('COMMON.VALIDATION_ERROR', { requestId, event }, {
     code: 'VALIDATION_ERROR',
     details: errors.map(e => ({ field: e.path, message: e.message }))
   });
   ```

5. **Follow the namespaced message key convention**
   - Format: `MODULE.MESSAGE_CODE`
   - Use SCREAMING_SNAKE_CASE for both parts
   - Pattern: `{MODULE}.{ENTITY}_{ACTION}_{STATUS}`
   - Examples: 
     - `USER.USER_CREATED_SUCCESS`
     - `ORDER.ORDER_NOT_FOUND`
     - `COMMON.VALIDATION_ERROR`
     - `REWARDS.REWARD_ALREADY_REDEEMED`
   
   See [MESSAGE_KEYS_CONVENTION.md](./MESSAGE_KEYS_CONVENTION.md) for complete guidelines
