import { LambdaRequest, UnauthorizedError, ValidationError } from '@api-hub/utils';

const DEFAULT_LIST_LIMIT = 20;
const MIN_LIST_LIMIT = 1;
const MAX_LIST_LIMIT = 100;

function asNonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getRequestIdentityId(
  request: LambdaRequest,
): string | undefined {
  return (
    asNonEmpty(request.context.authContext?.identityId) ??
    asNonEmpty(request.context.userContext?.identityId)
  );
}

/**
 * Application user id from the verified authorizer context.
 * Cognito `sub` / identityId is not an application user id. Request-context
 * copies identityId into userContext.userId when the authorizer omitted userId;
 * that copy is ignored here.
 */
export function getOptionalAuthenticatedUserId(
  request: LambdaRequest,
): string | undefined {
  const identityId = getRequestIdentityId(request);
  const authorizerUserId = asNonEmpty(request.context.authContext?.userId);
  if (authorizerUserId) {
    return authorizerUserId;
  }

  const contextUserId = asNonEmpty(request.context.userContext?.userId);
  if (contextUserId && contextUserId !== identityId) {
    return contextUserId;
  }

  return undefined;
}

export function getAuthenticatedUserId(request: LambdaRequest): string {
  const userId = getOptionalAuthenticatedUserId(request);
  if (userId) {
    return userId;
  }
  if (getRequestIdentityId(request)) {
    throw new UnauthorizedError('Authenticated user id is required');
  }
  throw new UnauthorizedError('Unauthorized');
}

export function assignCanonicalUserId(
  request: LambdaRequest,
  userId: string,
): void {
  const currentUser = request.context.userContext ?? {};
  request.context.userContext = {
    ...currentUser,
    userId,
  };
  if (request.context.authContext) {
    request.context.authContext = {
      ...request.context.authContext,
      userId,
    };
  }
}

export function getPathParam(request: LambdaRequest, name: string): string {
  const value =
    request.pathParameters?.[name] ?? (request.params?.[name] as string | undefined);

  if (!value || value.trim().length === 0) {
    throw new ValidationError(`${name} is required`);
  }

  return value;
}

export function getVendorId(request: LambdaRequest): string {
  return getPathParam(request, 'vendorId');
}

export function parseLimit(raw?: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_LIST_LIMIT;
  }

  const limit = typeof raw === 'number' ? raw : parseInt(String(raw), 10);

  if (!Number.isInteger(limit) || limit < MIN_LIST_LIMIT || limit > MAX_LIST_LIMIT) {
    throw new ValidationError(
      `limit must be an integer between ${MIN_LIST_LIMIT} and ${MAX_LIST_LIMIT}`,
    );
  }

  return limit;
}

export function decodeCursor(cursor?: unknown): Record<string, unknown> | undefined {
  if (cursor === undefined || cursor === null || cursor === '') {
    return undefined;
  }

  try {
    return JSON.parse(
      Buffer.from(String(cursor), 'base64').toString('utf8'),
    ) as Record<string, unknown>;
  } catch {
    throw new ValidationError('Invalid cursor');
  }
}

export function encodeCursor(
  lastEvaluatedKey?: Record<string, unknown>,
): string | null {
  if (!lastEvaluatedKey) {
    return null;
  }

  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64');
}
