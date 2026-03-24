import { decodeJwtPayload } from '../helper/jwt.helpers';

const getHeaderValueCaseInsensitive = (headers?: Record<string, unknown>, headerName = 'authorization'): string | undefined => {
  if (!headers || typeof headers !== 'object') return undefined;
  const normalizedHeaderName = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== normalizedHeaderName) continue;
    if (typeof value === 'string' && value.trim()) return value;
    if (Array.isArray(value)) {
      const firstString = value.find((item) => typeof item === 'string' && item.trim()) as string | undefined;
      if (firstString) return firstString;
    }
  }
  return undefined;
};

export const buildRequestContext = (event: any) => {
  const authHeader =
    getHeaderValueCaseInsensitive(event.headers, 'authorization') ||
    getHeaderValueCaseInsensitive(event.multiValueHeaders, 'authorization');

  const decoded = authHeader ? decodeJwtPayload(authHeader) : {};

  const user = {
    userId:
      decoded?.['custom:userID'] ||
      decoded?.userId ||
      decoded?.sub,
    organizationId:
      decoded?.['custom:organizationID'] ||
      decoded?.organizationId,
  };

  let body: any = undefined;
  if (event.body != null) {
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body;
    } catch {
      body = undefined;
    }
  }

  /**
   * Normalise path/query parameters so handlers can rely on:
   * - req.pathParameters
   * - req.params (merged path + query)
   *
   * Supports three direct-Lambda invocation shapes:
   *   1. API Gateway  → event.pathParameters / event.queryStringParameters
   *   2. Top-level    → { userId, userID, organizationId, organizationID }
   *   3. Nested data  → { data: { userID, organizationID, userId, organizationId } }
   *                     (common pattern when invoking via a lambda-invoker utility)
   */
  const directPayload = event.data ?? event; // unwrap { data: {...} } wrapper if present

  const resolvedUserId =
    directPayload.userId ||
    directPayload.userID;

  const resolvedOrganizationId =
    directPayload.organizationId ||
    directPayload.organizationID;

  const normalizedPathParameters =
    event.pathParameters ??
    (((resolvedUserId || resolvedOrganizationId) && {
      ...(resolvedUserId && { userId: String(resolvedUserId) }),
      ...(resolvedOrganizationId && { organizationId: String(resolvedOrganizationId) }),
    }) as Record<string, string> | undefined);

  const normalizedQueryParameters = event.queryStringParameters ?? undefined;

  return {
    event,
    params: {
      ...(normalizedPathParameters ?? {}),
      ...(normalizedQueryParameters ?? {}),
    },
    pathParameters: normalizedPathParameters,
    body,
    context: {
      authHeader,
      userContext: user,
    },
  };
};