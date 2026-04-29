import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { extractAwsRequestId, extractCorrelationId } from '@api-hub/logger';
import { extractHeader } from '@api-hub/utils';

/**
 * Auth helpers aligned with **user-service** `apps/user-service/src/utils/helpers.ts`:
 * small getters from API Gateway authorizer, plus optional JWT decode from `Authorization` when claims are missing.
 *
 * Used from HTTP controllers only (`docs/http-api-implementation-guide.md` §4.1).
 */

/** Correlation + AWS ids once per invocation (handler + controller). */
export function getLambdaInvocationMeta(
  event: APIGatewayProxyEvent,
  context?: Context,
): { correlationId: string; awsRequestId: string } {
  return {
    correlationId: extractCorrelationId(event) || context?.awsRequestId || 'unknown',
    awsRequestId: context ? extractAwsRequestId(context) : (event.requestContext?.requestId ?? 'unknown'),
  };
}

export function getAuthorizerUserId(event: APIGatewayProxyEvent): string | undefined {
  const authorizer = (event.requestContext as { authorizer?: Record<string, unknown> })?.authorizer;
  return (authorizer?.userID ??
    authorizer?.userId ??
    (authorizer?.claims as Record<string, unknown> | undefined)?.['custom:userID']) as string | undefined;
}

export function getAuthorizerOrganizationId(event: APIGatewayProxyEvent): string | undefined {
  const authorizer = (event.requestContext as { authorizer?: Record<string, unknown> })?.authorizer;
  return (authorizer?.organizationID ??
    authorizer?.organizationId ??
    (authorizer?.claims as Record<string, unknown> | undefined)?.['custom:organizationID'] ??
    (authorizer?.claims as Record<string, unknown> | undefined)?.['custom:organizationId']) as string | undefined;
}

/**
 * Decode bearer JWT payload (no signature verify — API Gateway authorizer already validated the token).
 * Same shape as user-service `getUserIdAndOrganizationIdFromToken`.
 */
export function getUserIdAndOrganizationIdFromToken(authHeader: string | undefined): {
  userId?: string;
  organizationId?: string;
  sub?: string;
  /** Cognito `custom:userType` (e.g. STAFF, PATIENT). */
  userType?: string;
} {
  if (!authHeader || typeof authHeader !== 'string') return {};
  try {
    const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim();
    const base64Url = token.split('.')[1];
    if (!base64Url) return {};
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      Buffer.from(base64, 'base64')
        .toString()
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    const decoded = JSON.parse(jsonPayload) as Record<string, unknown>;
    return {
      userId:
        (decoded['custom:userID'] as string) ??
        (decoded['custom:userId'] as string) ??
        (decoded.userID as string) ??
        (decoded.userId as string),
      organizationId:
        (decoded['custom:organizationID'] as string) ??
        (decoded['custom:organizationId'] as string) ??
        (decoded.organizationID as string) ??
        (decoded.organizationId as string),
      sub: decoded.sub as string,
      userType:
        (decoded['custom:userType'] as string) ??
        (decoded['custom:usertype'] as string) ??
        (decoded.userType as string),
    };
  } catch {
    return {};
  }
}

/**
 * Reads `Authorization` the way API Gateway often sends it (single or multi-value headers, case-insensitive).
 * Use this for alert HTTP flows so user-service / org-service receive a bearer token on every call.
 */
export function getAuthorizationForGatewayEvent(event: APIGatewayProxyEvent): string | undefined {
  return extractHeader(event, 'Authorization') ?? undefined;
}

function resolveAuthHeader(event: APIGatewayProxyEvent, authHeader?: string): string | undefined {
  return authHeader ?? getAuthorizationForGatewayEvent(event);
}

/** Tenant id for the request: authorizer first, then JWT claims (never from body). */
export function getOrganizationIdForRequest(event: APIGatewayProxyEvent, authHeader?: string): string | undefined {
  return (
    getAuthorizerOrganizationId(event) ??
    getUserIdAndOrganizationIdFromToken(resolveAuthHeader(event, authHeader)).organizationId
  );
}

function readUserTypeFromAuthorizer(event: APIGatewayProxyEvent): string | undefined {
  const authorizer = (event.requestContext as { authorizer?: Record<string, unknown> })?.authorizer;
  const fromContext =
    authorizer?.userType ??
    authorizer?.user_type ??
    (authorizer?.claims as Record<string, unknown> | undefined)?.['custom:userType'] ??
    (authorizer?.['custom:userType'] as string | undefined);
  return typeof fromContext === 'string' && fromContext.length > 0 ? fromContext : undefined;
}

/**
 * Resolves org, actor, and userType for POST /alerts with **at most one** JWT payload decode when the authorizer
 * omits any of those fields.
 */
export function resolveCreateAlertIdentity(
  event: APIGatewayProxyEvent,
  authHeader?: string,
): {
  authHeader: string | undefined;
  orgId: string | undefined;
  actorUserId: string | undefined;
  userType: string | undefined;
} {
  const resolvedHeader = resolveAuthHeader(event, authHeader);
  let cached: ReturnType<typeof getUserIdAndOrganizationIdFromToken> | undefined;
  const claims = () => {
    if (cached === undefined) cached = getUserIdAndOrganizationIdFromToken(resolvedHeader);
    return cached;
  };
  return {
    authHeader: resolvedHeader,
    orgId: getAuthorizerOrganizationId(event) ?? claims().organizationId,
    userType: readUserTypeFromAuthorizer(event) ?? claims().userType,
    actorUserId: getAuthorizerUserId(event) ?? claims().userId ?? claims().sub,
  };
}

/** Patients cannot create operational alerts via this API. */
export function assertCreateAlertCallerAllowed(userType: string | undefined): void {
  if (!userType) return;
  const upper = userType.toUpperCase();
  if (upper === 'PATIENT' || upper === 'PATIENTS') {
    const e = new Error('Insufficient permission to create alerts');
    (e as Error & { statusCode?: number; code?: string }).statusCode = 403;
    (e as Error & { code?: string }).code = 'FORBIDDEN';
    throw e;
  }
}

/** @deprecated Prefer {@link resolveCreateAlertIdentity} + {@link assertCreateAlertCallerAllowed} in one pass. */
export function assertCanCreateAlerts(event: APIGatewayProxyEvent, authHeader?: string): void {
  assertCreateAlertCallerAllowed(resolveCreateAlertIdentity(event, authHeader).userType);
}

/** Current user id for audit (`performedBy`): authorizer first, then JWT `custom:userID` or `sub`. */
export function getActorUserIdForRequest(event: APIGatewayProxyEvent, authHeader?: string): string | undefined {
  const t = getUserIdAndOrganizationIdFromToken(resolveAuthHeader(event, authHeader));
  return getAuthorizerUserId(event) ?? t.userId ?? t.sub;
}
