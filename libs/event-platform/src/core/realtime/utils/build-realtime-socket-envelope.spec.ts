/**
 * @jest-environment node
 */
import { buildRealtimeSocketEnvelope } from './build-realtime-socket-envelope';

jest.mock('@api-hub/observability', () => ({
  getLoggerContext: () => ({ correlationId: 'ctx-corr' }),
}));

describe('buildRealtimeSocketEnvelope', () => {
  it('builds BaseEvent-aligned envelope without legacy type wrapper', () => {
    const envelope = buildRealtimeSocketEnvelope({
      channel: 'ALERTS',
      eventType: 'Alert.Created.Processed',
      eventVersion: '1.0.0',
      eventId: 'evt-8f4d2',
      timestamp: '2026-05-25T14:15:00Z',
      recipientIds: [],
      payload: {
        count: 1,
        organizationId: 'org-1',
        realtimeNotifyScope: 'ORG',
      },
      meta: {
        correlationId: 'corr-123',
        traceId: 'trace-456',
      },
    });

    expect(envelope).toEqual({
      eventId: 'evt-8f4d2',
      eventType: 'Alert.Created.Processed',
      eventVersion: '1.0.0',
      timestamp: '2026-05-25T14:15:00Z',
      payload: {
        count: 1,
        organizationId: 'org-1',
        realtimeNotifyScope: 'ORG',
      },
      meta: {
        correlationId: 'corr-123',
        traceId: 'trace-456',
      },
    });
    expect(envelope).not.toHaveProperty('type');
  });

  it('falls back to logger context correlationId and defaults', () => {
    const envelope = buildRealtimeSocketEnvelope({
      channel: 'ALERTS',
      eventType: 'Alert.Created.Processed',
      recipientIds: [],
      payload: { count: 1 },
    });

    expect(envelope.meta.correlationId).toBe('ctx-corr');
    expect(envelope.eventVersion).toBe('1.0.0');
    expect(envelope.eventId).toBe('unknown');
    expect(envelope.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
