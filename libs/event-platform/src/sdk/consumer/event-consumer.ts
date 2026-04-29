import { ensureObservabilityInitialized } from '@api-hub/middleware';
import {
  recordConsumerDeadLetter,
  recordConsumerDuplicateEvent,
  recordConsumerEventProcessed,
  recordConsumerFailure,
  recordConsumerRetry,
} from '@api-hub/observability';

import { decideDeliveryDisposition } from '../../core/dlq/delivery-decision';
import type { BaseEvent } from '../../typings/base-event.types';

import { retry } from '../../core/retry/retry';
import { RetryOptions } from '../../typings/consumer.types';


import { traceContextFromEvent } from '../../core/tracing/trace-context';

import { assertVersionCompatible } from '../../core/versioning/version-compatibility';

import { EventConsumerDeps, PayloadSchemaRegistry } from '../../typings/consumer.types';
import { resolveSchema } from '../../utils/helpers';
import { parseInboundEvent } from './parse-inbound-event';
import { normalizeEventMeta } from '../../core/event-envelope/normalize-event-meta';
import { HandleOptions, HandleResult } from '../../typings/publisher.types';

ensureObservabilityInitialized();

/** Barrel exports can narrow optional arity; runtime accepts these full signatures. */
const emitRetry = recordConsumerRetry as (eventType?: string, retryCount?: number) => void;
const emitDeadLetter = recordConsumerDeadLetter as (
  eventType?: string,
  context?: { retryCount?: number; error?: string },
) => void;
const emitFailure = recordConsumerFailure as (eventType?: string, error?: unknown) => void;

export class EventConsumer {
  constructor(private readonly deps: EventConsumerDeps) {}

  async handle<T>(
    event: unknown,
    handler: (event: BaseEvent<T>) => Promise<void>,
    handleOptions?: HandleOptions,
  ): Promise<HandleResult> {
    const trace = this.deps.tracing;
    let parsed: BaseEvent;

    // -------------------------------
    // 1. Parse
    // -------------------------------
    try {
      parsed = parseInboundEvent(event, {
        mapRawToBaseEvent: this.deps.mapRawToBaseEvent,
      });
      // ensure meta exists
      parsed = normalizeEventMeta(parsed, {
        fallbackCorrelationId: handleOptions?.correlationId,
      });
    } catch (error) {
      trace?.onEventFailed({
        stage: 'parse',
        error,
        correlationId: handleOptions?.correlationId,
      });
      recordConsumerFailure();
      throw error;
    }

    // -------------------------------
    // 2. Version check
    // -------------------------------
    // -------------------------------
// 2. Version check
// -------------------------------
try {
  if (this.deps.versionCheck !== undefined) {
    assertVersionCompatible(parsed.eventVersion, this.deps.versionCheck); // ✅ FIX
  }
} catch (error) {
  const ctx = traceContextFromEvent(parsed, handleOptions?.correlationId);
  trace?.onEventFailed({
    stage: 'version',
    error,
    correlationId: ctx.correlationId,
    eventId: ctx.eventId,
    eventType: ctx.eventType,
  });
  recordConsumerFailure(ctx.eventType);
  throw error;
}
    // -------------------------------
    // 3. Schema validation
    // -------------------------------
   // -------------------------------
// 3. Schema validation (version-aware)
// -------------------------------
try {
  if (this.deps.payloadSchemas !== undefined) {
    const schema: any = resolveSchema(
      this.deps.payloadSchemas as unknown as PayloadSchemaRegistry,
      parsed.eventType,
      parsed.eventVersion,
    );

    parsed = {
      ...parsed,
      payload: schema.parse(parsed.payload) as unknown as T,
    };
  }
} catch (error) {
  const ctx = traceContextFromEvent(parsed, handleOptions?.correlationId);
  trace?.onEventFailed({
    stage: 'schema',
    error,
    correlationId: ctx.correlationId,
    eventId: ctx.eventId,
    eventType: ctx.eventType,
  });
  recordConsumerFailure(ctx.eventType);
  throw error;
}

    // -------------------------------
    // 4. Tracing context
    // -------------------------------
    const traceCtx = traceContextFromEvent(
      parsed,
      handleOptions?.correlationId,
    );
    trace?.onEventReceived(traceCtx);

    const context = {
      eventId: traceCtx.eventId,
      eventType: traceCtx.eventType,
    };

    const idempotencyKey = parsed.idempotencyKey;

    // -------------------------------
    // 5. Idempotency BEFORE
    // -------------------------------
    let decision;

    try {
      decision = await this.deps.idempotencyStrategy.before(context);
    } catch (error) {
      recordConsumerFailure(traceCtx.eventType);
      throw error;
    }

    if (decision === 'DUPLICATE') {
      recordConsumerDuplicateEvent(traceCtx.eventType);
      return { outcome: 'duplicate', idempotencyKey };
    }

    if (decision === 'RETRY') {
      emitRetry(traceCtx.eventType, parsed.meta?.retryCount ?? 0);
      throw new Error('RETRY_EVENT');
    }

    // -------------------------------
    // 6. Retry config
    // -------------------------------
    const dlq = this.deps.dlq ?? { enabled: false };

    const userRetry = this.deps.retry;

    const retryOptions: RetryOptions = {
      ...userRetry,
      onBeforeRetry: (info) => {
        userRetry.onBeforeRetry?.(info);
        emitRetry(traceCtx.eventType);
      },
    };

    // -------------------------------
    // 7. Execute handler
    // -------------------------------
    try {
      await retry(
        async () => {
          // ✅ Ensure meta exists (defensive, even if type says required)
          if (!parsed.meta) {
            parsed.meta = {
              correlationId: parsed.eventId,
              retryCount: 0,
              publishedAt: parsed.timestamp,
            };
          }
    
          // ✅ Safe increment (no optional chaining)
          parsed.meta.retryCount = (parsed.meta.retryCount ?? 0) + 1;
    
          await handler(parsed as BaseEvent<T>);
        },
        retryOptions,
        {
          currentRetryCount: parsed.meta.retryCount ?? 0,
        },
      );
    } catch (error) {
      // -------------------------------
      // 🔥 DLQ + Retry disposition
      // -------------------------------
      const retryCount = parsed.meta?.retryCount ?? 0;
    
      const disposition = decideDeliveryDisposition({
        retryCount,
        maxAttempts: this.deps.retry.maxAttempts,
        dlq: this.deps.dlq ?? { enabled: false },
        error,
      });
    
      // -------------------------------
      // 🔥 DEAD LETTER
      // -------------------------------
      if (disposition === 'dead_letter_candidate') {
        const errMessage =
          error instanceof Error ? error.message : String(error);
    
        trace?.onEventFailed({
          stage: 'handler_dead_letter',
          error,
          correlationId: traceCtx.correlationId,
          eventId: traceCtx.eventId,
          eventType: traceCtx.eventType,
        });
    
        emitDeadLetter(traceCtx.eventType, {
          retryCount,
          error: errMessage,
        });
    
        return {
          outcome: 'dead_letter_candidate',
          idempotencyKey,
          error,
        };
      }
    
      // -------------------------------
      // 🔥 PROPAGATE ERROR
      // -------------------------------
      if (disposition === 'propagate_error') {
        emitFailure(traceCtx.eventType, {
          retryCount,
        });
    
        throw error;
      }
    
      // -------------------------------
      // 🔥 FALLBACK (should not happen)
      // -------------------------------
      emitFailure(traceCtx.eventType, {
        retryCount,
      });
    
      throw error;
    }

    // -------------------------------
    // 8. AFTER SUCCESS
    // -------------------------------
    try {
      await this.deps.idempotencyStrategy.afterSuccess(context);
    } catch (error) {
      // do not fail main flow
      console.error('Idempotency afterSuccess failed', {
        eventId: context.eventId,
        error,
      });
    }

    // -------------------------------
    // 9. Success
    // -------------------------------
    trace?.onEventProcessed(traceCtx);
    recordConsumerEventProcessed(traceCtx.eventType);

    return { outcome: 'processed' };
  }
}
