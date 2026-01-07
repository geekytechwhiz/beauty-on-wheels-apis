# Usage Examples

## Example 1: Using in Controller (Recommended)

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
      event,  // Pass event to extract language from headers
      { issues: parsed.error.issues }
    );
  }
  
  // ... rest of handler
}
```

## Example 2: Direct Language Extraction

```typescript
import { getErrorDefinition } from '@api-hub/error-messages';
import { extractLanguageFromEvent } from '@api-hub/utils';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

async function handleError(event: APIGatewayProxyEventV2, errorCode: string) {
  const language = extractLanguageFromEvent(event);
  const errorDef = await getErrorDefinition(errorCode, language);
  
  return {
    statusCode: 400,
    body: JSON.stringify({
      errorCode,
      message: errorDef?.title || 'An error occurred',
      error: errorDef,
    }),
  };
}
```

## Example 3: Without Event (Fallback to Default Language)

```typescript
import { buildErrorResponseFromCode } from '../utils/helper';

// When event is not available, defaults to 'en'
const response = await buildErrorResponseFromCode(
  'ORDERS.INTERNAL_ERROR',
  500,
  undefined,  // No event, will use default language
  undefined,
  'Internal server error'
);
```

## Example 4: Custom Language

```typescript
import { getErrorDefinition } from '@api-hub/error-messages';

// Explicitly specify language
const errorDef = await getErrorDefinition('ORDERS.VALIDATION_FAILED', 'es');
```

## Header Formats Supported

The library supports multiple header formats:

1. **Standard HTTP Header:**
   ```
   Accept-Language: en-US,en;q=0.9,es;q=0.8
   ```

2. **Custom Header:**
   ```
   X-Language: es
   ```

3. **API Gateway v1 and v2:**
   - Automatically handles both event formats
   - Case-insensitive header matching

## Language Normalization

The library normalizes language codes:
- `en-US` → `en`
- `es-MX` → `es`
- `fr-CA` → `fr`
- Unsupported languages → `en` (default)

