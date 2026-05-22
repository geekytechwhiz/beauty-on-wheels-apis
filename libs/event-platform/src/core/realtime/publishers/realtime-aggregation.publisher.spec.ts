/**
 * @jest-environment node
 */
import { EventPublisher } from '../../../sdk/publisher/event-publisher';
import { REALTIME_AGGREGATE_EVENT_TYPE } from '../schemas/realtime-aggregate.event';
import type { RealtimeAggregateMessage } from '../types/realtime-aggregate-message.type';
import { RealtimeAggregationPublisher } from './realtime-aggregation.publisher';

jest.mock('@api-hub/observability', () => {
  const actual = jest.requireActual('@api-hub/observability');
  return {
    ...actual,
    getLoggerContext: () => ({ correlationId: 'corr-ctx' }),
  };
});

describe('RealtimeAggregationPublisher', () => {
  const sampleData: RealtimeAggregateMessage = {
    recipients: [{ userId: 'user-1', organizationId: 'ORG1' }],
    message: {
      channel: 'TEAM_ALERTS',
      eventType: 'TEAM_ALERTS_UPDATED',
      payload: { alertId: 'a1' },
      recipientIds: ['user-1'],
    },
    metadata: {
      correlationId: 'corr-1',
      eventId: 'evt-1',
      eventType: 'Alert.Created',
      timestamp: '2026-01-01T00:00:00.000Z',
    },
  };

  it('delegates to EventPublisher with correct envelope', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const eventPublisher = { publish } as unknown as EventPublisher;
    const publisher = new RealtimeAggregationPublisher(eventPublisher, 'test-service');

    await publisher.publish(sampleData);

    expect(publish).toHaveBeenCalledWith({
      eventType: REALTIME_AGGREGATE_EVENT_TYPE,
      version: '1.0.0',
      source: 'test-service',
      payload: sampleData,
      meta: { correlationId: 'corr-1' },
    });
  });

  it('propagates publisher failure', async () => {
    const eventPublisher = {
      publish: jest.fn().mockRejectedValue(new Error('sqs failed')),
    } as unknown as EventPublisher;
    const publisher = new RealtimeAggregationPublisher(eventPublisher);

    await expect(publisher.publish(sampleData)).rejects.toThrow('sqs failed');
  });
});
