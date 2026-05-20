import type { EventBridgeEvent } from 'aws-lambda';

import { createLogger } from '@api-hub/observability';

const logger = createLogger({ service: 'alert-service', redactPII: true });

type OutboundDetail = {
  eventId?: string;
  eventType?: string;
  meta?: { correlationId?: string; tenantId?: string };
};

/**
 * Dev/diagnostic consumer: logs outbound alert-service EventBridge events on the bus.
 */
export async function main(event: EventBridgeEvent<string, OutboundDetail>): Promise<void> {
  logger.info({
    event: 'alert_outbound_echo',
    source: event.source,
    detailType: event['detail-type'],
    eventId: event.detail?.eventId,
    eventType: event.detail?.eventType,
    correlationId: event.detail?.meta?.correlationId,
    tenantId: event.detail?.meta?.tenantId,
  });
}

export const handler = main;
