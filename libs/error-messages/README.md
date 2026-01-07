# @api-hub/error-messages

A production-ready error messages library with multi-language support for API Gateway Lambda functions.

## Features

- 🌍 **Multi-language support** - Automatically extracts language from request headers
- 🚀 **CDN-based error definitions** - Fetch error messages from CDN with caching
- ⚡ **Per-language caching** - Efficient caching strategy per language
- 🔧 **Type-safe** - Full TypeScript support
- 📦 **Shared library** - Reusable across all services in the monorepo

## Usage

### Basic Usage

```typescript
import { getErrorDefinition } from '@api-hub/error-messages';
import { extractLanguageFromEvent } from '@api-hub/utils';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

// Extract language from event
const language = extractLanguageFromEvent(event);

// Get error definition
const errorDef = await getErrorDefinition('ORDERS.VALIDATION_FAILED', language);
```

### In Helper Functions

```typescript
import { buildErrorResponseFromCode } from './helper';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

// Pass event to automatically extract language
const response = await buildErrorResponseFromCode(
  'ORDERS.VALIDATION_FAILED',
  400,
  event, // Language extracted from event headers
  { issues: parsed.error.issues }
);
```

### Language Extraction

The library automatically extracts language from:
1. `Accept-Language` header (standard HTTP header)
2. `X-Language` header (custom header)
3. Falls back to `en` if not provided or unsupported

Supported languages: `en`, `es`, `fr`, `de`, `it`, `pt`, `zh`, `ja`

## Configuration

### Environment Variables

- `ERROR_MESSAGES_CDN_URL` - Base URL for CDN (required)
- `ERROR_MESSAGES_CDN_TIMEOUT_MS` - Request timeout (default: 1500ms)
- `ERROR_MESSAGES_CDN_TTL_MS` - Cache TTL (default: 5 minutes)

### CDN Structure

Error messages should be organized as:
```
{CDN_URL}/server-side-messages/{language}/errors.json
```

Example:
- `https://cdn.example.com/server-side-messages/en/errors.json`
- `https://cdn.example.com/server-side-messages/es/errors.json`

### Error JSON Format

```json
{
  "ORDERS.VALIDATION_FAILED": {
    "title": "Validation Failed",
    "description": "The request validation failed",
    "severity": "error"
  }
}
```

## API Reference

### `getErrorDefinition(errorCode, language?, options?)`

Get error definition for a specific error code and language.

**Parameters:**
- `errorCode: string` - Error code (e.g., "ORDERS.VALIDATION_FAILED")
- `language?: string` - Language code (ISO 639-1, e.g., "en", "es")
- `options?: ErrorMessagesOptions` - Optional configuration

**Returns:** `Promise<CdnErrorDefinition | undefined>`

### `normalizeLanguage(language?)`

Normalize language code to supported format.

**Parameters:**
- `language?: string` - Language code from header

**Returns:** `LanguageCode` - Normalized language code

### `clearErrorCache(language?)`

Clear error configuration cache.

**Parameters:**
- `language?: LanguageCode` - Language to clear, or undefined to clear all

### `getCacheStats()`

Get cache statistics for monitoring.

**Returns:** `{ languages: string[], entries: number }`

## Examples

### Controller Usage

```typescript
import { buildErrorResponseFromCode } from '../utils/helper';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

async handleCreateOrder(event: APIGatewayProxyEventV2) {
  const parsed = CreateOrderSchema.safeParse(body);
  if (!parsed.success) {
    // Language automatically extracted from event headers
    return await buildErrorResponseFromCode(
      'ORDERS.VALIDATION_FAILED',
      400,
      event,
      { issues: parsed.error.issues }
    );
  }
  // ...
}
```

## Migration Guide

### Before

```typescript
// Old approach - hardcoded language
import { getErrorDefinition } from './utils/error-messages';

const def = await getErrorDefinition('ORDERS.VALIDATION_FAILED');
```

### After

```typescript
// New approach - language from headers
import { getErrorDefinition } from '@api-hub/error-messages';
import { extractLanguageFromEvent } from '@api-hub/utils';

const language = extractLanguageFromEvent(event);
const def = await getErrorDefinition('ORDERS.VALIDATION_FAILED', language);
```

Or use the helper function:

```typescript
import { buildErrorResponseFromCode } from './utils/helper';

// Language automatically extracted
return await buildErrorResponseFromCode(
  'ORDERS.VALIDATION_FAILED',
  400,
  event,
  { issues: parsed.error.issues }
);
```

