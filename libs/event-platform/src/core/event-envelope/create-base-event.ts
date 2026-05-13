import { generateEventId, nowIso } from '../../utils/helpers';
import type { Baseevent: any, EventMeta } from '../../typings/base-event.types';

export type CreateBaseEventInput<T> = {
  eventType: string;
  eventVersion: string;
  payload: T;

  source: string;

  eventId?: string;
  timestamp?: string;

  idempotencyKey?: string;

  meta?: Partial<EventMeta>;
};

export function createBaseEvent<T>(
    input: CreateBaseEventInput<T>,
  ): BaseEvent<T> {
    const eventId = input.eventId ?? generateEventId();
    const timestamp = input.timestamp ?? nowIso();
  
    const baseMeta = input.meta ?? {};
  
    const meta: EventMeta = {
      correlationId:
        baseMeta.correlationId ?? eventId,
  
      retryCount: baseMeta.retryCount ?? 0,
  
      publishedAt:
        baseMeta.publishedAt ?? timestamp,
  
      traceId: baseMeta.traceId,
      spanId: baseMeta.spanId,
  
      tenantId: baseMeta.tenantId,
      userId: baseMeta.userId,
  
      channel: baseMeta.channel,
      environment: baseMeta.environment,
  
      schemaRef: baseMeta.schemaRef,
      causationId: baseMeta.causationId,
  
      attributes: baseMeta.attributes ?? {},
    };
  
    return {
      eventId,
      eventType: input.eventType,
      eventVersion: input.eventVersion,
      timestamp,
      source: input.source,
  
      idempotencyKey:
        input.idempotencyKey ?? eventId,
  
      payload: input.payload,
  
      meta,
    };
  }