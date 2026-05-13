# CDN Message Resolver Guide

## Overview

The `messageResolver` helper fetches localized error and success messages from CloudFront CDN based on the `Accept-Language` header, with automatic fallback to English (`en`).

## Setup

### 1. Environment Variable

Set the CDN base URL in your environment:

```bash
# Production CDN URL (configured in serverless.yml)
ERROR_MESSAGES_CDN_URL=https://d2p9v61861q1ox.cloudfront.net
```

**Note:** The base URL should NOT include `/error-messages/` or the language file name. The resolver automatically appends `/error-messages/{language}.json`.

### 2. CDN Structure

Upload JSON files to your CDN with this structure:

```
https://your-cdn.cloudfront.net/
└── error-messages/
    ├── en.json
    ├── es.json
    ├── fr.json
    ├── de.json
    └── ... (other languages)
```

### 3. Message JSON Format

Each JSON file should contain message keys with `title`, `description`, and `severity`:

```json
{
  "HEALTH_CHECK_OK": {
    "title": "Success",
    "description": "Health check ok",
    "severity": "SUCCESS"
  },
  "USER_NOT_FOUND": {
    "title": "User not found",
    "description": "The requested user could not be found",
    "severity": "ERROR"
  }
}
```

**Severity values:** `SUCCESS`, `INFO`, `WARNING`, `ERROR`

## Usage in Handlers

### Import

```typescript
import { ApiResponse, getMessage, getErrorMessage } from '@api-hub/utils';
```

### Success Messages

```typescript
export const handler = async (event: APIGatewayProxyEvent) => {
  const correlationId = extractCorrelationId(event);
  
  // Fetch localized success message
  const message = await getMessage(event: any, 'USER_CREATED_SUCCESS');
  
  return ApiResponse.ok(
    { userId: '123' },
    message,
    { requestId: correlationId }
  );
};
```

**Default if CDN unavailable or key missing:**
```json
{
  "title": "Success",
  "description": "Request processed successfully",
  "severity": "SUCCESS"
}
```

### Error Messages

```typescript
export const handler = async (event: APIGatewayProxyEvent) => {
  const correlationId = extractCorrelationId(event);
  
  try {
    // ... your logic
  } catch (err) {
    // Fetch localized error message
    const message = await getErrorMessage(event: any, 'USER_NOT_FOUND');
    
    return ApiResponse.notFound(
      message,
      { requestId: correlationId },
      { code: 'USER_NOT_FOUND' }
    );
  }
};
```

**Default if CDN unavailable or key missing:**
```json
{
  "title": "Error",
  "description": "An error occurred",
  "severity": "ERROR"
}
```

### Custom Defaults

Use `resolveMessage` directly for custom defaults:

```typescript
import { resolveMessage } from '@api-hub/utils';

const message = await resolveMessage(
  event: any,
  'CUSTOM_KEY',
  {
    title: 'Custom Title',
    description: 'Custom description',
    severity: 'WARNING'
  }
);
```

## Language Detection

The resolver extracts language from these headers (in order):
1. `Accept-Language`
2. `accept-language`
3. `language`
4. `Language`

Examples:
- `Accept-Language: en-US` → `en`
- `Accept-Language: es-ES, es;q=0.9, en;q=0.8` → `es`
- `Accept-Language: fr` → `fr`
- No header → `en` (default)

## Caching

Messages are cached in-memory by language to minimize CDN requests:
- First request fetches from CDN
- Subsequent requests use cached messages
- Cache persists for the Lambda container lifetime

### Clear Cache (Testing)

```typescript
import { clearMessageCache } from '@api-hub/utils';

clearMessageCache(); // Clears all cached messages
```

## Fallback Behavior

1. **Primary language unavailable**: Falls back to English (`en`)
2. **English unavailable**: Returns hardcoded defaults
3. **Key missing in JSON**: Returns defaults for that message type
4. **CDN error**: Logs error, returns defaults

## Example: Complete Handler

```typescript
import { APIGatewayProxyHandler } from 'aws-lambda';
import { ApiResponse, getMessage, getErrorMessage } from '@api-hub/utils';
import { extractCorrelationId } from '@api-hub/logger';

export const createUser: any = async (event) => {
  const correlationId = extractCorrelationId(event);
  
  try {
    // Your business logic
    const user = await userService.create(body);
    
    // Fetch localized success message
    const message = await getMessage(event: any, 'USER_CREATED_SUCCESS');
    
    return ApiResponse.created(
      { userId: user.id },
      message,
      { requestId: correlationId }
    );
  } catch (err) {
    if (err instanceof UserAlreadyExistsError) {
      const message = await getErrorMessage(event: any, 'USER_ALREADY_EXISTS');
      return ApiResponse.conflict(
        message,
        { requestId: correlationId },
        { code: 'USER_ALREADY_EXISTS' }
      );
    }
    
    const message = await getErrorMessage(event: any, 'INTERNAL_ERROR');
    return ApiResponse.internalServerError(
      message,
      { requestId: correlationId },
      { code: 'CREATE_USER_FAILED' }
    );
  }
};
```

## Message Key Naming Convention

Recommended naming pattern:
- **Success**: `{ENTITY}_{ACTION}_SUCCESS` (e.g., `USER_CREATED_SUCCESS`)
- **Error**: `{ENTITY}_{ERROR_TYPE}` (e.g., `USER_NOT_FOUND`, `ORGANIZATION_VALIDATION_ERROR`)
- **General**: `{ACTION}_{STATUS}` (e.g., `HEALTH_CHECK_OK`)

## Testing

### Local Development

Create a `.env` file:

```bash
ERROR_MESSAGES_CDN_URL=http://localhost:3000/messages
```

Mock CDN server example:

```javascript
const express = require('express');
const app = express();

app.get('/messages/error-messages/:lang.json', (req, res) => {
  const lang = req.params.lang;
  const messages = require(`./messages/${lang}.json`);
  res.json(messages);
});

app.listen(3000);
```

### Unit Tests

```typescript
import { getMessage, clearMessageCache } from '@api-hub/utils';

beforeEach(() => {
  clearMessageCache();
  process.env.ERROR_MESSAGES_CDN_URL = 'https://test-cdn.com';
});

it('should fetch English message by default', async () => {
  const event = { headers: {} } as any;
  const message = await getMessage(event: any, 'HEALTH_CHECK_OK');
  
  expect(message.title).toBe('Success');
  expect(message.severity).toBe('SUCCESS');
});
```

## Performance Considerations

- **First request per language**: ~50-200ms (CDN fetch)
- **Cached requests**: <1ms (in-memory)
- **Lambda cold start**: Cache is empty, will fetch on first use
- **Lambda warm**: Cache persists across invocations

## Error Handling

All errors are caught and logged. The resolver **never throws** — it always returns a valid message object with defaults if anything fails.

## Security

- CDN URL is validated (must be set)
- Language code is validated (2-3 letter codes only)
- JSON parsing errors are caught
- HTTPS is enforced for CDN requests
