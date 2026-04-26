import type { BaseEvent } from '../event-envelope/base-event';

export type TraceContext = {
  correlationId: string | undefined;
  eventId: string;
  eventType: string;
};

/** Prefer `override` (e.g. transport header) then envelope `correlationId`. */
export function traceContextFromEvent(
  event: BaseEvent,
  correlationIdOverride?: string,
): TraceContext {
  return {
    correlationId: correlationIdOverride ?? event.correlationId,
    eventId: event.eventId,
    eventType: event.eventType,
  };
}

export type TraceFailureStage = 'parse' | 'version' | 'schema' | 'handler' | 'delivery_disposition' | 'retry'| 'handler_dead_letter';

export type TraceFailureContext = {
  stage: TraceFailureStage;
  error: unknown;
  correlationId?: string;
  eventId?: string;
  eventType?: string;
};
