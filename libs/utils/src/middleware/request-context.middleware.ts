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

  return {
    event,
    params: {
      ...event.pathParameters,
      ...event.queryStringParameters,
    },
    body,
    context: {
      authHeader,
      user,
    },
  };
};