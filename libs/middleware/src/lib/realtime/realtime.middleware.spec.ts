/**
 * @jest-environment node
 */
import { runMiddlewares } from '../middlewareEngine';
import type { MiddlewarePipelineEvent } from '../types';
import { realtimeMiddleware } from './realtime.middleware';

describe('realtimeMiddleware', () => {
  const pipelineEvent: MiddlewarePipelineEvent = {
    __context: { correlationId: 'corr-1', eventType: 'Test.Event.v1' },
  };

  it('skips process when realtime is disabled', async () => {
    const process = jest.fn();
    const stack = [
      realtimeMiddleware({
        isEnabled: () => false,
        getPendingEvents: () => [{ eventId: 'e1' }],
        getConfig: () => ({ enabled: false }),
        process,
        logger: { warn: jest.fn(), info: jest.fn() },
        getCorrelationId: () => 'corr-1',
        getEventType: () => 'Test.Event.v1',
      }),
    ];

    const handler = jest.fn().mockResolvedValue('ok');
    const run = runMiddlewares(stack, handler);
    const result = await run(pipelineEvent, {});

    expect(result).toBe('ok');
    expect(process).not.toHaveBeenCalled();
  });

  it('processes pending events when enabled', async () => {
    const process = jest.fn().mockResolvedValue({ recipientCount: 2 });
    const stack = [
      realtimeMiddleware({
        isEnabled: () => true,
        getPendingEvents: () => [{ eventId: 'e1', eventType: 'Test.Event.v1' }],
        getConfig: () => ({ enabled: true }),
        process,
        logger: { warn: jest.fn(), info: jest.fn() },
        getCorrelationId: () => 'corr-1',
        getEventType: () => 'Test.Event.v1',
      }),
    ];

    const handler = jest.fn().mockResolvedValue('ok');
    const run = runMiddlewares(stack, handler);
    await run(pipelineEvent, {});

    expect(process).toHaveBeenCalledTimes(1);
    expect(process).toHaveBeenCalledWith({
      event: { eventId: 'e1', eventType: 'Test.Event.v1' },
      config: { enabled: true },
    });
  });

  it('logs warn and returns handler result when process fails', async () => {
    const warn = jest.fn();
    const process = jest.fn().mockRejectedValue(new Error('publish failed'));
    const stack = [
      realtimeMiddleware({
        isEnabled: () => true,
        getPendingEvents: () => [{ eventId: 'e1', eventType: 'Test.Event.v1' }],
        getConfig: () => ({ enabled: true }),
        process,
        logger: { warn, info: jest.fn() },
        getCorrelationId: () => 'corr-1',
        getEventType: () => 'Test.Event.v1',
      }),
    ];

    const handler = jest.fn().mockResolvedValue('ok');
    const run = runMiddlewares(stack, handler);
    const result = await run(pipelineEvent, {});

    expect(result).toBe('ok');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Realtime processing failed',
        correlationId: 'corr-1',
        eventType: 'Test.Event.v1',
      }),
    );
  });

  it('does not run process when handler throws', async () => {
    const process = jest.fn();
    const stack = [
      realtimeMiddleware({
        isEnabled: () => true,
        getPendingEvents: () => [{ eventId: 'e1' }],
        getConfig: () => ({ enabled: true }),
        process,
        logger: { warn: jest.fn(), info: jest.fn() },
        getCorrelationId: () => 'corr-1',
        getEventType: () => 'Test.Event.v1',
      }),
    ];

    const handler = jest.fn().mockRejectedValue(new Error('handler failed'));
    const run = runMiddlewares(stack, handler);

    await expect(run(pipelineEvent, {})).rejects.toThrow('handler failed');
    expect(process).not.toHaveBeenCalled();
  });
});
