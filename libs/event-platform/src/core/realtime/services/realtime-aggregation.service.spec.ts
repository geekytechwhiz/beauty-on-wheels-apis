/**
 * @jest-environment node
 */
import type { RealtimePublisher } from '../interfaces/realtime-publisher.interface';
import type { RealtimeAggregateMessage } from '../types/realtime-aggregate-message.type';
import { RealtimeAggregationService } from './realtime-aggregation.service';

function sampleMessage(
  overrides: Partial<RealtimeAggregateMessage> & {
    organizationId?: string;
    channel?: string;
    eventType?: string;
    userId?: string;
  } = {},
): RealtimeAggregateMessage {
  const organizationId = overrides.organizationId ?? 'ORG1';
  const channel = overrides.channel ?? 'TEAM_ALERTS';
  const eventType = overrides.eventType ?? 'TEAM_ALERTS_UPDATED';
  const userId = overrides.userId ?? 'user-1';

  return {
    recipients: [{ userId, organizationId }],
    message: {
      channel,
      eventType,
      payload: { alertId: 'a1' },
      recipientIds: [userId],
    },
    metadata: {
      correlationId: 'corr-1',
      eventId: 'evt-1',
      eventType: 'Alert.Created',
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('RealtimeAggregationService', () => {
  it('builds group key from organizationId, channel, and eventType', () => {
    const publisher: RealtimePublisher = { publish: jest.fn() };
    const service = new RealtimeAggregationService(publisher);

    const key = service.buildGroupKey(sampleMessage());
    expect(key).toBe('ORG1#TEAM_ALERTS#TEAM_ALERTS_UPDATED');
  });

  it('groups messages and publishes aggregated payload with count', async () => {
    const published: unknown[] = [];
    const publisher: RealtimePublisher = {
      publish: async (messages) => {
        published.push(...messages);
      },
    };
    const service = new RealtimeAggregationService(publisher);

    const messages = [
      sampleMessage({ userId: 'user-1' }),
      sampleMessage({ userId: 'user-2' }),
      sampleMessage({ userId: 'user-3' }),
    ];

    await service.groupAndPublish(messages);

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      channel: 'TEAM_ALERTS',
      eventType: 'TEAM_ALERTS_UPDATED',
      recipientIds: ['user-1', 'user-2', 'user-3'],
      payload: { type: 'TEAM_ALERTS_UPDATED', count: 3 },
    });
  });

  it('creates separate groups for different keys', async () => {
    const published: unknown[] = [];
    const publisher: RealtimePublisher = {
      publish: async (messages) => {
        published.push(...messages);
      },
    };
    const service = new RealtimeAggregationService(publisher);

    await service.groupAndPublish([
      sampleMessage({ organizationId: 'ORG1' }),
      sampleMessage({ organizationId: 'ORG2' }),
    ]);

    expect(published).toHaveLength(2);
  });

  it('deduplicates recipientIds within a group', async () => {
    const published: unknown[] = [];
    const publisher: RealtimePublisher = {
      publish: async (messages) => {
        published.push(...messages);
      },
    };
    const service = new RealtimeAggregationService(publisher);

    await service.groupAndPublish([
      sampleMessage({ userId: 'user-1' }),
      sampleMessage({ userId: 'user-1' }),
    ]);

    expect(published[0]).toMatchObject({
      recipientIds: ['user-1'],
      payload: { count: 2 },
    });
  });

  it('groups org-only messages using payload organizationId when recipients are empty', async () => {
    const publisher: RealtimePublisher = { publish: jest.fn() };
    const service = new RealtimeAggregationService(publisher);

    const key = service.buildGroupKey({
      recipients: [],
      message: {
        channel: 'ALERTS',
        eventType: 'alert.created.processed',
        recipientIds: [],
        payload: { organizationId: 'org-1', realtimeNotifyScope: 'ORG' },
      },
      metadata: {
        correlationId: 'corr-1',
        eventId: 'evt-1',
        eventType: 'CreateAlert.v1',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(key).toBe('org-1#ALERTS#alert.created.processed');
  });

  it('preserves organizationId on aggregated payload for org socket routing', async () => {
    const published: unknown[] = [];
    const publisher: RealtimePublisher = {
      publish: async (messages) => {
        published.push(...messages);
      },
    };
    const service = new RealtimeAggregationService(publisher);

    await service.groupAndPublish([
      {
        recipients: [],
        message: {
          channel: 'ALERTS',
          eventType: 'alert.created.processed',
          recipientIds: [],
          payload: { organizationId: 'org-1', realtimeNotifyScope: 'ORG' },
        },
        metadata: {
          correlationId: 'corr-1',
          eventId: 'evt-1',
          eventType: 'CreateAlert.v1',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      },
    ]);

    expect(published[0]).toMatchObject({
      channel: 'ALERTS',
      recipientIds: [],
      payload: {
        organizationId: 'org-1',
        count: 1,
      },
    });
  });

  it('propagates publisher failure', async () => {
    const publisher: RealtimePublisher = {
      publish: async () => {
        throw new Error('publish failed');
      },
    };
    const service = new RealtimeAggregationService(publisher);

    await expect(service.groupAndPublish([sampleMessage()])).rejects.toThrow('publish failed');
  });
});
