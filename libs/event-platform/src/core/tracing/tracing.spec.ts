import type { Logger } from '@api-hub/observability';

import { createEventTracingHooks, fireFifoBatchTailDeferred } from './event-tracing-hooks';

describe('createEventTracingHooks', () => {
  it('logs received, processed, and failed via observability logger', () => {
    const info = jest.fn();
    const error = jest.fn();
    const logger = { info, error } as unknown as Logger;

    const hooks = createEventTracingHooks({ logger, component: 'test-svc' });

    hooks.onEventReceived({
      correlationId: 'c1',
      eventId: 'e1',
      eventType: 'T',
    });
    hooks.onEventProcessed({
      correlationId: 'c1',
      eventId: 'e1',
      eventType: 'T',
    });
    hooks.onEventFailed({
      stage: 'handler',
      error: new Error('x'),
      correlationId: 'c1',
      eventId: 'e1',
      eventType: 'T',
    });

    expect(info).toHaveBeenCalledTimes(2);
    expect(info.mock.calls[0][0]).toMatchObject({
      event: 'test-svc.event.received',
      correlationId: 'c1',
      eventId: 'e1',
      eventType: 'T',
    });
    expect(info.mock.calls[1][0]).toMatchObject({
      event: 'test-svc.event.processed',
    });
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'test-svc.event.failed',
        stage: 'handler',
        correlationId: 'c1',
      }),
    );
  });
});

describe('fireFifoBatchTailDeferred', () => {
  it('invokes optional hook when present', () => {
    const onFifoBatchTailDeferred = jest.fn();
    fireFifoBatchTailDeferred(
      { onFifoBatchTailDeferred },
      {
        schedulingLaneKey: 'fifo:g1',
        skippedMessageIds: ['m2'],
        reason: 'head_not_acked',
        blockingMessageId: 'm1',
        blockingBatchIndex: 0,
      },
    );
    expect(onFifoBatchTailDeferred).toHaveBeenCalledTimes(1);
  });

  it('swallows hook errors', () => {
    expect(() =>
      fireFifoBatchTailDeferred(
        {
          onFifoBatchTailDeferred: () => {
            throw new Error('boom');
          },
        },
        {
          schedulingLaneKey: 'fifo:g1',
          skippedMessageIds: [],
          reason: 'head_not_acked',
          blockingBatchIndex: 0,
        },
      ),
    ).not.toThrow();
  });
});
