Create a centralized types.ts for middleware.

Requirements:
- Define:
  - Middleware
  - MiddlewareParams
  - Handler
  - MiddlewareHooks
  - MiddlewareEngineOptions
- Add ExecutionContext with:
  - correlationId
  - awsRequestId
  - userId
  - tenantId
- Ensure all middleware uses these types

Refactor existing middleware files to use these types.