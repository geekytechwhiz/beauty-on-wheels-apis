import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { TemplateActorUser } from '@api-hub/template-core';
import { decodeJwtPayload } from '@api-hub/utils';


export function getActorUserIdForRequest(
  event: APIGatewayProxyEvent,
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
  return userId?.trim() || undefined;
}


function readAuthorizer(
  event: APIGatewayProxyEvent,
): Record<string, unknown> | undefined {
  const authorizer = (
    event.requestContext as { authorizer?: Record<string, unknown> } | undefined
  )?.authorizer;
  return authorizer && typeof authorizer === 'object' ? authorizer : undefined;
}

function firstClaim(
  decoded: Record<string, unknown>,
  authorizer: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const fromAuth = authorizer?.[key];
    if (typeof fromAuth === 'string' && fromAuth.trim()) return fromAuth.trim();
    const fromJwt = decoded[key];
    if (typeof fromJwt === 'string' && fromJwt.trim()) return fromJwt.trim();
  }
  return undefined;
}

const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Skip Cognito internal ids / hashes when picking a human-readable display name. */
function isOpaqueIdentifier(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (UUID_LIKE.test(v)) return true;
  if (/^[0-9a-f]{32,}$/i.test(v)) return true;
  return false;
}

function resolveDisplayName(
  decoded: Record<string, unknown>,
  authorizer: Record<string, unknown> | undefined,
  email?: string,
): string | undefined {
  const given = firstClaim(decoded, authorizer, ['given_name', 'custom:given_name']);
  const family = firstClaim(decoded, authorizer, ['family_name', 'custom:family_name']);
  const fullName = [given, family].filter(Boolean).join(' ').trim();
  if (fullName && !isOpaqueIdentifier(fullName)) return fullName;

  const usernameCandidates = [
    'preferred_username',
    'custom:preferred_username',
    'cognito:username',
    'username',
    'custom:username',
    'userName',
    'custom:userName',
  ];
  for (const key of usernameCandidates) {
    const value = firstClaim(decoded, authorizer, [key]);
    if (value && !isOpaqueIdentifier(value)) return value;
  }

  for (const key of ['name', 'custom:name', 'displayName', 'custom:displayName']) {
    const value = firstClaim(decoded, authorizer, [key]);
    if (value && !isOpaqueIdentifier(value)) return value;
  }

  return email;
}

/**
 * Resolved actor for audit fields (createdBy, lastModifiedBy, publishedBy).
 * Built only from the access token / authorizer — not from the request body.
 */
export function getActorUserForRequest(
  event: APIGatewayProxyEvent,
  authHeader: string | undefined,
): TemplateActorUser | undefined {
  const userId = getActorUserIdForRequest(event, authHeader);
  if (!userId) return undefined;

  const authorizer = readAuthorizer(event);
  const decoded = (authHeader ? decodeJwtPayload(authHeader) : {}) as Record<string, unknown>;

  const email = firstClaim(decoded, authorizer, [
    'email',
    'custom:src',
    'custom:email',
    'userEmail',
  ]);
  const displayName = resolveDisplayName(decoded, authorizer, email);
  const role = firstClaim(decoded, authorizer, ['custom:role', 'role']);

  return {
    userId,
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {}),
    ...(role ? { role } : {}),
  };
}

export function getOrganizationIdForRequest(
  event: APIGatewayProxyEvent,
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
  return orgId?.trim() || undefined;
}
