import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { CanonicalLabWebhookResult } from '@api-hub/lab-integration';
import type { Logger } from '@api-hub/logger';

const SOURCE = 'partner-integration';

function getEventBusName(): string {
  return process.env.EVENT_BUS_NAME ?? 'default';
}

/**
 * Publish a canonical lab webhook result to EventBridge.
 * Source: partner-integration, DetailType: eventType, Detail: JSON of payload (eventId, eventType, detail, partnerId).
 */
export async function publishLabEvent(
  payload: CanonicalLabWebhookResult,
  logger: Logger
): Promise<void> {
  const client = new EventBridgeClient({});
  const eventBusName = getEventBusName();
  const detail = JSON.stringify({
    eventId: payload.eventId,
    eventType: payload.eventType,
    detail: payload.detail,
    partnerId: payload.partnerId,
  });

  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: SOURCE,
          DetailType: payload.eventType,
          Detail: detail,
          EventBusName: eventBusName === 'default' ? undefined : eventBusName,
        },
      ],
    })
  );
  logger.info({
    event: 'lab_webhook_published',
    eventId: payload.eventId,
    eventType: payload.eventType,
    partnerId: payload.partnerId,
  });
}
