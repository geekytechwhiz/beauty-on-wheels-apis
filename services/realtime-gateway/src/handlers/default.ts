import type { APIGatewayProxyHandlerV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { createLogger, createChildLogger } from '@api-hub/logger';

const baseLogger = createLogger({ service: 'realtime-gateway', redactPII: true });

/**
 * Push-only: ignore client messages and return safe acknowledgement.
 */
export const main: APIGatewayProxyHandlerV2 = async (event) => {
  const connectionId = (event as APIGatewayProxyWebsocketEventV2).requestContext?.connectionId;
  const logger = createChildLogger(baseLogger, { connectionId });
  logger.info({ event: 'default_message_ignored' });
  return { statusCode: 200, body: JSON.stringify({ ack: true }) };
};
