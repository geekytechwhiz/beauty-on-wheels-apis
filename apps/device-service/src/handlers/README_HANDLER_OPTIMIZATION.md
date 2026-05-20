# Handler optimization guide

Shared utilities and patterns for **reusability**, **readability**, and **maintainability** across all device-service handlers.

## Shared utilities

| Utility | Purpose |
|--------|--------|
| **utils/handlerContext.ts** | `createHandlerContext(event: any, context)` → `{ startTime, correlationId, awsRequestId, logger, event }`. Use at the start of every handler. |
| **utils/requestParser.ts** | `parseRequestBody(event.body, logger, { parseErrorEvent: 'handlerName_parse_error' })` → `{ success, body? }`. No throw; return 400 when `!success`. |
| **utils/authContext.ts** | `extractUserContext({ authorizer, body })` → `{ userId?, organizationId? }`. `validateUserContext(ctx)` for required auth. |
| **utils/validationHelper.ts** | `validationErrorResponse(zodError, options)` → logs 422 and returns `ApiResponse.unprocessableEntity` with same details shape. |
| **utils/responseHelper.ts** | `logAndRespond({ logger, method, path, statusCode, startTime, correlationId }, response)` → logs HTTP then returns response. |
| **utils/errorHandler.ts** | `handleHandlerError(err, options)` with `domainMap: [[ErrorClass, { statusCode, messageKey, code }], ...]` for domain→HTTP mapping. |
| **constants/paths.ts** | `PATHS.DEVICES_*` for default path in logging. |
| **constants/errorCodes.ts** | `ERROR_CODES.*` for response `code` field. |
| **constants/httpMethods.ts** | `HTTP_METHODS.POST` etc. for method in logging. |

## Standard handler shape

```ts
export const handler: any = async (event: any, context?: Context) => {
  const ctx = createHandlerContext(event: any, context);
  const { startTime, correlationId, logger } = ctx;
  const evt = ctx.event;
  logger.info({ event: 'handlerName_received' });

  // 1. Parse body (if POST with body)
  const parseResult = parseRequestBody(evt.body, logger, { parseErrorEvent: 'handlerName_parse_error' });
  if (!parseResult.success) {
    return logAndRespond(
      { logger, method: evt.httpMethod || HTTP_METHODS.POST, path: evt.path || PATHS.XXX, statusCode: 400, startTime, correlationId },
      await ApiResponse.badRequest('COMMON.INVALID_JSON', {  correlationId: correlationId, event: evt }, { code: ERROR_CODES.BAD_REQUEST }),
    );
  }

  // 2. Auth (if needed)
  const userContext = extractUserContext({ authorizer: evt.requestContext?.authorizer, body: parseResult.body ?? {} });
  // if (!validateUserContext(userContext)) return 401...

  // 3. Validate with Zod
  const validation = someSchema.safeParse(payload);
  if (!validation.success) {
    return validationErrorResponse(validation.error, { correlationId, event: evt, logger, startTime, path: evt.path || PATHS.XXX, method: evt.httpMethod || HTTP_METHODS.POST, logEventName: 'handlerName_validation_error' });
  }

  // 4. Business logic
  try {
    const result = await someService.doWork(validation.data, correlationId);
    return logAndRespond(
      { logger, method: evt.httpMethod || HTTP_METHODS.POST, path: evt.path || PATHS.XXX, statusCode: 200, startTime, correlationId },
      await ApiResponse.ok(result, '...', {  correlationId: correlationId, event: evt }),
    );
  } catch (err) {
    return handleHandlerError(err, {
      correlationId, event: evt, path: evt.path || PATHS.XXX, method: evt.httpMethod || HTTP_METHODS.POST,
      startTime, logger, logEventName: 'handlerName_error',
      defaultMessageKey: '...', defaultCode: ERROR_CODES.XXX,
      domainMap: [
        [SomeError, { statusCode: 404, messageKey: '...', code: ERROR_CODES.XXX }],
      ],
    });
  }
};
```

## Refactored handlers (reference)

- **deviceRegister.ts** – Uses handlerContext (inline), requestParser, authContext, validationHelper, responseHelper (via error handler), handleDeviceRegistrationError.
- **deviceUserRegister.ts** – Full pattern: createHandlerContext, parseRequestBody, extractUserContext, validationErrorResponse, logAndRespond.
- **deviceUserDelete.ts** – Full pattern + handleHandlerError with DeviceNotFoundError → 404.
- **deviceRecommendationRemove.ts** – Full pattern + handleHandlerError with RecommendationNotFoundError (404) and RecommendationCannotRemovePairedError (400).

## How to refactor remaining handlers

1. Replace inline `startTime`, `correlationId`, `logger` setup with `createHandlerContext(event: any, context)`.
2. Replace inline `JSON.parse(event.body)` try/catch with `parseRequestBody(evt.body, logger, { parseErrorEvent: '...' })` and 400 on `!success`.
3. Replace inline authorizer/claims with `extractUserContext({ authorizer, body })` (and `validateUserContext` if you need 401).
4. Replace manual validation failure handling with `validationErrorResponse(validation.error, { ... })`.
5. Before each success/error return, use `logAndRespond({ ... }, await ApiResponse.*(...))` instead of manual duration + logHttpRequest + return.
6. In catch, use `handleHandlerError(err, { ..., domainMap: [...] })` with your domain errors; add any new error codes to `constants/errorCodes.ts` and paths to `constants/paths.ts`.

## Preserved contracts

- Request path, method, body shape, and response body shape are unchanged.
- HTTP status codes and error message keys are unchanged.
- All correlationId and awsRequestId tracking is preserved.
