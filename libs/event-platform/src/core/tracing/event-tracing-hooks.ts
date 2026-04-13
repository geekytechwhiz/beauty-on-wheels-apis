import type { Logger } from '@api-hub/logger';

import type { TraceContext, TraceFailureContext } from './trace-context';

export type EventTracingHooks = {
  onEventReceived: (ctx: TraceContext) => void;
  onEventProcessed: (ctx: TraceContext) => void;
  onEventFailed: (ctx: TraceFailureContext) => void;
};

export type CreateEventTracingHooksOptions = {
  logger: Logger;
  /** Prefix for structured `event` keys (default `event-platform`). */
  component?: string;
};

/** Default hooks using `@api-hub/logger` — no extra observability stack. */
export function createEventTracingHooks(
  options: CreateEventTracingHooksOptions,
): EventTracingHooks {
  const component = options.component ?? 'event-platform';

  const correlationFields = (ctx: { correlationId?: string | undefined }) => ({
    ...(ctx.correlationId !== undefined ? { correlationId: ctx.correlationId } : {}),
  });

  return {
    onEventReceived(ctx: TraceContext) {
      options.logger.info({
        ...correlationFields(ctx),
        event: `${component}.event.received`,
        message: 'Event received',
        eventId: ctx.eventId,
        eventType: ctx.eventType,
      });
    },
    onEventProcessed(ctx: TraceContext) {
      options.logger.info({
        ...correlationFields(ctx),
        event: `${component}.event.processed`,
        message: 'Event processed',
        eventId: ctx.eventId,
        eventType: ctx.eventType,
      });
    },
    onEventFailed(ctx: TraceFailureContext) {
      options.logger.error({
        ...correlationFields(ctx),
        event: `${component}.event.failed`,
        message: 'Event processing failed',
        ...(ctx.eventId !== undefined ? { eventId: ctx.eventId } : {}),
        ...(ctx.eventType !== undefined ? { eventType: ctx.eventType } : {}),
        stage: ctx.stage,
        err: ctx.error,
      });
    },
  };
}
