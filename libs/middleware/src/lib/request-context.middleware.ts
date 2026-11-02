import {
  BaseError,
  LambdaRequest,
  UserContext,
  type AuthContext,
} from '@api-hub/utils';

import type {
  Middleware,
  MiddlewarePipelineEvent,
  RequestBuildEvent,
} from './types';
import { APIGatewayProxyEvent } from 'aws-lambda';

type UnknownRecord = Record<string, unknown>;

type RequestContextShape = {
  authorizer?: unknown;
  correlationId?: unknown;
  awsRequestId?: unknown;
  logger?: unknown;
};

function asRecord(value: unknown): UnknownRecord | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as UnknownRecord;
}

function readPhoneVerified(value: unknown): boolean | undefined {
  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  return undefined;
}

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
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 0,
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

/**
 * API Gateway authorizer data can arrive in different shapes:
 *
 * HTTP API JWT authorizer:
 *   requestContext.authorizer.jwt.claims
 *
 * HTTP API Lambda authorizer:
 *   requestContext.authorizer.lambda
 *
 * REST API Cognito authorizer:
 *   requestContext.authorizer.claims
 *
 * REST API Lambda authorizer:
 *   requestContext.authorizer (flat context)
 */
function getAuthorizerData(authorizerValue: unknown): {
  principal: UnknownRecord;
  claims: UnknownRecord;
} {
  const authorizer = asRecord(authorizerValue) ?? {};
  const jwt = asRecord(authorizer.jwt);
  const jwtClaims = asRecord(jwt?.claims);

  const lambdaContext = asRecord(authorizer.lambda);
  const restClaims = asRecord(authorizer.claims);
  const nestedContext = asRecord(authorizer.context);

  // Prefer claims supplied by the verified JWT authorizer. For Lambda
  // authorizers, use their returned context. Keep flat context as fallback.
  const principal: UnknownRecord = {
    ...authorizer,
    ...(nestedContext ?? {}),
    ...(lambdaContext ?? {}),
    ...(restClaims ?? {}),
    ...(jwtClaims ?? {}),
  };

  const claims =
    jwtClaims ?? restClaims ?? lambdaContext ?? nestedContext ?? authorizer;

  return { principal, claims };
}

export const buildRequestContext = (
  event: RequestBuildEvent,
): LambdaRequest => {
  const authHeader =
    event.headers?.Authorization || event.headers?.authorization;

  const requestContext = asRecord(event.requestContext) as
    | RequestContextShape
    | undefined;

  const { principal, claims } = getAuthorizerData(requestContext?.authorizer);

  // `userId` is the application user ID. `identityId`/`sub` identifies the
  // Cognito identity and must not be used as a substitute for the app user ID.
  const userId = asString(
    principal.userId ??
      principal.userID ??
      principal['custom:userId'] ??
      principal['custom:userID'],
  );

  const identityId = asString(
    principal.identityId ?? principal.identity_id ?? principal.sub,
  );

  const rolesFromList = parseStringList(principal.roles);
  const roles =
    rolesFromList.length > 0 ? rolesFromList : parseStringList(principal.role);

  const permissionsFromList = parseStringList(principal.permissions);
  const permissions =
    permissionsFromList.length > 0
      ? permissionsFromList
      : parseStringList(principal.permission);

  const user: UserContext =
    userId || identityId
      ? {
          ...(userId ? { userId } : {}),
          ...(identityId ? { identityId } : {}),
          roles,
          permissions,
        }
      : {};

  const phoneNumber = asString(principal.phoneNumber ?? principal.phone_number);

  const phoneVerified = readPhoneVerified(
    principal.phoneVerified ??
      principal.phone_number_verified ??
      principal['custom:phoneVerified'],
  );

  const authContext: AuthContext | undefined = identityId
    ? {
        identityId,
        userId,
        roles,
        permissions,
        claims: claims as AuthContext['claims'],
        ...(phoneNumber ? { phoneNumber } : {}),
        ...(phoneVerified !== undefined ? { phoneVerified } : {}),
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

  const normalizedQueryParameters = event.queryStringParameters ?? undefined;

  return {
    event: event as unknown as APIGatewayProxyEvent,
    params: {
      ...(normalizedPathParameters ?? {}),
      ...(normalizedQueryParameters ?? {}),
    },
    pathParameters: normalizedPathParameters as
      | Record<string, string>
      | undefined,
    body: parseEventBody(event.body),
    context: {
      correlationId: asString(requestContext?.correlationId) ?? '',
      awsRequestId: asString(requestContext?.awsRequestId) ?? '',
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
