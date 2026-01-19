# Coding Standards

This directory contains coding conventions, patterns, and best practices for the API-Hub project.

## 📂 Contents

### API Response Standards
Located in `./api-response/`

A comprehensive set of standards for unified API responses across all services.

#### 📄 Documents

1. **[API_RESPONSE_USAGE.md](./api-response/API_RESPONSE_USAGE.md)**
   - Complete usage guide for the `ApiResponse` class
   - Examples for all response types (success, error, validation)
   - Integration with CDN message resolver
   - **Use this for**: Learning how to implement responses

2. **[MESSAGE_KEYS_CONVENTION.md](./api-response/MESSAGE_KEYS_CONVENTION.md)**
   - Naming convention for message keys (`MODULE.MESSAGE_CODE`)
   - Module organization and structure
   - Best practices and patterns
   - **Use this for**: Creating new message keys

3. **[MESSAGE_KEYS_QUICK_REFERENCE.md](./api-response/MESSAGE_KEYS_QUICK_REFERENCE.md)**
   - Quick lookup for common message keys
   - Usage examples
   - Common patterns
   - **Use this for**: Quick reference during development

4. **[BEFORE_AFTER_COMPARISON.md](./api-response/BEFORE_AFTER_COMPARISON.md)**
   - Side-by-side code comparison (old vs new pattern)
   - Real request/response examples
   - Migration patterns
   - **Use this for**: Understanding the transformation

## 🎯 Quick Start

### For New Developers
1. Read [API_RESPONSE_USAGE.md](./api-response/API_RESPONSE_USAGE.md)
2. Review [MESSAGE_KEYS_CONVENTION.md](./api-response/MESSAGE_KEYS_CONVENTION.md)
3. Keep [MESSAGE_KEYS_QUICK_REFERENCE.md](./api-response/MESSAGE_KEYS_QUICK_REFERENCE.md) handy

### For Code Reviews
- Verify response patterns match [API_RESPONSE_USAGE.md](./api-response/API_RESPONSE_USAGE.md)
- Check message keys follow [MESSAGE_KEYS_CONVENTION.md](./api-response/MESSAGE_KEYS_CONVENTION.md)
- Ensure consistent use of `ApiResponse` class

## ✅ Standards Overview

### Unified Response Structure
```json
{
  "success": boolean,
  "statusCode": number,
  "message": {
    "title": string,
    "description": string,
    "severity": "SUCCESS" | "INFO" | "WARNING" | "ERROR"
  },
  "data": object | array | null,
  "error": object | null,
  "meta": {
    "requestId": string,
    "timestamp": string,
    "version": "v1"
  }
}
```

### Message Key Format
```
MODULE.MESSAGE_CODE

Examples:
- USER.USER_CREATED_SUCCESS
- COMMON.VALIDATION_ERROR
- ORGANIZATION.ORGANIZATION_NOT_FOUND
```

### Implementation Pattern
```typescript
// Success
return ApiResponse.ok(
  data,
  'USER.USER_CREATED_SUCCESS',
  { requestId, event }
);

// Error
return ApiResponse.notFound(
  'USER.USER_NOT_FOUND',
  { requestId, event },
  { code: 'USER_NOT_FOUND' }
);
```

## 🔗 Related Documentation

- **[CDN Configuration](../infrastructure/cdn/CDN_CONFIGURATION.md)** - Message CDN setup
- **[Migration Summary](../infrastructure/unified-response/UNIFIED_RESPONSE_MIGRATION_SUMMARY.md)** - Full migration details
- **[Configuration Complete](../infrastructure/unified-response/CONFIGURATION_COMPLETE.md)** - Current status

## 🆕 Future Standards

As the project evolves, additional coding standards will be added here:
- TypeScript patterns
- Testing standards
- Security best practices
- Performance optimization
- Logging conventions

---

**Last Updated**: 2026-01-19  
**Status**: ✅ Active Standards
