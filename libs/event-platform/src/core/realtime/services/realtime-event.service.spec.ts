/**
 * @jest-environment node
 */
import type { BaseEvent } from '../../../typings/base-event.types';
import type { RealtimePublisher } from '../interfaces/realtime-publisher.interface';
import type { RealtimeAggregationPublisher } from '../publishers/realtime-aggregation.publisher';
import { RealtimeEventService } from './realtime-event.service';

const baseEvent: BaseEvent<{ patientId: string }> = {
  eventId: 'evt-1',
  eventType: 'Alert.Created',
  eventVersion: '1.0.0',
  timestamp: '2026-01-01T00:00:00.000Z',
  source: 'alerts',
  idempotencyKey: 'idem-1',
  payload: { patientId: 'p1' },
  meta: { correlationId: 'corr-1' },
};

const config = {
  enabled: true,
  resolver: { resolve: async () => [{ userId: 'user-1', organizationId: 'ORG1' }] },
  transformer: {
    transform: () => ({
      channel: 'TEAM_ALERTS',
      eventType: 'TEAM_ALERTS_UPDATED',
      payload: { alertId: 'a1' },
      recipientIds: [],
    }),
  },
};

describe('RealtimeEventService', () => {
  it('publishes directly when aggregate=false', async () => {
    const published: unknown[] = [];
    const publisher: RealtimePublisher = {
      publish: async (messages) => {
        published.push(...messages);
      },
    };

    const service = new RealtimeEventService(publisher);
    await service.process({ event: baseEvent, config: { ...config, aggregate: false } });

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      channel: 'TEAM_ALERTS',
      recipientIds: ['user-1'],
    });
  });

  it('publishes to aggregation publisher when aggregate=true', async () => {
    const aggregated: unknown[] = [];
    const publisher: RealtimePublisher = { publish: jest.fn() };
    const aggregationPublisher: RealtimeAggregationPublisher = {
      publish: async (data) => {
        aggregated.push(data);
      },
    };

    const service = new RealtimeEventService(publisher, aggregationPublisher);
    await service.process({ event: baseEvent, config: { ...config, aggregate: true } });

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]).toMatchObject({
      recipients: [{ userId: 'user-1', organizationId: 'ORG1' }],
      metadata: {
        correlationId: 'corr-1',
        eventId: 'evt-1',
        eventType: 'Alert.Created',
      },
    });
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('skips aggregation when aggregate=true but no aggregation publisher', async () => {
    const publisher: RealtimePublisher = { publish: jest.fn() };
    const service = new RealtimeEventService(publisher);

    const result = await service.process({
      event: baseEvent,
      config: { ...config, aggregate: true },
    });

    expect(result.recipientCount).toBe(0);
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
