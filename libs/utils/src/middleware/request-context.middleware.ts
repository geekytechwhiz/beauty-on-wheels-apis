export const buildRequestContext = (event: any) => {
  const authHeader =
    event.headers?.Authorization || event.headers?.authorization;

  const authorizer = event.requestContext?.authorizer as
    | Record<string, unknown>
    | undefined;
  const identityId =
    typeof authorizer?.identityId === 'string' && authorizer.identityId.trim()
      ? authorizer.identityId.trim()
      : undefined;
  const authorizerUserId =
    typeof authorizer?.userId === 'string' && authorizer.userId.trim()
      ? authorizer.userId.trim()
      : undefined;

  const user = identityId
    ? {
        userId: authorizerUserId || identityId,
        identityId,
      }
    : {};

  let body: any = undefined;
  if (event.body != null) {
    try {
      let rawBody = event.body;
      if (event.isBase64Encoded && typeof rawBody === 'string') {
        rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
      }
      body = typeof rawBody === 'string' ? JSON.parse(rawBody || '{}') : rawBody;
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