import {
  BaseError,
  decodeJwtPayload,
  LambdaRequest,
  pickOrganizationIdFromJwtPayload,
  UserContext,
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

export const buildRequestContext = (event: RequestBuildEvent): LambdaRequest => {
  const authHeader =
    event.headers?.Authorization || event.headers?.authorization;

  const decoded = authHeader
    ? decodeJwtPayload(authHeader)
    : ({} as Record<string, unknown>);

  const user = {
    userId:
      decoded['custom:userID'] ||
      decoded.userId ||
      decoded.sub,
    organizationId: pickOrganizationIdFromJwtPayload(decoded),
  };

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
      correlationId: (event.requestContext as { correlationId?: string }).correlationId ?? '',
      awsRequestId: (event.requestContext as { awsRequestId?: string }).awsRequestId ?? '',
      logger: (event.requestContext as { logger?: any }).logger ?? {},
      authHeader,
      userContext: user as UserContext,
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
