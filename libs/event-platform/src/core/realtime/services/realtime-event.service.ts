import { createLogger } from '@api-hub/observability';

import type { RealtimePublisher } from '../interfaces/realtime-publisher.interface';
import type { RealtimeAggregationPublisher } from '../publishers/realtime-aggregation.publisher';
import type { RealtimeProcessContext, RealtimeProcessResult } from '../types/realtime-context.type';

const logger = createLogger();

export class RealtimeEventService {
  constructor(
    private readonly publisher: RealtimePublisher,
    private readonly aggregationPublisher?: RealtimeAggregationPublisher,
  ) {}

  async process(ctx: RealtimeProcessContext): Promise<RealtimeProcessResult> {
    const { event, config } = ctx;
    const correlationId = event.meta.correlationId;

    const recipients = await config.resolver.resolve(event);
    const recipientCount = recipients.length;

    if (recipientCount === 0) {
      logger.info({
        event: 'realtime.process',
        message: 'Realtime processing skipped — no recipients',
        correlationId,
        eventId: event.eventId,
        eventType: event.eventType,
        recipientCount: 0,
        realtimeEnabled: config.enabled,
      });
      return { recipientCount: 0 };
    }

    const message = config.transformer.transform(event);
    message.recipientIds = recipients.map((r) => r.userId);

    if (config.aggregate) {
      if (!this.aggregationPublisher) {
        logger.warn({
          event: 'realtime.process',
          message: 'aggregate enabled but no aggregation publisher configured',
          correlationId,
          eventId: event.eventId,
          eventType: event.eventType,
          recipientCount,
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
        realtimeEnabled: config.enabled,
        aggregate: true,
      });

      return { recipientCount };
    }

    await this.publisher.publish([message]);

    logger.info({
      event: 'realtime.process',
      message: 'Realtime messages published',
      correlationId,
      eventId: event.eventId,
      eventType: event.eventType,
      recipientCount,
      realtimeEnabled: config.enabled,
    });

    return { recipientCount };
  }
}
