# User-Service Architecture Review

**Scope:** Production-grade microservice review for enterprise scalability and maintainability.  
**Stack:** Node.js, TypeScript, AWS Lambda, Serverless, DynamoDB.

---

## Executive Summary

The user-service has a **handler → service → repository** flow with shared utilities (validation, errors, response). There is **no controller layer**; handlers act as both Lambda entrypoints and HTTP controllers. Business logic and request/response shaping are mixed in handlers (especially `createUser`, `getUser`), and there is repeated boilerplate (logging, correlation ID, error mapping). The codebase would benefit from a **BaseHandler** pattern, clearer DTO/model separation, domain error hierarchy, and consistent use of validation and logging before any refactor toward a formal controller layer.

---

## 1. Architecture & Layering

### Current State

| Layer        | Exists | Location / Notes |
|-------------|--------|------------------|
| Handler     | ✅     | `src/handlers/*.ts` – Lambda entry + HTTP handling |
| Controller  | ❌     | Not present; handlers perform controller duties |
| Service     | ✅     | `src/services/*.ts` – core business logic |
| Repository  | ✅     | `src/repositories/*.ts` – DynamoDB access |
| Client      | ✅     | `src/clients/*.ts` – external HTTP (schedule, package) |
| Adapters    | ❌     | No formal adapter layer for external APIs |
| Validators  | ✅     | `src/validation/*.ts` – Zod schemas |
| Mappers     | Partial | `responseMapper.ts`, inline mapping in handlers/services |

**Separation of concerns:** Handlers do too much:

- **createUser.ts**: Parses body, merges `organizationID`/`userID` from authorizer, validates with Zod, **fetches org via getOrganization**, **checks org status**, **builds full `userData` from `userInfo`** (large mapping block), **fetches role permissions and definedRoleCode**, **calls userService.createUser**, **calls assignUserRole**, then builds response. Most of the org check, role resolution, and DTO building belong in a **service or a dedicated “create user” application service**.
- **getUser.ts**: Extracts `userId`/`organizationId` from path, authorizer, **and JWT decode** (long inline block), validates, calls service, fetches org from repository, calls `transformUserForResponse`, handles transform errors with fallback object. **Parameter extraction and JWT decoding** should be in a shared helper or middleware; **response shaping** in a controller or presenter.

**Recommendations:**

1. **Introduce a thin controller layer** (optional but useful for consistency):
   - **Handler**: Parse event, extract correlation ID, get logger, delegate to controller, catch errors and return `APIGatewayProxyResult`.
   - **Controller**: Extract and validate input (path/query/body), call service(s), map result to HTTP response (status + body). No business rules.
   - **Service**: Pure business logic; no knowledge of Lambda event or HTTP.

2. **Move business logic out of handlers:**
   - **Organization validation** (exists, status) → e.g. `UserService.createUser` or an `OrganizationService.validateForUserCreation(orgId, authHeader)`.
   - **Role resolution** (rolePermissions, definedRoleCode, roleName) → `RoleService.resolveRoleForCreateUser(roleIds, organizationID)` or inside `UserService.createUser` with role service injected.
   - **Build `userData` from `userInfo`** → `UserMapper.toCreateUserInput(validation.data)` in `mappers/` or inside a dedicated application service.

3. **Domain-driven design:**  
   Consider bounded contexts (e.g. **User**, **FriendFamily**, **Organization**, **Role**) and application services per use case (`CreateUserApplicationService`, `GetUserApplicationService`) that orchestrate domain services and repositories. Keep handlers/controllers thin.

---

## 2. Folder Structure

### Current Structure

```
src/
  handlers/        # Lambda + HTTP logic mixed
  services/
  repositories/
  clients/
  validation/      # Validators
  models/          # Domain/response types
  events/
  consumers/
  utils/           # errors, response, helpers, db.config, constants, idempotency
  types/
```

**Gaps:** No dedicated `controllers/`, `mappers/`, `errors/` (errors live in `utils/errors.ts`), `middleware/`, or `config/`. Validation is under `validation/` (good); response helpers are in `utils/`.

### Recommended Enterprise Structure

```
src/
  handlers/           # Lambda entry only; delegate to controller
  controllers/       # HTTP input/output; call services
  services/          # Business logic
  repositories/      # Data access
  clients/           # External HTTP/gRPC
  adapters/          # External API → domain adapters (optional)
  validators/        # Zod (or similar) schemas
  mappers/           # request DTO → domain; domain → response DTO
  models/            # Domain entities and value objects
  dto/               # Request/response DTOs (optional; can stay in types/)
  errors/            # Domain and HTTP-aware errors
  middleware/        # Auth, request context, logging (if you add Express-like chain)
  utils/             # Pure helpers (no I/O)
  config/            # Env and feature flags
  events/            # Event types and publishers
  consumers/         # SQS/Stream consumers
  types/             # Shared TypeScript types
```

**Concrete steps:**

- Move `utils/errors.ts` → `errors/index.ts` (or `errors/domain-errors.ts`) and add HTTP-aware error types if needed.
- Add `config/index.ts` that reads `process.env` once and exports typed config (table names, URLs, feature flags).
- Introduce `mappers/` and move mapping logic from handlers/services (e.g. `userInfo` → `userData`, entity → response DTO).
- Keep `validation/` as-is; optionally rename to `validators/` for consistency with the list above.

---

## 3. Handler Design (AWS Lambda)

### Current Issues

- **Business logic in handlers:** createUser/getUser contain org checks, role resolution, and DTO building.
- **Validation in handler:** Good use of Zod `safeParse`, but validation and error response are repeated across handlers.
- **Duplicated boilerplate in every handler:**
  - `startTime = Date.now()`
  - `correlationId = extractCorrelationId(event)`
  - `awsRequestId = context ? extractAwsRequestId(context) : undefined`
  - `logger = createChildLogger(baseLogger, { correlationId, ... })`
  - Body parse with try/catch and same 400 response
  - Per-handler error catch with `logHttpRequest` + `ApiResponse.*` and duration.

- **Inconsistency:** Some handlers export `main` as `APIGatewayProxyHandler`, others export `main` that directly runs the same-named function; `friendFamilyFetch` exports `main` only.

### Recommended: BaseHandler Pattern

Centralize correlation ID, request logging, body parsing, and error → response mapping in a **BaseHandler** (or wrapper). Handlers then only extract params, validate, call controller/service, and return result.

**Example: BaseHandler**

```typescript
// src/handlers/base/baseHandler.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger, createChildLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { UserNotFoundError, UserAlreadyExistsError, OrganizationNotFoundError, ValidationError } from '../errors';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

export type HandlerResult = Promise<APIGatewayProxyResult>;

export interface HandlerContext {
  correlationId: string;
  logger: ReturnType<typeof createChildLogger>;
  event: APIGatewayProxyEvent;
  context?: Context;
}

/** Map domain errors to HTTP response; unknown errors → 500 without leaking internals */
function toErrorResponse(err: unknown, ctx: HandlerContext, path: string, method: string, startTime: number): APIGatewayProxyResult {
  const duration = Date.now() - startTime;
  logHttpRequest(ctx.logger, method, path, 0, duration, ctx.correlationId);

  if (err instanceof UserNotFoundError) {
    return ApiResponse.notFound('USER.USER_NOT_FOUND', { requestId: ctx.correlationId, event: ctx.event }, {
      code: 'USER_NOT_FOUND',
      details: [{ message: err.message }],
    });
  }
  if (err instanceof UserAlreadyExistsError) {
    return ApiResponse.conflict('USER.USER_ALREADY_EXISTS', { requestId: ctx.correlationId, event: ctx.event }, {
      code: 'USER_ALREADY_EXISTS',
      details: [{ message: err.message }],
    });
  }
  if (err instanceof OrganizationNotFoundError) {
    return ApiResponse.badRequest('ORGANIZATION.NOT_FOUND', { requestId: ctx.correlationId, event: ctx.event }, {
      code: 'ORGANIZATION_NOT_FOUND',
      details: [{ message: err.message }],
    });
  }
  if (err instanceof ValidationError) {
    return ApiResponse.unprocessableEntity('COMMON.VALIDATION_ERROR', { requestId: ctx.correlationId, event: ctx.event }, {
      code: 'VALIDATION_ERROR',
      details: [{ message: err.message }],
    });
  }

  ctx.logger.error({ event: 'handler_error', err: serializeError(err) });
  return ApiResponse.internalServerError(
    'COMMON.INTERNAL_SERVER_ERROR',
    { requestId: ctx.correlationId, event: ctx.event },
    { code: 'INTERNAL_SERVER_ERROR', details: [{ message: 'An unexpected error occurred' }] },
  );
}

/** Parse JSON body; returns [parsed, null] or [null, errorResponse] */
export function parseJsonBody<T>(event: APIGatewayProxyEvent): [T | null, APIGatewayProxyResult | null] {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    return [body ?? null, null];
  } catch {
    return [null, ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: extractCorrelationId(event), event }, {
      code: 'BAD_REQUEST',
      details: [{ message: 'Invalid JSON body' }],
    })];
  }
}

export function createHandlerContext(event: APIGatewayProxyEvent, context?: Context): HandlerContext {
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });
  return { correlationId, logger, event, context };
}

/**
 * Wraps a handler so that:
 * - Context (logger, correlationId) is created once
 * - Errors are mapped to HTTP responses consistently
 * - logHttpRequest is called for success and failure
 */
export function withBaseHandler(
  handler: (ctx: HandlerContext) => HandlerResult,
  defaultPath = '/',
) {
  return async (event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> => {
    const startTime = Date.now();
    const ctx = createHandlerContext(event, context);
    const method = event.httpMethod || 'GET';
    const path = event.path || defaultPath;

    try {
      const result = await handler(ctx);
      const duration = Date.now() - startTime;
      logHttpRequest(ctx.logger, method, path, result.statusCode, duration, ctx.correlationId);
      return result;
    } catch (err) {
      return toErrorResponse(err, ctx, path, method, startTime);
    }
  };
}
```

**Example: Refactored getUser handler**

```typescript
// src/handlers/getUser.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { ApiResponse } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { createHandlerContext, withBaseHandler } from './base/baseHandler';
import { getUserIdAndOrganizationIdFromRequest } from '../utils/requestContext'; // new: centralize path + authorizer + token

const userService = new UserService();

export const main: APIGatewayProxyHandler = withBaseHandler(async (ctx) => {
  const { userId, organizationId, userType, defaultProfile } = await getUserIdAndOrganizationIdFromRequest(ctx.event);
  if (!userId || !organizationId) {
    return ApiResponse.badRequest('COMMON.BAD_REQUEST', { requestId: ctx.correlationId, event: ctx.event }, {
      code: 'BAD_REQUEST',
      details: [{ message: 'userId and organizationId are required' }],
    });
  }

  const user = await userService.getUser(userId, organizationId);
  if (!user) throw new UserNotFoundError(userId);

  const orgData = await organizationRepository.getOrganizationFromDB(organizationId).catch(() => null);
  const transformed = await userService.transformUserForResponse(user, organizationId, userType, orgData, defaultProfile);
  return ApiResponse.ok(transformed, 'USER.USER_RETRIEVED_SUCCESS', { requestId: ctx.correlationId, event: ctx.event });
}, '/user/organization/{organizationId}/{userId}');
```

This keeps the handler thin: extract input → call service → return response; errors (including `UserNotFoundError`) are handled by `withBaseHandler`.

---

## 4. Error Handling

### Current State

- **Domain errors** in `utils/errors.ts`: `UserNotFoundError`, `UserAlreadyExistsError`, `OrganizationNotFoundError`, `ValidationError`, `InvalidEventError`, `InviteUpdateTooSoonError`.
- **Usage:** Handlers catch and map to `ApiResponse.notFound`, `ApiResponse.conflict`, etc.; **friendFamilyFetch** does not handle `UserNotFoundError` and returns generic 500 for all errors.
- **Leak risk:** In createUser and others, `ApiResponse.internalServerError(..., { details: [{ message: (err as Error)?.message || 'Unknown error' }] })` **exposes internal error messages** to the client (e.g. DB or Cognito messages).

### Recommendations

1. **Move errors to `errors/` and extend hierarchy:**

```typescript
// errors/domain-errors.ts
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, `${resource.toUpperCase()}_NOT_FOUND`, 404);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, code, 409);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, public readonly details?: Array<{ field?: string; message: string }>) {
    super(message, 'VALIDATION_ERROR', 422);
  }
}

export class DownstreamServiceError extends DomainError {
  constructor(service: string, cause?: Error) {
    super(`Downstream service error: ${service}`, 'DOWNSTREAM_ERROR', 502);
    if (cause) this.cause = cause;
  }
}

// Keep backward compatibility
export const UserNotFoundError = class UserNotFoundError extends NotFoundError {
  constructor(userId: string) {
    super('User', userId);
    this.name = 'UserNotFoundError';
  }
};
```

2. **Do not expose internal messages on 500:**  
   In BaseHandler’s generic catch, return a fixed client message (e.g. “An unexpected error occurred”) and log `serializeError(err)` server-side only.

3. **Consistent handling in all handlers:**  
   Use BaseHandler (or a single `toErrorResponse`) so that every handler maps domain errors the same way and never sends `err.message` for unknown errors.

---

## 5. Logging

### Current State

- **Structured logging:** `@api-hub/logger` with `createLogger`, `createChildLogger`, `serializeError`, `logHttpRequest`, `createPerformanceTimer`.
- **Correlation ID:** Extracted and passed to child logger in each handler.
- **PII:** `redactPII: true` on base logger.
- **Inconsistencies:** Many **console.log** calls (createUser, getUser, role.service, user.repository, package.repositrory, friendFamily.service, v2-user-list.service, getOrganizationUserCount, listUsers, inviteNotificationStreamHandler). These bypass structured logging and may leak PII.

### Recommendations

1. **Remove all console.log:** Replace with `logger.debug` or `logger.info` with structured payloads (no raw bodies or tokens).
2. **Structured fields:** Keep `event: 'createUser_received'`-style keys; add `durationMs`, `statusCode`, `path` where useful.
3. **Request tracing:** Ensure `correlationId` (and optionally `awsRequestId`) are on every log line via child logger; consider adding a request-scoped trace ID if you adopt X-Ray or similar.
4. **Sensitive data:** Audit logs for `event.body`, `event`, or full error objects; use redaction or omit sensitive fields.

---

## 6. Validation

### Current State

- **Zod** in `validation/*.ts`: createUser, updateUser, friendFamily, schedule, event, v2-user-list, listOrganizationUsersPost.
- Validation is **run inside handlers**; validators are reusable but the “run schema + return 422” pattern is duplicated.

### Recommendations

1. **Validation layer:** Keep Zod schemas in `validators/` (or keep `validation/`). Add a small helper so handlers don’t repeat the same block:

```typescript
// validators/run.ts
export function validateOrRespond<T>(schema: z.ZodSchema<T>, data: unknown, ctx: HandlerContext): T | APIGatewayProxyResult {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  return ApiResponse.unprocessableEntity('COMMON.VALIDATION_ERROR', { requestId: ctx.correlationId, event: ctx.event }, {
    code: 'VALIDATION_ERROR',
    details: result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
  });
}
```

2. **Validate early:** Parse body → validate → then any business logic. Keep path/query validation in one place (e.g. `getUserIdAndOrganizationIdFromRequest`).

---

## 7. Type Safety & DTOs

### Current State

- **models/:** Domain-like entities (`User`, `UserMetadata`, …) and response shapes (`UserResponse`, `StaffResponse`, …) mixed; `User` includes `pk`/`sk` (DynamoDB concerns).
- **Handlers** use `any` for body and sometimes for `userData`; response types are not always explicit.
- **No clear request DTOs:** createUser builds a large `userData` object from `userInfo` in the handler; that shape is effectively a “create user” input DTO but is not defined as a type.

### Recommendations

1. **Separate layers:**
   - **Request DTO:** Types (or Zod inferred types) for API input, e.g. `CreateUserRequest`, `UpdateUserRequest`.
   - **Domain model:** `User` (and possibly a separate persistence model without `pk`/`sk` in the public type, or a `UserEntity` that includes keys).
   - **Response DTO:** `UserResponse`, `CreateUserResponse`, etc., used by controllers/handlers only.

2. **Mappers:**  
   `mappers/createUser.mapper.ts`: `(body: CreateUserRequest) => CreateUserInput` (domain input).  
   `mappers/userResponse.mapper.ts`: `(user: User, org?: ...) => UserResponse`.  
   This keeps handlers and controllers free of large mapping blocks.

3. **Reduce `any`:** Type body as `unknown`, then validate with Zod and use `validation.data` as the typed DTO.

---

## 8. Service Layer

### Current State

- **UserService** is large (~2200+ lines) and handles many use cases (create, get, update, delete, list, assign doctor, F&F, notifications, etc.). Some logic could be split (e.g. F&F, roles, notifications).
- **Duplication:** createUser in handler fetches role permissions and sets `definedRoleCode`/`roleName`; similar role logic may exist elsewhere. Consolidate in **RoleService** or a single “resolve role for user” function.
- **FriendFamilyService** and **OrganizationService** are used from handlers and from UserService; dependency injection would make testing and reuse clearer.

### Recommendations

1. **Split UserService by aggregate/use case:** e.g. `UserCrudService`, `UserQueryService`, `UserAssignmentService`, or application services per use case.
2. **Inject dependencies:** Pass repositories and external services (Cognito, role, package, notification) via constructor so handlers or a composition root wire them once.
3. **Shared logic:** Move “resolve role for create user” and “build user from userInfo” into shared modules or services so the handler only orchestrates.

---

## 9. Database Layer

### Current State

- **Repository pattern:** `UserRepository`, `FriendFamilyRepository`, `OrganizationRepository`, etc., with DynamoDB DocumentClient in `utils/db.config.ts`.
- **Single `docClient` instance** at module scope (good for connection reuse).
- **No transactions:** FriendFamilyRepository does two `PutCommand` calls (e.g. saveMapping); if the second fails, the first is not rolled back. DynamoDB supports `TransactWriteCommand`.
- **Table names:** Read from `process.env.USER_TABLE` etc. inside repositories; no single config layer.

### Recommendations

1. **Config:** Centralize table names (and any indexes) in `config/` and inject or pass them into repositories.
2. **Transactions:** For operations that must be atomic (e.g. F&F mapping pair), use `TransactWriteCommand` so both puts succeed or both fail.
3. **Abstraction:** Repositories already abstract DynamoDB; keep them. Optionally add a small **unit-of-work** or **transaction helper** for multi-item writes.
4. **Connection reuse:** Keep a single DocumentClient per Lambda (already done); ensure it’s not recreated inside request handlers.

---

## 10. Security

### Current State

- **Input validation:** Zod used for body/query; path params sometimes validated ad hoc. Some handlers still use raw body without schema.
- **Authorization:** `getAuthorizerUserId`, `getAuthorizerOrganizationId`; some paths require auth. No centralized “require auth” or “require org membership” helper.
- **Sensitive logging:** console.log of body, authorizer, and raw errors; risk of logging tokens or PII.

### Recommendations

1. **Validate all inputs:** Path parameters (e.g. userId, organizationId) via Zod or a shared validator; reject before calling services.
2. **Authorization middleware/helper:** e.g. `requireAuth(event)` and `requireOrgAccess(event, organizationId)` that return 401/403 and standard response shape.
3. **Audit logging:** Log auth decisions (e.g. “access denied”, resource id) without logging tokens or full event bodies.
4. **Remove sensitive logs:** Strip or redact Authorization header and body in any request log; use logger with redactPII and avoid console.log.

---

## 11. Performance

### Current State

- **Lambda:** 512 MB, 30 s timeout; X-Ray tracing enabled; `AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1'`.
- **Cold start:** Services and repositories are instantiated at module scope in handlers (e.g. `const userService = new UserService();`), which is good for reuse across invocations.
- **Idempotency:** `utils/idempotency.ts` exists but uses a separate DynamoDB client (low-level `DynamoDBClient`); not used in createUser/updateUser in the reviewed code. Create/update are not clearly idempotent (e.g. by idempotency key header).

### Recommendations

1. **Cold start:** Keep singleton services/repos at module scope; avoid heavy imports or init inside the handler. Consider lazy init for rarely used clients.
2. **Connection reuse:** Single DocumentClient and HTTP clients (e.g. for schedule, package) reused across invocations; document this pattern for new clients.
3. **Idempotency:** For POST/PUT that create or update resources, consider accepting `Idempotency-Key` and using the existing idempotency util (or a wrapper) to skip duplicate processing and return the same response.
4. **N+1 / batch:** In list endpoints, prefer Query/BatchGetItem patterns already in use; avoid per-item GetItem in loops where a batch call is possible.

---

## 12. Consistency

### Findings

- **Naming:** Mix of `userId`/`userID`, `organizationId`/`organizationID` (legacy and authorizer). Prefer one convention (e.g. camelCase in code, map from API `userID` at the edge).
- **Exports:** Most HTTP handlers export `main` as `APIGatewayProxyHandler` and an async function; friendFamilyFetch only exports `main`. Standardize on one pattern.
- **Typo:** `package.repositrory.ts` → rename to `package.repository.ts`.
- **Response shape:** ApiResponse from `@api-hub/utils` is used consistently; local `utils/response.ts` (ok, created, problem) appears unused or legacy—confirm and remove if redundant.

### Recommendations

1. **Convention:** Document and enforce camelCase for all new code; add a mapper at handler/controller boundary for API keys (e.g. `userID` → `userId`).
2. **Handler export:** Always export `main` as the Lambda handler and use the same signature; use BaseHandler so behavior is consistent.
3. **Rename** `package.repositrory.ts` and update imports.
4. **Remove** dead code (e.g. unused response helpers) after confirming.

---

## 13. Refactoring Examples Summary

| Area              | Suggestion |
|-------------------|------------|
| **Handler**       | Introduce `withBaseHandler` and `createHandlerContext`; move body parse and error mapping into base. |
| **Service**        | Extract “resolve role for create user” and “build userData from userInfo” into RoleService/UserMapper; inject dependencies. |
| **Error handling**| Move errors to `errors/`, add `DomainError` hierarchy; in BaseHandler return generic message for unknown errors; ensure all handlers use the same mapping. |
| **Validation**     | Add `validateOrRespond(schema, data, ctx)` and use it in every handler that accepts body. |
| **Logging**        | Remove console.log; use only structured logger with correlationId. |
| **Types**          | Introduce request/response DTOs and mappers; reduce `any` on body and intermediate objects. |
| **DB**             | Use TransactWriteCommand for F&F saveMapping; centralize table config. |

---

## Priority Order for Implementation

1. **High:** BaseHandler + centralized error mapping; stop exposing internal error messages on 500.
2. **High:** Remove console.log and ensure PII is not logged.
3. **Medium:** Move org/role logic and DTO building from createUser handler into service/mapper.
4. **Medium:** Request context helper (getUserIdAndOrganizationIdFromRequest) and consistent validation helper.
5. **Medium:** Errors folder and domain error hierarchy; optional ConflictError/NotFoundError/DownstreamServiceError.
6. **Lower:** Controller layer, folder restructure, full DTO/mapper split, F&F transaction, idempotency on create/update.

This order keeps risk low while improving observability, security, and maintainability before larger structural changes.
