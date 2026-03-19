import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger, createChildLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import {
  UserNotFoundError,
  UserAlreadyExistsError,
  OrganizationNotFoundError,
  ValidationError,
  InviteUpdateTooSoonError,
  FnfLimitReachedError,
  type DomainError,
} from '../../errors';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

export type HandlerResult = Promise<APIGatewayProxyResult>;

export interface HandlerContext {
  correlationId: string;
  logger: ReturnType<typeof createChildLogger>;
  event: APIGatewayProxyEvent;
  context?: Context;
}

/** Map domain errors to HTTP response; unknown errors → 500 without leaking internals */
async function toErrorResponse(
  err: unknown,
  ctx: HandlerContext,
  path: string,
  method: string,
  startTime: number,
): Promise<APIGatewayProxyResult> {
  const duration = Date.now() - startTime;
  logHttpRequest(ctx.logger, method, path, 0, duration, ctx.correlationId);

  if (err instanceof UserNotFoundError) {
    return ApiResponse.notFound(
      'USER.USER_NOT_FOUND',
      { requestId: ctx.correlationId, event: ctx.event },
      { code: 'USER_NOT_FOUND', details: [{ message: err.message }] },
    );
  }
  if (err instanceof UserAlreadyExistsError) {
    return ApiResponse.conflict(
      'USER.USER_ALREADY_EXISTS',
      { requestId: ctx.correlationId, event: ctx.event },
      { code: 'USER_ALREADY_EXISTS', details: [{ message: err.message }] },
    );
  }
  if (err instanceof OrganizationNotFoundError) {
    return ApiResponse.badRequest(
      'ORGANIZATION.NOT_FOUND',
      { requestId: ctx.correlationId, event: ctx.event },
      { code: 'ORGANIZATION_NOT_FOUND', details: [{ message: err.message }] },
    );
  }
  if (err instanceof ValidationError) {
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: ctx.correlationId, event: ctx.event },
      {
        code: 'VALIDATION_ERROR',
        details: err.details ?? [{ message: err.message }],
      },
    );
  }
  if (err instanceof InviteUpdateTooSoonError) {
    return ApiResponse.badRequest(
      'USER.INVITE_UPDATE_TOO_SOON',
      { requestId: ctx.correlationId, event: ctx.event },
      {
        code: 'INVITE_UPDATE_TOO_SOON',
        details: [
          {
            message: err.message,
            field: err.field,
            pendingHours: err.pendingHours,
            pendingMinutes: err.pendingMinutes,
            pendingTimeFormatted: err.pendingTimeFormatted,
          },
        ],
      },
    );
  }
  if (err instanceof FnfLimitReachedError) {
    return ApiResponse.conflict(
      'USER.USER_CANNOT_INVITE_MORE_FNF',
      { requestId: ctx.correlationId, event: ctx.event },
      { code: 'USER_CANNOT_INVITE_MORE_FNF', details: [{ message: 'USER_CANNOT_INVITE_MORE_FNF' }] },
    );
  }
  if (err instanceof Error && 'statusCode' in err && typeof (err as DomainError).statusCode === 'number') {
    const domainErr = err as DomainError;
    if (domainErr.statusCode === 404) {
      return ApiResponse.notFound(
        'COMMON.NOT_FOUND',
        { requestId: ctx.correlationId, event: ctx.event },
        { code: domainErr.code, details: [{ message: domainErr.message }] },
      );
    }
    if (domainErr.statusCode === 409) {
      return ApiResponse.conflict(
        'COMMON.CONFLICT',
        { requestId: ctx.correlationId, event: ctx.event },
        { code: domainErr.code, details: [{ message: domainErr.message }] },
      );
    }
    if (domainErr.statusCode === 422) {
      return ApiResponse.unprocessableEntity(
        'COMMON.VALIDATION_ERROR',
        { requestId: ctx.correlationId, event: ctx.event },
        { code: domainErr.code, details: [{ message: domainErr.message }] },
      );
    }
  }

  ctx.logger.error({ event: 'handler_error', err: serializeError(err) });
  return ApiResponse.internalServerError(
    'COMMON.INTERNAL_SERVER_ERROR',
    { requestId: ctx.correlationId, event: ctx.event },
    { code: 'INTERNAL_SERVER_ERROR', details: [{ message: 'An unexpected error occurred' }] },
  );
}

/**
 * Parse JSON body from API Gateway event.
 * Returns [parsed, null] or [null, errorResponse] so caller can short-circuit on error.
 */
export async function parseJsonBody<T>(
  event: APIGatewayProxyEvent,
): Promise<[T | null, APIGatewayProxyResult | null]> {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body ?? {};
    return [body as T, null];
  } catch {
    const correlationId = extractCorrelationId(event);
    const errorResponse = await ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] },
    );
    return [null, errorResponse];
  }
}

/** Create handler context (logger, correlationId) for the request */
export function createHandlerContext(event: APIGatewayProxyEvent, context?: Context): HandlerContext {
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });
  return { correlationId, logger, event, context };
}

type HandlerFn = (ctx: HandlerContext) => HandlerResult;

/**
 * Wraps a handler so that:
 * - Context (logger, correlationId) is created once
 * - Errors are mapped to HTTP responses consistently
 * - logHttpRequest is called for success and failure
 */
export function withBaseHandler(handler: HandlerFn, defaultPath = '/'): (event: APIGatewayProxyEvent, context?: Context) => HandlerResult {
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
      return await toErrorResponse(err, ctx, path, method, startTime);
    }
  };
}
