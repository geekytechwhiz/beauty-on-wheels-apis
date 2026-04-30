import type { BaseEvent } from '../../typings/base-event.types';

export type TraceContext = {
  correlationId: string;
  eventId: string;
  eventType: string;
};

/** Prefer `override` (e.g. transport header) then envelope `correlationId` (required after normalization). */
export function traceContextFromEvent(
  event: BaseEvent<unknown>,
  correlationIdOverride?: string,
): TraceContext {
  const correlationId =
    correlationIdOverride?.trim() ||
    event.meta.correlationId?.trim() ||
    event.eventId;
  return {
    correlationId,
    eventId: event.eventId,
    eventType: event.eventType,
  };
}

export type TraceFailureStage =
  | 'parse'
  | 'version'
  | 'schema'
  | 'handler'
  | 'delivery_disposition'
  | 'retry'
  | 'handler_dead_letter'
  | 'handler_non_retryable'
  | 'handler_retry_exhausted';

export type TraceFailureContext = {
  stage: TraceFailureStage;
  error: unknown;
  correlationId: string;
  eventId?: string;
  eventType?: string;
};
