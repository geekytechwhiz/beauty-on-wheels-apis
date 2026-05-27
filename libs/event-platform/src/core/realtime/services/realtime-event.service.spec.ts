/**
 * @jest-environment node
 */
import type { BaseEvent } from '../../../typings/base-event.types';
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
      payload: { alertId: 'a1', realtimeNotifyScope: 'RECIPIENTS' },
      recipientIds: [],
    }),
  },
};

describe('RealtimeEventService', () => {
  it('publishes to aggregation queue', async () => {
    const aggregated: unknown[] = [];
    const aggregationPublisher: RealtimeAggregationPublisher = {
      publish: async (data) => {
        aggregated.push(data);
      },
    };

    const service = new RealtimeEventService(aggregationPublisher);
    await service.process({ event: baseEvent, config });

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]).toMatchObject({
      recipients: [{ userId: 'user-1', organizationId: 'ORG1' }],
      metadata: {
        correlationId: 'corr-1',
        eventId: 'evt-1',
        eventType: 'Alert.Created',
        eventVersion: '1.0.0',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('publishes org broadcast when resolver returns no recipients but message has organizationId', async () => {
    const aggregated: unknown[] = [];
    const aggregationPublisher: RealtimeAggregationPublisher = {
      publish: async (data) => {
        aggregated.push(data);
      },
    };

    const service = new RealtimeEventService(aggregationPublisher);
    await service.process({
      event: { ...baseEvent, payload: { patientId: 'p1', organizationId: 'org-1' } },
      config: {
        ...config,
        resolver: { resolve: async () => [] },
        transformer: {
          transform: () => ({
            channel: 'ALERTS',
            eventType: 'TEAM_ALERTS_UPDATED',
            payload: { organizationId: 'org-1', realtimeNotifyScope: 'ORG' },
            recipientIds: [],
          }),
        },
      },
    });

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]).toMatchObject({
      recipients: [],
      message: {
        channel: 'ALERTS',
        recipientIds: [],
        payload: { organizationId: 'org-1' },
      },
    });
  });

  it('skips when no aggregation publisher is configured', async () => {
    const service = new RealtimeEventService();

    const result = await service.process({ event: baseEvent, config });

    expect(result.recipientCount).toBe(0);
  });
});
