import {
  createLogger,
  recordAggregationEventsPublished,
  recordAggregationEventsReceived,
  recordAggregationGroupsCreated,
} from '@api-hub/observability';

import type { RealtimePublisher } from '../interfaces/realtime-publisher.interface';
import type { RealtimeAggregateMessage } from '../types/realtime-aggregate-message.type';
import type { RealtimeMessage } from '../types/realtime-message.type';

const logger = createLogger();

export class RealtimeAggregationService {
  constructor(private readonly realtimePublisher: RealtimePublisher) {}

  buildGroupKey(message: RealtimeAggregateMessage): string {
    const organizationId =
      message.recipients.find((r) => r.organizationId)?.organizationId ?? 'unknown';
    const { channel, eventType } = message.message;
    return `${organizationId}#${channel}#${eventType}`;
  }

  groupMessages(messages: RealtimeAggregateMessage[]): Map<string, RealtimeAggregateMessage[]> {
    const groups = new Map<string, RealtimeAggregateMessage[]>();

    for (const message of messages) {
      const key = this.buildGroupKey(message);
      const existing = groups.get(key);
      if (existing) {
        existing.push(message);
      } else {
        groups.set(key, [message]);
      }
    }

    return groups;
  }

  buildAggregatedMessage(group: RealtimeAggregateMessage[]): RealtimeMessage {
    const first = group[0];
    const recipientIds = [
      ...new Set(group.flatMap((item) => item.message.recipientIds)),
    ];

    return {
      channel: first.message.channel,
      eventType: first.message.eventType,
      recipientIds,
      payload: {
        type: first.message.eventType,
        count: group.length,
      },
    };
  }

  async groupAndPublish(messages: RealtimeAggregateMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    const batchSize = messages.length;
    recordAggregationEventsReceived(batchSize);

    const groups = this.groupMessages(messages);
    recordAggregationGroupsCreated(groups.size);

    const aggregatedMessages: RealtimeMessage[] = [];

    for (const [groupKey, group] of groups) {
      const aggregated = this.buildAggregatedMessage(group);
      aggregatedMessages.push(aggregated);

      logger.info({
        event: 'realtime.aggregation.group',
        message: 'Realtime aggregation group created',
        correlationId: group[0]?.metadata.correlationId,
        eventType: group[0]?.message.eventType,
        groupKey,
        groupSize: group.length,
        batchSize,
      });
    }

    await this.realtimePublisher.publish(aggregatedMessages);
    recordAggregationEventsPublished(aggregatedMessages.length);

    logger.info({
      event: 'realtime.aggregation.publish',
      message: 'Aggregated realtime messages published',
      batchSize,
      groupCount: groups.size,
      publishedCount: aggregatedMessages.length,
    });
  }
}
