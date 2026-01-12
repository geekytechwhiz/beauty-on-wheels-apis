# Error Messages Library Architecture

## Overview

This library provides a production-ready, multi-language error messaging system for API Gateway Lambda functions in the NX monorepo.

## Architecture Components

### 1. Shared Library (`@api-hub/error-messages`)

Located in `libs/error-messages/`, this library provides:

- **Language-aware error fetching** - Fetches error definitions from CDN based on language
- **Per-language caching** - Efficient caching strategy with TTL per language
- **Language normalization** - Handles various language code formats (e.g., `en-US` → `en`)
- **Type-safe APIs** - Full TypeScript support

### 2. Header Utilities (`@api-hub/utils`)

Located in `libs/utils/src/helper/headerUtils.ts`, provides:

- `extractLanguageFromEvent()` - Extracts language from API Gateway events (v1 & v2)
- `extractHeader()` - Generic header extraction utility
- `extractHeaders()` - Extract multiple headers at once

### 3. Helper Functions

Updated `buildErrorResponseFromCode()` in service-specific helpers to:
- Accept event parameter for automatic language extraction
- Maintain backward compatibility (event is optional)
- Use shared error-messages library

## Data Flow

```
API Request
    ↓
[Accept-Language Header]
    ↓
extractLanguageFromEvent(event)
    ↓
normalizeLanguage(language) → "en" | "es" | "fr" | ...
    ↓
getErrorDefinition(errorCode, language)
    ↓
[Check Cache] → [Fetch from CDN if needed]
    ↓
Error Definition (localized)
    ↓
buildErrorResponseFromCode()
    ↓
API Response (with localized error message)
```

## Caching Strategy

- **Per-language caching** - Each language has its own cache entry
- **TTL-based invalidation** - Configurable via `ERROR_MESSAGES_CDN_TTL_MS`
- **Cache structure:**
  ```typescript
  Map<LanguageCode, {
    config: ErrorConfig,
    lastLoadedAt: number
  }>
  ```

## Language Support

### Supported Languages
- `en` (English) - Default
- `es` (Spanish)
- `fr` (French)
- `de` (German)
- `it` (Italian)
- `pt` (Portuguese)
- `zh` (Chinese)
- `ja` (Japanese)

### Language Normalization
- `en-US` → `en`
- `es-MX` → `es`
- `fr-CA` → `fr`
- Unsupported → `en` (fallback)

## CDN Structure

```
{CDN_URL}/
  server-side-messages/
    en/
      errors.json
    es/
      errors.json
    fr/
      errors.json
    ...
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ERROR_MESSAGES_CDN_URL` | Base URL for CDN | Required |
| `ERROR_MESSAGES_CDN_TIMEOUT_MS` | Request timeout | 1500ms |
| `ERROR_MESSAGES_CDN_TTL_MS` | Cache TTL | 5 minutes |

## Usage Patterns

### Pattern 1: Automatic Language Extraction (Recommended)

```typescript
// In controller
return await buildErrorResponseFromCode(
  'ORDERS.VALIDATION_FAILED',
  400,
  event,  // Language extracted automatically
  { issues: parsed.error.issues }
);
```

### Pattern 2: Explicit Language

```typescript
const language = extractLanguageFromEvent(event);
const errorDef = await getErrorDefinition('ORDERS.VALIDATION_FAILED', language);
```

### Pattern 3: Default Language

```typescript
// No event provided, uses default 'en'
const response = await buildErrorResponseFromCode(
  'ORDERS.INTERNAL_ERROR',
  500
);
```

## Benefits

1. **Reusability** - Shared across all services in monorepo
2. **Maintainability** - Single source of truth for error messages
3. **Internationalization** - Built-in multi-language support
4. **Performance** - Efficient caching per language
5. **Type Safety** - Full TypeScript support
6. **Flexibility** - Supports both API Gateway v1 and v2

## Migration Path

1. ✅ Create shared library
2. ✅ Add header extraction utilities
3. ✅ Update helper functions
4. ✅ Update tsconfig paths
5. ⏳ Update controllers to pass event parameter
6. ⏳ Remove old error-messages.ts from services

## Future Enhancements

- [ ] Add support for more languages
- [ ] Add cache warming on cold starts
- [ ] Add metrics/monitoring hooks
- [ ] Add support for error message versioning
- [ ] Add fallback chain (e.g., `es-MX` → `es` → `en`)

