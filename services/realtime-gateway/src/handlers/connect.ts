import type { APIGatewayProxyWebsocketHandlerV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { createLogger, createChildLogger } from '@api-hub/logger';
import { saveConnection } from '../repositories/connection.repository';
import { getAuthProvider } from '../auth/auth.registry';
import { connectionQuerySchema } from '../validation/connection.schema';
import type { ConnectionContext } from '../models/connectionContext';

const baseLogger = createLogger({ service: 'realtime-gateway', redactPII: true });

/**
 * Authenticate via selected provider (JWT, OAuth, etc.) and build connection context.
 * Token is required; authType selects provider (default jwt).
 */
async function getConnectionContextFromRequest(
  event: APIGatewayProxyWebsocketEventV2
): Promise<ConnectionContext | null> {
   
  // WebSocket $connect: query params exist at runtime but are not on the typed interface
  const qs = (event as APIGatewayProxyWebsocketEventV2 & { queryStringParameters?: Record<string, string> }).queryStringParameters ?? {};
  const parsed = connectionQuerySchema.safeParse({
    token: qs.token ?? qs.Token,
    authType: qs.authType ?? qs.auth_type,
    userId: qs.userId ?? qs.user_id,
    orgId: qs.orgId ?? qs.org_id,
    roles: qs.roles,
  });
  if (!parsed.success) return null;

  const { token, authType } = parsed.data;
  if (!token || token.trim().length === 0) return null;

  const provider = getAuthProvider(authType);
  const authContext = await provider.authenticate(token.trim(), {
    correlationId: event.requestContext.connectionId,
  });

  if (!authContext) return null;

  return {
    connectionId: event.requestContext.connectionId,
    userId: authContext.userId,
    orgId: authContext.orgId,
    roles: authContext.roles,
    connectedAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  };
}

export const main: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const logger = createChildLogger(baseLogger, { connectionId });

  let context: ConnectionContext | null = null;
  try {
    context = await getConnectionContextFromRequest(event);
  } catch (err) {
    logger.warn({ event: 'connect_auth_failed', reason: 'context_parse_error', err });
    return { statusCode: 401, body: 'Unauthorized' };
  }

  if (!context) {
    logger.warn({ event: 'connect_auth_failed', reason: 'missing_or_invalid_token' });
    return { statusCode: 401, body: 'Unauthorized' };
  }

  try {
    await saveConnection(context);
    logger.info({
      event: 'connect_success',
      userId: context.userId,
      orgId: context.orgId,
      roles: context.roles,
    });
    return { statusCode: 200, body: 'Connected' };
  } catch (err) {
    logger.error({ event: 'connect_failed', err });
    return { statusCode: 500, body: 'Internal error' };
  }
};
