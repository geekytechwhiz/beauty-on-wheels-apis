import { LambdaRequest, UnauthorizedError } from '@api-hub/utils';

function identityId(request: LambdaRequest): string | undefined {
  const value =
    request.context.authContext?.identityId ??
    request.context.userContext?.identityId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Canonical application user id. A Cognito subject alone is not a customer id.
 */
export function requireCustomerId(request: LambdaRequest): string {
  const authorizerUserId = request.context.authContext?.userId?.trim();
  if (authorizerUserId) {
    return authorizerUserId;
  }
  const contextUserId = request.context.userContext?.userId?.trim();
  const cognitoSub = identityId(request);
  if (contextUserId && contextUserId !== cognitoSub) {
    return contextUserId;
  }
  if (cognitoSub) {
    throw new UnauthorizedError('Authenticated user id is required');
  }
  throw new UnauthorizedError('Unauthorized');
}

export function authorizationHeader(request: LambdaRequest): string | undefined {
  return request.context.authHeader;
}

export function headerValue(request: LambdaRequest, name: string): string | undefined {
  const headers = request.event?.headers ?? {};
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}
