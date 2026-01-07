# Migration Guide: Error Messages to Shared Library

## Summary

The error messages functionality has been moved from service-specific files to a shared library (`@api-hub/error-messages`) with multi-language support.

## What Changed

### ✅ Created

1. **`libs/error-messages/`** - New shared library with language support
2. **`libs/utils/src/helper/headerUtils.ts`** - Header extraction utilities
3. **Updated `tsconfig.base.json`** - Added path mapping for `@api-hub/error-messages`

### ✅ Updated

1. **`apps/order-service/src/utils/helper.ts`**
   - Now imports from `@api-hub/error-messages`
   - `buildErrorResponseFromCode()` accepts optional `event` parameter for language extraction

### 📝 To Do (Optional Cleanup)

1. Remove old `apps/order-service/src/utils/error-messages.ts` (if no longer needed)
2. Update other services to use the new library

## How to Use

### Before (Old Way)

```typescript
import { getErrorDefinition } from "./error-messages";

const def = await getErrorDefinition("ORDERS.VALIDATION_FAILED");
// Always uses 'en' language
```

### After (New Way)

```typescript
import { buildErrorResponseFromCode } from "../utils/helper";

// Option 1: Pass event (recommended - automatic language extraction)
return await buildErrorResponseFromCode(
  "ORDERS.VALIDATION_FAILED",
  400,
  event,  // Language extracted from headers
  { issues: parsed.error.issues }
);

// Option 2: Explicit language
import { getErrorDefinition } from "@api-hub/error-messages";
import { extractLanguageFromEvent } from "@api-hub/utils";

const language = extractLanguageFromEvent(event);
const def = await getErrorDefinition("ORDERS.VALIDATION_FAILED", language);
```

## Updating Controllers

### Example: Validation Error

```typescript
// Before
if (!parsed.success) {
  return {
    statusCode: 400,
    body: JSON.stringify({
      statusCode: 400,
      success: false,
      message: "Validation failed",
      issues: parsed.error.issues,
    }),
  };
}

// After
if (!parsed.success) {
  return await buildErrorResponseFromCode(
    "ORDERS.VALIDATION_FAILED",
    400,
    event,  // Add this parameter
    { issues: parsed.error.issues }
  );
}
```

## Language Header Support

The library automatically extracts language from:
- `Accept-Language` header (standard HTTP)
- `X-Language` header (custom)

**Example requests:**
```bash
# English (default)
curl -H "Accept-Language: en" https://api.example.com/orders

# Spanish
curl -H "Accept-Language: es" https://api.example.com/orders

# French
curl -H "X-Language: fr" https://api.example.com/orders
```

## Testing

1. Test with different language headers
2. Verify fallback to 'en' when language not provided
3. Verify cache behavior (should cache per language)
4. Test with unsupported languages (should fallback to 'en')

## Rollback Plan

If issues arise, you can temporarily:
1. Keep using the old `error-messages.ts` file
2. The new library is backward compatible (event parameter is optional)

## Next Steps

1. ✅ Library created and configured
2. ✅ Helper function updated
3. ⏳ Update controllers to pass `event` parameter
4. ⏳ Test with different languages
5. ⏳ Remove old `error-messages.ts` files from services

