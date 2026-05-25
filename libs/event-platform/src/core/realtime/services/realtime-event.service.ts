import { createLogger } from '@api-hub/observability';

import type { RealtimeAggregationPublisher } from '../publishers/realtime-aggregation.publisher';
import type { RealtimeProcessContext, RealtimeProcessResult } from '../types/realtime-context.type';
import {
  canPublishToOrgDestination,
  canPublishToRecipients,
  resolveRealtimeNotifyScope,
} from '../utils/realtime-notify-scope';

const logger = createLogger();

/** Enqueues realtime fan-out via SQS; socket delivery runs in the aggregation consumer. */
export class RealtimeEventService {
  constructor(private readonly aggregationPublisher?: RealtimeAggregationPublisher) {}

  async process(ctx: RealtimeProcessContext): Promise<RealtimeProcessResult> {
    const { event, config } = ctx;
    const correlationId = event.meta.correlationId;

    const recipients = await config.resolver.resolve(event);
    const recipientCount = recipients.length;

    const message = config.transformer.transform(event);
    message.recipientIds = recipients.map((r) => r.userId);

    const notifyScope = resolveRealtimeNotifyScope(message.payload);
    const orgTarget = canPublishToOrgDestination(message);
    const recipientTarget = canPublishToRecipients(message, recipientCount);

    if (!orgTarget && !recipientTarget) {
      logger.info({
        event: 'realtime.process',
        message: 'Realtime processing skipped — no targets for notify scope',
        correlationId,
        eventId: event.eventId,
        eventType: event.eventType,
        recipientCount,
        notifyScope,
        realtimeEnabled: config.enabled,
      });
      return { recipientCount: 0 };
    }

    if (!this.aggregationPublisher) {
      logger.warn({
        event: 'realtime.process',
        message: 'Realtime skipped — no aggregation publisher configured',
        correlationId,
        eventId: event.eventId,
        eventType: event.eventType,
        recipientCount,
        notifyScope,
        realtimeEnabled: config.enabled,
      });
      return { recipientCount: 0 };
    }

    await this.aggregationPublisher.publish({
      recipients,
      message,
      metadata: {
        correlationId,
        eventId: event.eventId,
        eventType: event.eventType,
        timestamp: event.timestamp,
      },
    });

    logger.info({
      event: 'realtime.process',
      message: 'Realtime aggregation message published',
      correlationId,
      eventId: event.eventId,
      eventType: event.eventType,
      recipientCount,
      notifyScope,
      organizationId: message.payload.organizationId,
      realtimeEnabled: config.enabled,
    });

    return { recipientCount };
  }
}
