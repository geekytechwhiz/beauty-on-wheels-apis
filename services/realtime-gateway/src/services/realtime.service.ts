import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import { findConnectionsByOrgId } from '../repositories/connection.repository';
import type { WebSocketEvent } from '../models/websocketEvent';

const baseLogger = createLogger({ service: 'realtime-gateway', redactPII: true });

const BATCH_SIZE = 25;

/**
 * Deliver a UI-friendly WebSocket event to all connections for the given orgId.
 * Authorizes per orgId: only connections belonging to that org receive the event.
 */
export async function deliverToOrg(
  orgId: string,
  event: WebSocketEvent<unknown>,
  logger: ReturnType<typeof createChildLogger>
): Promise<{ delivered: number; failed: number }> {
  const endpoint = process.env.WEBSOCKET_ENDPOINT;
  if (!endpoint) {
    logger.warn({ event: 'delivery_skipped', reason: 'WEBSOCKET_ENDPOINT not set', orgId });
    return { delivered: 0, failed: 0 };
  }

  const connections = await findConnectionsByOrgId(orgId);
  if (connections.length === 0) {
    logger.info({ event: 'delivery_no_connections', orgId });
    return { delivered: 0, failed: 0 };
  }

  const payload = JSON.stringify(event);
  const api = new ApiGatewayManagementApiClient({
    endpoint,
    region: process.env.REGION ?? 'us-east-1',
  });

  let delivered = 0;
  let failed = 0;

  for (let i = 0; i < connections.length; i += BATCH_SIZE) {
    const batch = connections.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(({ connectionId }) =>
        api.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: Buffer.from(payload, 'utf-8'),
          })
        )
      )
    );
    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        delivered += 1;
      } else {
        failed += 1;
        const connId = batch[idx]!.connectionId;
        const err = result.reason as { statusCode?: number };
        if (err.statusCode === 410 || err.statusCode === 403) {
          logger.info({ event: 'delivery_connection_gone', connectionId: connId, orgId });
        } else {
          logger.warn({
            event: 'delivery_failed',
            connectionId: connId,
            orgId,
            err: serializeError(result.reason),
          });
        }
      }
    });
  }

  logger.info({
    event: 'delivery_complete',
    orgId,
    eventType: event.type,
    delivered,
    failed,
    total: connections.length,
  });

  return { delivered, failed };
}
