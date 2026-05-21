/**
 * @jest-environment node
 */
import type { SocketService } from '../interfaces/socket-service.interface';
import type { RealtimeMessage } from '../types/realtime-message.type';
import { SocketRealtimePublisher } from './socket-realtime-publisher.service';

jest.mock('@api-hub/observability', () => {
  const actual = jest.requireActual('@api-hub/observability');
  return {
    ...actual,
    createLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
    getLoggerContext: () => ({ correlationId: 'corr-1' }),
  };
});

jest.mock('@api-hub/middleware', () => ({
  getTracerForService: () => ({
    isTracingEnabled: () => false,
    getSegment: () => undefined,
    setSegment: jest.fn(),
  }),
}));

function message(overrides: Partial<RealtimeMessage> = {}): RealtimeMessage {
  return {
    channel: 'TEAM_ALERTS',
    eventType: 'TEAM_ALERTS_UPDATED',
    payload: {},
    recipientIds: [],
    ...overrides,
  };
}

describe('SocketRealtimePublisher', () => {
  it('publishes to user destination for single recipient', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const socketService: SocketService = { publish };
    const publisher = new SocketRealtimePublisher(socketService);

    await publisher.publish([
      message({
        recipientIds: ['DOC123'],
        payload: { count: 1 },
      }),
    ]);

    expect(publish).toHaveBeenCalledWith(
      'USER#DOC123',
      { type: 'TEAM_ALERTS_UPDATED', payload: { count: 1 } },
      { correlationId: 'corr-1', eventType: 'TEAM_ALERTS_UPDATED' },
    );
  });

  it('publishes to multiple user destinations', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const publisher = new SocketRealtimePublisher({ publish });

    await publisher.publish([
      message({ recipientIds: ['DOC123', 'DOC456'] }),
    ]);

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith(
      'USER#DOC123',
      expect.any(Object),
      expect.any(Object),
    );
    expect(publish).toHaveBeenCalledWith(
      'USER#DOC456',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('publishes to org channel from payload organizationId and message channel', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const publisher = new SocketRealtimePublisher({ publish });

    await publisher.publish([
      message({
        recipientIds: [],
        payload: { organizationId: 'ORG1', count: 20 },
      }),
    ]);

    expect(publish).toHaveBeenCalledWith(
      'ORG#ORG1#TEAM_ALERTS',
      { type: 'TEAM_ALERTS_UPDATED', payload: { organizationId: 'ORG1', count: 20 } },
      expect.any(Object),
    );
  });

  it('publishes to patient destination when patientId is in payload', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const publisher = new SocketRealtimePublisher({ publish });

    await publisher.publish([
      message({
        recipientIds: ['DOC123'],
        payload: { patientId: 'PAT001' },
      }),
    ]);

    expect(publish).toHaveBeenCalledWith(
      'USER#DOC123',
      expect.any(Object),
      expect.any(Object),
    );
    expect(publish).toHaveBeenCalledWith(
      'PATIENT#PAT001',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('swallows socket failures and continues other destinations', async () => {
    const publish = jest
      .fn()
      .mockRejectedValueOnce(new Error('socket down'))
      .mockResolvedValueOnce(undefined);
    const publisher = new SocketRealtimePublisher({ publish });

    await expect(
      publisher.publish([message({ recipientIds: ['A', 'B'] })]),
    ).resolves.toBeUndefined();
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('does nothing for empty messages array', async () => {
    const publish = jest.fn();
    const publisher = new SocketRealtimePublisher({ publish });

    await publisher.publish([]);

    expect(publish).not.toHaveBeenCalled();
  });

  it('does not call socket when there are no destinations', async () => {
    const publish = jest.fn();
    const publisher = new SocketRealtimePublisher({ publish });

    await publisher.publish([
      message({ recipientIds: [], payload: {} }),
    ]);

    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes multiple messages with distinct org channels', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const publisher = new SocketRealtimePublisher({ publish });

    await publisher.publish([
      message({
        channel: 'TEAM_ALERTS',
        payload: { organizationId: 'ORG1' },
        recipientIds: [],
      }),
      message({
        channel: 'ALERTS',
        eventType: 'ALERTS_UPDATED',
        payload: { organizationId: 'ORG2' },
        recipientIds: [],
      }),
    ]);

    expect(publish).toHaveBeenCalledWith(
      'ORG#ORG1#TEAM_ALERTS',
      expect.any(Object),
      expect.objectContaining({ eventType: 'TEAM_ALERTS_UPDATED' }),
    );
    expect(publish).toHaveBeenCalledWith(
      'ORG#ORG2#ALERTS',
      expect.any(Object),
      expect.objectContaining({ eventType: 'ALERTS_UPDATED' }),
    );
  });
});
