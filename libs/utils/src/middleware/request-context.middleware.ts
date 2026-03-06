import { decodeJwtPayload } from '../helper/jwt.helpers';

export const buildRequestContext = (event: any) => {
  const authHeader =
    event.headers?.Authorization || event.headers?.authorization;

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
   * For non-API Gateway invocations (e.g. direct Lambda invoke) where
   * identifiers are sent at the top level of the event, we also map
   * `event.userId` / `event.organizationId` into pathParameters.
   */
  const normalizedPathParameters =
    event.pathParameters ??
    (((event.userId || event.organizationId) && {
      ...(event.userId && { userId: String(event.userId) }),
      ...(event.organizationId && { organizationId: String(event.organizationId) }),
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