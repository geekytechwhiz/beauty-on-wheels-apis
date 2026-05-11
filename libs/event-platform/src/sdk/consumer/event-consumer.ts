import { ensureObservabilityInitialized } from '@api-hub/middleware';
import { getContext, recordConsumerFailure } from '@api-hub/observability';

import { normalizeEventMeta } from '../../core/event-envelope/normalize-event-meta';
import { prepareInboundBaseEvent } from '../../core/event-envelope/prepare-inbound-base-event';
import { orchestratePreparedConsumerEvent } from '../../engine/processor/orchestrate-consumer-message';
import { fireProcessingFailure } from '../../core/tracing/event-tracing-hooks';
import { traceContextFromEvent } from '../../core/tracing/trace-context';

import type { BaseEvent } from '../../typings/base-event.types';
import type { EventConsumerDeps } from '../../typings/consumer.types';
import { parseInboundEvent } from './parse-inbound-event';
import type { HandleOptions, HandleResult } from '../../typings/publisher.types';

ensureObservabilityInitialized();

function failureStageFromError(error: unknown): 'parse' | 'version' | 'schema' {
  if (!(error instanceof Error)) {
    return 'schema';
  }
  if (error.message.includes('correlationId')) {
    return 'schema';
  }
  if (error.message.includes('version') || error.message.includes('Version')) {
    return 'version';
  }
  return 'schema';
}

export class EventConsumer {
  constructor(private readonly deps: EventConsumerDeps) {}

  async handle<T>(
    event: unknown,
    handler: (event: BaseEvent<T>) => Promise<void>,
    handleOptions?: HandleOptions,
  ): Promise<HandleResult> {
    const fallbackCorrelation =
      handleOptions?.correlationId ?? getContext().correlationId;
    let parsed: BaseEvent | undefined;

    try {
      parsed = parseInboundEvent(event, {
        mapRawToBaseEvent: this.deps.mapRawToBaseEvent,
      });
      parsed = normalizeEventMeta(parsed, {
        fallbackCorrelationId: fallbackCorrelation,
      });
    } catch (error) {
      this.deps.tracing?.onEventFailed({
        stage: 'parse',
        error,
        correlationId: fallbackCorrelation ?? getContext().correlationId ?? 'unknown',
      });
      recordConsumerFailure();
      throw error;
    }

    let baseEvent: BaseEvent<T>;
    try {
      baseEvent = prepareInboundBaseEvent(
        parsed,
        this.deps,
        {
          fallbackCorrelationId:
            handleOptions?.correlationId ?? parsed.meta.correlationId,
        },
      ) as BaseEvent<T>;
    } catch (error) {
      const ctx = traceContextFromEvent(parsed, handleOptions?.correlationId);
      const stage = failureStageFromError(error);
      fireProcessingFailure(this.deps.tracing, {
        stage,
        error,
        correlationId: ctx.correlationId,
        eventId: ctx.eventId,
        eventType: ctx.eventType,
      });
      recordConsumerFailure(ctx.eventType);
      throw error;
    }

    const idempotencyKey = baseEvent.idempotencyKey;

    const registry: Record<string, (event: BaseEvent<any>) => Promise<void>> = {
      [baseEvent.eventType]: async (e) => {
        await handler(e as BaseEvent<T>);
      },
    };

    const result = await orchestratePreparedConsumerEvent({
      baseEvent,
      rawForDelivery: parsed,
      deps: this.deps,
      registry,
    });

    switch (result.outcome) {
      case 'success':
        return { outcome: 'processed' };
      case 'discard':
        return {
          outcome: 'discarded_non_retryable',
          idempotencyKey,
          error: result.error ?? new Error('discarded'),
        };
      case 'duplicate':
        return { outcome: 'duplicate', idempotencyKey };
      case 'dead_letter':
        return {
          outcome: 'dead_letter_candidate',
          idempotencyKey,
          error: result.error ?? new Error('dead_letter'),
        };
      case 'retry_scheduled':
      case 'needs_transport_retry':
        throw new Error('RETRY_EVENT');
    }
  }
}
