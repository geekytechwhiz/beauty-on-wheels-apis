import {
  BaseError,
  LambdaRequest,
  UserContext,
  type AuthContext,
} from '@api-hub/utils';

import type { Middleware, MiddlewarePipelineEvent, RequestBuildEvent } from './types';
import { APIGatewayProxyEvent } from 'aws-lambda';

function parseEventBody(body: RequestBuildEvent['body']): unknown {
  if (body === undefined || body === null) {
    return body;
  }
  if (typeof body !== 'string') {
    return body;
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new BaseError(
      'Invalid JSON body',
      400,
      'INVALID_JSON',
      [{ message: 'Invalid JSON body' }],
      { retryable: false },
    );
  }
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    );
  }
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      return parseStringList(JSON.parse(trimmed) as unknown);
    } catch {
      return [];
    }
  }
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export const buildRequestContext = (event: RequestBuildEvent): LambdaRequest => {
  const authHeader =
    event.headers?.Authorization || event.headers?.authorization;

  const requestContext = event.requestContext as
    | {
        authorizer?: Record<string, unknown>;
        correlationId?: string;
        awsRequestId?: string;
        logger?: unknown;
      }
    | undefined;
  const authorizer = requestContext?.authorizer;
  const identityId = asString(authorizer?.identityId);
  const authorizerUserId = asString(authorizer?.userId);

  const user: UserContext = identityId
    ? {
        userId: authorizerUserId || identityId,
        identityId,
        roles: parseStringList(authorizer?.roles),
        permissions: parseStringList(authorizer?.permissions),
      }
    : {};

  const authContext: AuthContext | undefined = identityId
    ? {
        identityId,
        userId: authorizerUserId,
        roles: user.roles ?? [],
        permissions: user.permissions ?? [],
        claims: {},
      }
    : undefined;

  const directPayload = (event.data ?? event) as RequestBuildEvent;

  const resolvedUserId = directPayload.userId || directPayload.userID;

  const resolvedOrganizationId =
    directPayload.organizationId || directPayload.organizationID;

  const normalizedPathParameters =
    event.pathParameters ??
    (((resolvedUserId || resolvedOrganizationId) && {
      ...(resolvedUserId && { userId: String(resolvedUserId) }),
      ...(resolvedOrganizationId && {
        organizationId: String(resolvedOrganizationId),
      }),
    }) as Record<string, string> | undefined);

  const normalizedQueryParameters =
    event.queryStringParameters ?? undefined;

  return {
    event: event as unknown as APIGatewayProxyEvent,
    params: {
      ...(normalizedPathParameters ?? {}),
      ...(normalizedQueryParameters ?? {}),
    },
    pathParameters: normalizedPathParameters as Record<string, string> | undefined,
    body: parseEventBody(event.body),
    context: {
      correlationId: requestContext?.correlationId ?? '',
      awsRequestId: requestContext?.awsRequestId ?? '',
      logger: requestContext?.logger ?? {},
      authHeader,
      userContext: user,
      ...(authContext ? { authContext } : {}),
    },
  };
};

/** Runs before {@link buildRequestContext} in the HTTP pipeline so `event.body` is parsed once. */
export function requestParserMiddleware<
  TResult = unknown,
  TContext = unknown,
>(): Middleware<MiddlewarePipelineEvent, TResult, TContext> {
  return async ({ event, next }) => {
    const e = event as RequestBuildEvent;
    if (e?.body && typeof e.body === 'string') {
      try {
        e.body = JSON.parse(e.body);
      } catch {
        throw new BaseError(
          'Invalid JSON body',
          400,
          'INVALID_JSON',
          [{ message: 'Invalid JSON body' }],
          { retryable: false },
        );
      }
    }

    return next();
  };
}
