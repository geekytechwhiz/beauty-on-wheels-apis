import type { APIGatewayProxyEvent } from 'aws-lambda';
import { decodeJwtPayload, pickOrganizationIdFromJwtPayload } from '@api-hub/utils';

export function resolveOrganizationIdFromRequest(req: {
  event: APIGatewayProxyEvent;
  context?: { userContext?: { organizationId?: string } };
  params?: { organizationId?: string; organizationID?: string };
}): string | undefined {
  const fromJwt = req.context?.userContext?.organizationId;

  if (fromJwt !== undefined && fromJwt !== null && String(fromJwt).trim() !== '') {
    return String(fromJwt);
  }

  const fromParams = req.params?.organizationId ?? req.params?.organizationID;
  if (fromParams !== undefined && fromParams !== null && String(fromParams).trim() !== '') {
    return String(fromParams);
  }

  return getAuthorizerOrganizationId(req.event);
}

export function getAuthorizerOrganizationId(event: APIGatewayProxyEvent): string | undefined {
  const authorizer = (event.requestContext as { authorizer?: Record<string, unknown> })?.authorizer;

  const fromClaims = authorizer?.claims
    ? pickOrganizationIdFromJwtPayload(authorizer.claims as Record<string, unknown>)
    : undefined;

  const orgIdFromAuthorizer =
    (typeof authorizer?.organizationID === 'string' && authorizer.organizationID) ||
    (typeof authorizer?.organizationId === 'string' && authorizer.organizationId) ||
    (typeof authorizer?.tenantId === 'string' && authorizer.tenantId) ||
    fromClaims;

  if (typeof orgIdFromAuthorizer === 'string' && orgIdFromAuthorizer.trim() !== '') {
    return orgIdFromAuthorizer.trim();
  }

  const authHeader =
    event.headers?.Authorization ?? event.headers?.authorization ?? event.headers?.AUTHORIZATION;
  if (!authHeader) return undefined;

  const decoded = decodeJwtPayload(authHeader);
  return pickOrganizationIdFromJwtPayload(decoded);
}
