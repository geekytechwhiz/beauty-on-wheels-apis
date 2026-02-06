import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { createLogger, createChildLogger } from '@api-hub/logger';
import { deleteConnection } from '../repositories/connection.repository';

const baseLogger = createLogger({ service: 'realtime-gateway', redactPII: true });

export const main: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const logger = createChildLogger(baseLogger, { connectionId });

  try {
    await deleteConnection(connectionId);
    logger.info({ event: 'disconnect_success' });
    return { statusCode: 200, body: 'Disconnected' };
  } catch (err) {
    logger.error({ event: 'disconnect_failed', err });
    return { statusCode: 200, body: 'OK' };
  }
};
