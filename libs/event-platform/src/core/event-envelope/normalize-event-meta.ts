import type { BaseEvent, EventMeta, NormalizeMetaOptions } from '../../typings/base-event.types';
 

export function normalizeEventMeta<T>(
  event: BaseEvent<T>,
  options?: NormalizeMetaOptions,
): BaseEvent<T> {
  const fallbackCorrelationId =
    options?.fallbackCorrelationId ?? event.eventId;

  const existing = event.meta ?? {};

  const existingCorrelation = existing.correlationId?.trim();

  const normalizedMeta: EventMeta = {
    correlationId:
      existingCorrelation && existingCorrelation.length > 0
        ? existingCorrelation
        : fallbackCorrelationId,

    retryCount: existing.retryCount ?? 0,

    publishedAt:
      existing.publishedAt ??
      event.timestamp,

    traceId: existing.traceId,
    spanId: existing.spanId,

    tenantId: existing.tenantId,
    userId: existing.userId,

    channel:
      existing.channel ??
      options?.defaultChannel,

    environment:
      existing.environment ??
      options?.defaultEnvironment as EventMeta['environment'],

    schemaRef: existing.schemaRef,
    causationId: existing.causationId,

    attributes: existing.attributes ?? {},
  };

  return {
    ...event,
    meta: normalizedMeta,
  };
}