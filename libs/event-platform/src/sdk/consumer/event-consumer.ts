import {
  recordConsumerDeadLetter,
  recordConsumerDuplicateEvent,
  recordConsumerEventProcessed,
  recordConsumerFailure,
  recordConsumerRetry,
} from '@api-hub/observability';

import { decideDeliveryDisposition } from '../../core/dlq/delivery-decision';
import type { DlqConfig } from '../../core/dlq/dlq-config';
import type { BaseEvent } from '../../core/event-envelope/base-event';

import { retry, type RetryOptions } from '../../core/retry/retry';

import type { PayloadSchemaRegistry } from '../../core/schema/validate';
import { validatePayloadByEventType } from '../../core/schema/validate';

import type { EventTracingHooks } from '../../core/tracing/event-tracing-hooks';
import { traceContextFromEvent } from '../../core/tracing/trace-context';

import type { VersionCheckConfig } from '../../core/versioning/version-compatibility';
import { assertVersionCompatible } from '../../core/versioning/version-compatibility';

import { parseInboundEvent } from './parse-inbound-event';

import type { IdempotencyStrategy } from '../../core/idempotency/idempotency-strategy';

/** Barrel exports can narrow optional arity; runtime accepts these full signatures. */
const emitRetry = recordConsumerRetry as (eventType?: string, retryCount?: number) => void;
const emitDeadLetter = recordConsumerDeadLetter as (
  eventType?: string,
  context?: { retryCount?: number; error?: string },
) => void;
const emitFailure = recordConsumerFailure as (eventType?: string, error?: unknown) => void;

export type EventConsumerDeps = {
  idempotencyStrategy: IdempotencyStrategy;

  retry: RetryOptions;
  dlq?: DlqConfig;

  payloadSchemas?: PayloadSchemaRegistry;
  versionCheck?: VersionCheckConfig;

  tracing?: EventTracingHooks;

  /**
   * When the inbound value is not a {@link BaseEvent} after transport normalization
   * (legacy SQS body, EventBridge detail, etc.), build a canonical envelope from the raw record.
   */
  mapRawToBaseEvent?: (raw: unknown) => BaseEvent;
};

export type HandleOptions = {
  correlationId?: string;
};

export type HandleResult =
  | { outcome: 'processed' }
  | { outcome: 'duplicate'; idempotencyKey: string }
  | {
      outcome: 'dead_letter_candidate';
      idempotencyKey: string;
      error: unknown;
    };

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
      if (!parsed.meta) {
        parsed.meta = {
          retryCount: 0,
          publishedAt: parsed.timestamp,
        };
      }
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
    try {
      if (this.deps.versionCheck !== undefined) {
        assertVersionCompatible(parsed.version, this.deps.versionCheck);
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
    try {
      if (this.deps.payloadSchemas !== undefined) {
        parsed = validatePayloadByEventType(parsed, this.deps.payloadSchemas);
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
      await retry(async () => {
        // 🔥 increment retry count
        parsed.meta!.retryCount += 1;

        return handler(parsed as BaseEvent<T>);
      }, retryOptions, {
        currentRetryCount: parsed.meta?.retryCount ?? 0,
      });
    } catch (error) {
      // 🔥 Idempotency error hook
       // -------------------------------
// DLQ + Retry disposition
// -------------------------------
const retryCount = parsed.meta?.retryCount ?? 0;

const disposition = decideDeliveryDisposition({
  retryCount,
  maxAttempts: this.deps.retry.maxAttempts,
  dlq,
  error,
});

if (disposition === 'dead_letter_candidate') {
  trace?.onEventFailed({
    stage: 'handler_dead_letter',
    error,
    correlationId: traceCtx.correlationId,
    eventId: traceCtx.eventId,
    eventType: traceCtx.eventType,
  });

  emitDeadLetter(traceCtx.eventType, {
    retryCount,
    error: error instanceof Error ? error.message : String(error),
  });

  return {
    outcome: 'dead_letter_candidate',
    idempotencyKey,
    error,
  };
}

if (disposition === 'propagate_error') {
  emitFailure(traceCtx.eventType, {
    retryCount,
  });
  throw error;
}

// retry case → should never reach here (retry handled inside retry())
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
