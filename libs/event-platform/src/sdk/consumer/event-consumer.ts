import type { DlqConfig } from '../../core/dlq/dlq-config';
import { outcomeWhenExhausted } from '../../core/dlq/delivery-decision';
import type { BaseEvent } from '../../core/event-envelope/base-event';
import type { IdempotencyStore } from '../../core/idempotency/idempotency-store';
import { retry, type RetryOptions } from '../../core/retry/retry';
import type { PayloadSchemaRegistry } from '../../core/schema/validate';
import { validatePayloadByEventType } from '../../core/schema/validate';
import type { EventTracingHooks } from '../../core/tracing/event-tracing-hooks';
import { traceContextFromEvent } from '../../core/tracing/trace-context';
import type { VersionCheckConfig } from '../../core/versioning/version-compatibility';
import { assertVersionCompatible } from '../../core/versioning/version-compatibility';
import { parseInboundEvent } from './parse-inbound-event';

export type EventConsumerDeps = {
  idempotencyStore: IdempotencyStore;
  retry: RetryOptions;
  idempotencyTtlSeconds?: number;
  /** When set, exhausted handler retries can surface as `dead_letter_candidate` (routing stays external). */
  dlq?: DlqConfig;
  /** Per-`eventType` Zod schemas for `payload`; applied after parse, before idempotency. */
  payloadSchemas?: PayloadSchemaRegistry;
  /** When set, `event.version` must be compatible with `supportedVersion` for the given strategy. */
  versionCheck?: VersionCheckConfig;
  /** Logging hooks backed by `@api-hub/logger` (use `createEventTracingHooks`). */
  tracing?: EventTracingHooks;
};

export type HandleOptions = {
  /** Overrides `event.correlationId` for tracing context when set (e.g. SQS attribute). */
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

  /**
   * 1. Parse → 2. Structural validate (parse) → 3. Version check (optional) →
   * 4. Schema validate (optional) → 5. Tracing received → 6. Idempotency check →
   * 7–8. Retry-wrapped handler → 9. Persist idempotency key → tracing processed.
   */
  async handle<T>(
    event: unknown,
    handler: (event: BaseEvent<T>) => Promise<void>,
    handleOptions?: HandleOptions,
  ): Promise<HandleResult> {
    const trace = this.deps.tracing;
    let parsed: BaseEvent;

    try {
      parsed = parseInboundEvent(event);
    } catch (error) {
      trace?.onEventFailed({
        stage: 'parse',
        error,
        correlationId: handleOptions?.correlationId,
      });
      throw error;
    }

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
      throw error;
    }

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
      throw error;
    }

    const traceCtx = traceContextFromEvent(parsed, handleOptions?.correlationId);
    trace?.onEventReceived(traceCtx);

    const idempotencyKey = parsed.idempotencyKey;

    if (await this.deps.idempotencyStore.exists(idempotencyKey)) {
      return { outcome: 'duplicate', idempotencyKey };
    }

    const dlq = this.deps.dlq ?? { enabled: false };

    try {
      await retry(
        () => handler(parsed as BaseEvent<T>),
        this.deps.retry,
      );
    } catch (error) {
      trace?.onEventFailed({
        stage: 'handler',
        error,
        correlationId: traceCtx.correlationId,
        eventId: traceCtx.eventId,
        eventType: traceCtx.eventType,
      });
      if (outcomeWhenExhausted(dlq) === 'dead_letter_candidate') {
        return {
          outcome: 'dead_letter_candidate',
          idempotencyKey,
          error,
        };
      }
      throw error;
    }

    await this.deps.idempotencyStore.save(idempotencyKey, {
      ttlSeconds: this.deps.idempotencyTtlSeconds,
    });

    trace?.onEventProcessed(traceCtx);

    return { outcome: 'processed' };
  }
}
