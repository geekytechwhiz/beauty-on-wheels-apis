/**
 * @jest-environment node
 */
import { GoneException } from '@aws-sdk/client-apigatewaymanagementapi';

import type { ConnectionResolver } from '../interfaces/connection-resolver.interface';
import { ApiGatewaySocketService } from './api-gateway-socket.service';

jest.mock('@api-hub/observability', () => {
  const actual = jest.requireActual('@api-hub/observability');
  return {
    ...actual,
    createLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
    getLoggerContext: () => ({ correlationId: 'corr-ctx' }),
  };
});

jest.mock('@api-hub/middleware', () => ({
  getTracerForService: () => ({
    isTracingEnabled: () => false,
    getSegment: () => undefined,
    setSegment: jest.fn(),
  }),
}));

describe('ApiGatewaySocketService', () => {
  const resolver: ConnectionResolver = {
    resolve: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips postToConnection when resolver returns no connections', async () => {
    (resolver.resolve as jest.Mock).mockResolvedValue([]);
    const send = jest.fn();
    const service = new ApiGatewaySocketService({
      connectionResolver: resolver,
      client: { send } as never,
    });

    await service.publish('USER#DOC123', { type: 'ALERT', payload: {} });

    expect(send).not.toHaveBeenCalled();
  });

  it('sends payload to all resolved connectionIds', async () => {
    (resolver.resolve as jest.Mock).mockResolvedValue(['conn-1', 'conn-2']);
    const send = jest.fn().mockResolvedValue({});
    const service = new ApiGatewaySocketService({
      connectionResolver: resolver,
      client: { send } as never,
    });

    await service.publish(
      'ORG#ORG1#TEAM_ALERTS',
      { type: 'TEAM_ALERTS_UPDATED', payload: { count: 2 } },
      { correlationId: 'corr-1', eventType: 'TEAM_ALERTS_UPDATED' },
    );

    expect(send).toHaveBeenCalledTimes(2);
    const firstCall = send.mock.calls[0][0];
    expect(firstCall.input.ConnectionId).toBe('conn-1');
    const decoded = JSON.parse(new TextDecoder().decode(firstCall.input.Data));
    expect(decoded).toEqual({
      type: 'TEAM_ALERTS_UPDATED',
      payload: { count: 2 },
    });
  });

  it('logs and continues when postToConnection fails with GoneException', async () => {
    (resolver.resolve as jest.Mock).mockResolvedValue(['conn-stale', 'conn-ok']);
    const send = jest
      .fn()
      .mockRejectedValueOnce(new GoneException({ message: 'gone', $metadata: {} }))
      .mockResolvedValueOnce({});
    const service = new ApiGatewaySocketService({
      connectionResolver: resolver,
      client: { send } as never,
    });

    await expect(
      service.publish('USER#DOC123', { type: 'X', payload: {} }),
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not throw on generic publish failure', async () => {
    (resolver.resolve as jest.Mock).mockResolvedValue(['conn-1']);
    const send = jest.fn().mockRejectedValue(new Error('network'));
    const service = new ApiGatewaySocketService({
      connectionResolver: resolver,
      client: { send } as never,
    });

    await expect(
      service.publish('USER#DOC123', { type: 'X', payload: {} }),
    ).resolves.toBeUndefined();
  });
});
