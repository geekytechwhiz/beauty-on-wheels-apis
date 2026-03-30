import type { APIGatewayProxyEvent } from 'aws-lambda';

/**
 * Prefer JWT-derived org from {@link buildRequestContext}, then authorizer / token fallback.
 * Matches user-service pattern (body / userContext) for multi-tenant APIs.
 */
export function resolveOrganizationIdFromRequest(req: {
  event: APIGatewayProxyEvent;
  context?: { userContext?: { organizationId?: string } };
}): string | undefined {
  const fromJwt = req.context?.userContext?.organizationId;
  if (fromJwt !== undefined && fromJwt !== null && String(fromJwt).trim() !== '') {
    return String(fromJwt);
  }
  return getAuthorizerOrganizationId(req.event);
}

/**
 * Aligns with device-service: authorizer context and JWT fallback.
 */
export function getAuthorizerOrganizationId(event: APIGatewayProxyEvent): string | undefined {
  const authorizer = (event.requestContext as { authorizer?: Record<string, unknown> })?.authorizer;

  const orgIdFromAuthorizer =
    authorizer?.organizationID ??
    authorizer?.organizationId ??
    (authorizer?.claims as Record<string, unknown> | undefined)?.['custom:organizationID'] ??
    (authorizer?.claims as Record<string, unknown> | undefined)?.['custom:organizationId'];

  if (typeof orgIdFromAuthorizer === 'string' && orgIdFromAuthorizer) {
    return orgIdFromAuthorizer;
  }

  const authHeader =
    event.headers?.Authorization ?? event.headers?.authorization ?? event.headers?.AUTHORIZATION;
  if (!authHeader) return undefined;

  try {
    const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim();
    const base64Url = token.split('.')[1];
    if (!base64Url) return undefined;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      Buffer.from(base64, 'base64')
        .toString()
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    const decoded = JSON.parse(jsonPayload) as Record<string, unknown>;
    return (
      (decoded['custom:organizationID'] as string) ??
      (decoded['custom:organizationId'] as string) ??
      (decoded.organizationID as string) ??
      (decoded.organizationId as string)
    );
  } catch {
    return undefined;
  }
}
