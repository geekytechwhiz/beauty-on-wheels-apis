import type { Middleware, MiddlewarePipelineEvent } from '../types';

export type RealtimeMiddlewareDeps = {
  isEnabled: () => boolean;
  getPendingEvents: () => readonly unknown[];
  process: (args: {
    event: unknown;
    config: unknown;
  }) => Promise<{ recipientCount: number }>;
  getConfig: () => unknown;
  logger: {
    warn: (meta: Record<string, unknown>) => void;
    info: (meta: Record<string, unknown>) => void;
  };
  getCorrelationId: (pipelineEvent: MiddlewarePipelineEvent) => string | undefined;
  getEventType: (pipelineEvent: MiddlewarePipelineEvent) => string | undefined;
};

/**
 * Runs after the business handler (`next()`). Drains pending realtime events and
 * invokes `process` for each. Failures are logged and never fail event processing.
 */
export function realtimeMiddleware<
  TResult = unknown,
  TContext = unknown,
>(deps: RealtimeMiddlewareDeps): Middleware<MiddlewarePipelineEvent, TResult, TContext> {
  return async ({ event, next }) => {
    const result = await next();

    if (!deps.isEnabled()) {
      return result;
    }

    const pending = deps.getPendingEvents();
    const config = deps.getConfig();

    for (const baseEvent of pending) {
      const evt = baseEvent as { meta?: { correlationId?: string }; eventType?: string };
      const correlationId =
        evt.meta?.correlationId ?? deps.getCorrelationId(event);
      const eventType = evt.eventType ?? deps.getEventType(event);

      try {
        const { recipientCount } = await deps.process({ event: baseEvent, config });
        deps.logger.info({
          event: 'realtime.middleware',
          message: 'Realtime processing completed',
          correlationId,
          eventId: (baseEvent as { eventId?: string }).eventId,
          eventType,
          recipientCount,
          realtimeEnabled: true,
        });
      } catch (error) {
        deps.logger.warn({
          event: 'realtime.middleware',
          message: 'Realtime processing failed',
          error,
          correlationId,
          eventType,
          realtimeEnabled: true,
        });
      }
    }

    return result;
  };
}
