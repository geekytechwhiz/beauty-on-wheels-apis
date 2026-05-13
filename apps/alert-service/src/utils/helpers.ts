import type { APIGatewayProxyEvent } from 'aws-lambda';
import { decodeJwtPayload }  from '@api-hub/utils';

function readAuthorizer(event: APIGatewayProxyEvent): Record<string, unknown> | undefined {
  const authorizer = (event.requestContext as { authorizer?: Record<string, unknown> } | undefined)
    ?.authorizer;
  return authorizer && typeof authorizer === 'object' ? authorizer : undefined;
}

/**
 * User id for the request: API Gateway authorizer context first, then JWT claims (same claim keys as
 * {@link buildRequestContext} / user-service).
 */
export function getActorUserIdForRequest(
  event: APIGatewayProxyevent: any,
  authHeader: string | undefined,
): string | undefined {
  const authorizer = readAuthorizer(event);
  const fromAuth = authorizer
    ? (authorizer.userID ?? authorizer.userId ?? authorizer['custom:userID'])
    : undefined;
  if (typeof fromAuth === 'string' && fromAuth.trim()) return fromAuth.trim();

  const decoded = authHeader ? decodeJwtPayload(authHeader) : {};
  const userId =
    (decoded['custom:userID'] as string | undefined) ??
    (decoded['custom:userId'] as string | undefined) ??
    (decoded.userID as string | undefined) ??
    (decoded.userId as string | undefined) ??
    (decoded.sub as string | undefined);
  const trimmed = userId?.trim();
  return trimmed || undefined;
}

/**
 * Organization id for the request: authorizer context first, then JWT.
 */
export function getOrganizationIdForRequest(
  event: APIGatewayProxyevent: any,
  authHeader: string | undefined,
): string | undefined {
  const authorizer = readAuthorizer(event);
  const fromAuth = authorizer
    ? (authorizer.organizationID ?? authorizer.organizationId ?? authorizer['custom:organizationID'])
    : undefined;
  if (typeof fromAuth === 'string' && fromAuth.trim()) return fromAuth.trim();

  const decoded = authHeader ? decodeJwtPayload(authHeader) : {};
  const orgId =
    (decoded['custom:organizationID'] as string | undefined) ??
    (decoded['custom:organizationId'] as string | undefined) ??
    (decoded.organizationID as string | undefined) ??
    (decoded.organizationId as string | undefined);
  const trimmed = orgId?.trim();
  return trimmed || undefined;
}
