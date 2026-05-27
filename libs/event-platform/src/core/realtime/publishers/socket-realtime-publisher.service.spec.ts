/**
 * @jest-environment node
 */
import type { SocketService } from '../interfaces/socket-service.interface';
import type { RealtimeMessage } from '../types/realtime-message.type';
import { SocketRealtimePublisher } from './socket-realtime-publisher.service';

const mockPublish = jest.fn().mockResolvedValue(undefined);
const mockSocketService: SocketService = { publish: mockPublish };

jest.mock('../services/resolve-socket-service', () => ({
  resolveSocketService: () => mockSocketService,
}));

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
  beforeEach(() => {
    mockPublish.mockClear();
    mockPublish.mockResolvedValue(undefined);
  });

  it('publishes to user destination for single recipient', async () => {
    const publisher = new SocketRealtimePublisher();

    await publisher.publish([
      message({
        recipientIds: ['DOC123'],
        payload: { count: 1, realtimeNotifyScope: 'RECIPIENTS' },
      }),
    ]);

    expect(mockPublish).toHaveBeenCalledWith(
      'USER#DOC123',
      expect.objectContaining({
        eventType: 'TEAM_ALERTS_UPDATED',
        eventVersion: '1.0.0',
        payload: { count: 1, realtimeNotifyScope: 'RECIPIENTS' },
        meta: { correlationId: 'corr-1' },
      }),
      { correlationId: 'corr-1', eventType: 'TEAM_ALERTS_UPDATED' },
    );
  });

  it('publishes to multiple user destinations', async () => {
    const publisher = new SocketRealtimePublisher();

    await publisher.publish([
      message({
        recipientIds: ['DOC123', 'DOC456'],
        payload: { realtimeNotifyScope: 'RECIPIENTS' },
      }),
    ]);

    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(mockPublish).toHaveBeenCalledWith(
      'USER#DOC123',
      expect.any(Object),
      expect.any(Object),
    );
    expect(mockPublish).toHaveBeenCalledWith(
      'USER#DOC456',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('publishes to org channel from payload organizationId and message channel', async () => {
    const publisher = new SocketRealtimePublisher();

    await publisher.publish([
      message({
        recipientIds: [],
        payload: {
          organizationId: 'ORG1',
          count: 20,
          realtimeNotifyScope: 'ORG',
        },
      }),
    ]);

    expect(mockPublish).toHaveBeenCalledWith(
      'ORG#ORG1#TEAM_ALERTS',
      expect.objectContaining({
        eventType: 'TEAM_ALERTS_UPDATED',
        payload: {
          organizationId: 'ORG1',
          count: 20,
          realtimeNotifyScope: 'ORG',
        },
        meta: { correlationId: 'corr-1' },
      }),
      expect.any(Object),
    );
  });

  it('publishes to patient destination when patientId is in payload', async () => {
    const publisher = new SocketRealtimePublisher();

    await publisher.publish([
      message({
        recipientIds: ['DOC123'],
        payload: { patientId: 'PAT001', realtimeNotifyScope: 'RECIPIENTS' },
      }),
    ]);

    expect(mockPublish).toHaveBeenCalledWith(
      'USER#DOC123',
      expect.any(Object),
      expect.any(Object),
    );
    expect(mockPublish).toHaveBeenCalledWith(
      'PATIENT#PAT001',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('swallows socket failures and continues other destinations', async () => {
    mockPublish
      .mockRejectedValueOnce(new Error('socket down'))
      .mockResolvedValueOnce(undefined);
    const publisher = new SocketRealtimePublisher();

    await expect(
      publisher.publish([
        message({
          recipientIds: ['A', 'B'],
          payload: { realtimeNotifyScope: 'RECIPIENTS' },
        }),
      ]),
    ).resolves.toBeUndefined();
    expect(mockPublish).toHaveBeenCalledTimes(2);
  });

  it('does nothing for empty messages array', async () => {
    const publisher = new SocketRealtimePublisher();

    await publisher.publish([]);

    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('does not call socket when there are no destinations', async () => {
    const publisher = new SocketRealtimePublisher();

    await publisher.publish([
      message({ recipientIds: [], payload: {} }),
    ]);

    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('publishes multiple messages with distinct org channels', async () => {
    const publisher = new SocketRealtimePublisher();

    await publisher.publish([
      message({
        channel: 'TEAM_ALERTS',
        payload: { organizationId: 'ORG1', realtimeNotifyScope: 'ORG' },
        recipientIds: [],
      }),
      message({
        channel: 'ALERTS',
        eventType: 'ALERTS_UPDATED',
        payload: { organizationId: 'ORG2', realtimeNotifyScope: 'ORG' },
        recipientIds: [],
      }),
    ]);

    expect(mockPublish).toHaveBeenCalledWith(
      'ORG#ORG1#TEAM_ALERTS',
      expect.any(Object),
      expect.objectContaining({ eventType: 'TEAM_ALERTS_UPDATED' }),
    );
    expect(mockPublish).toHaveBeenCalledWith(
      'ORG#ORG2#ALERTS',
      expect.any(Object),
      expect.objectContaining({ eventType: 'ALERTS_UPDATED' }),
    );
  });
});
