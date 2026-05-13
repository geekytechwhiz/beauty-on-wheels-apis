import {
  getContext,
  getLogger,
  recordConsumerDeadLetter,
  recordConsumerDuplicateEvent,
  recordConsumerEventProcessed,
  recordConsumerFailure,
  recordConsumerRetry,
} from '@api-hub/observability';

import { BaseError } from '@api-hub/utils';
import { errorCodeFromUnknown, toBaseError } from '@api-hub/utils';

import { handleDlq } from '../../core/dlq/dlq.executor';
import type { DeliveryDecision } from '../../core/policy/delivery-policy';
import { evaluateDeliveryPolicy } from '../../core/policy/delivery-policy';
import { prepareInboundBaseEvent } from '../../core/event-envelope/prepare-inbound-base-event';
import {
  fireProcessingFailure,
  fireProcessingStart,
  fireProcessingSuccess,
} from '../../core/tracing/event-tracing-hooks';
import { traceContextFromEvent } from '../../core/tracing/trace-context';
import type { BaseEvent } from '../../typings/base-event.types';
import type { EventConsumerDeps } from '../../typings/consumer.types';
import { effectiveTransportMode } from '../../typings/consumer.types';
import type { NormalizeMetaOptions } from '../../typings/base-event.types';

import { approximateReceiveCount, computeEffectiveDeliveryAttempt } from '../../utils/transport-attempt';
import type { ProcessSingleResult } from './process-outcomes';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function useSqsSurfaceRetry(raw: unknown, deps: EventConsumerDeps): boolean {
  if (deps.transportRetry) {
    return false;
  }
  if (effectiveTransportMode(deps) !== 'sqs-native') {
    return false;
  }
  return approximateReceiveCount(raw) !== undefined;
}

export function mapRawAndPrepare(
  raw: unknown,
  deps: EventConsumerDeps,
  normalizeOptions?: NormalizeMetaOptions,
): BaseEvent<any> {
  const mapped = deps.mapRawToBaseEvent
    ? deps.mapRawToBaseEvent(raw)
    : (raw as BaseEvent<any>);
  if (mapped == null) {
    throw new Error('Event mapping produced no event');
  }
  return prepareInboundBaseEvent(mapped, deps, normalizeOptions);
}

async function applyTerminalDecision(
  decision: DeliveryDecision,
  err: unknown,
  params: {
    rawForDelivery: unknown;
    deps: EventConsumerDeps;
    baseEvent: BaseEvent<any> | undefined;
    effectiveAttempt: number;
    traceCtx: ReturnType<typeof traceContextFromEvent>;
  },
): Promise<ProcessSingleResult> {
  const { rawForDelivery, deps, baseEvent, effectiveAttempt, traceCtx } = params;
  const eventType = baseEvent?.eventType;
  const dlq = deps.dlq ?? { enabled: false };

  const failCtx = {
    stage: 'handler_dead_letter' as const,
    error: err,
    correlationId: traceCtx.correlationId,
    eventId: traceCtx.eventId,
    eventType: traceCtx.eventType,
  };

  if (decision.type === 'retry') {
    throw new Error('applyTerminalDecision: retry is not terminal');
  }

  if (decision.type === 'dead_letter') {
    await handleDlq({
      dlq,
      event: rawForDelivery,
      error: err,
      retryCount: effectiveAttempt,
    });

    const errMessage = err instanceof Error ? err.message : String(err);
    recordConsumerDeadLetter(eventType, {
      retryCount: effectiveAttempt,
      error: errMessage,
    });

    const retryablePayload: Record<string, boolean> = {};
    if (err instanceof BaseError) {
      retryablePayload['error.retryable'] = err.retryable ?? false;
    }

    getLogger().error(
      'consumer_dead_letter_candidate',
      toBaseError(err),
      {
        disposition: 'dead_letter_candidate',
        correlationId: traceCtx.correlationId,
        eventType,
        'error.code': errorCodeFromUnknown(err),
        ...retryablePayload,
      },
    );

    if (deps.tracing?.onDlq) {
      deps.tracing.onDlq({
        ...failCtx,
        reason: decision.reason,
      });
    } else {
      fireProcessingFailure(deps.tracing, failCtx);
    }

    if (dlq.strategy) {
      return { outcome: 'dead_letter', error: err };
    }
    recordConsumerFailure(eventType, err);
    return { outcome: 'needs_transport_retry', error: err };
  }

  if (decision.type === 'discard') {
    await handleDlq({
      dlq,
      event: rawForDelivery,
      error: err,
      retryCount: effectiveAttempt,
    });
    recordConsumerFailure(eventType, err);
    const nonRetryCtx = {
      ...failCtx,
      stage: 'handler_non_retryable' as const,
    };
    fireProcessingFailure(deps.tracing, nonRetryCtx);
    return { outcome: 'discard', error: err };
  }

  recordConsumerFailure(eventType, err);
  fireProcessingFailure(deps.tracing, {
    ...failCtx,
    stage: 'handler_retry_exhausted',
  });
  return { outcome: 'needs_transport_retry', error: err };
}

async function handleIdempotencyContention(params: {
  rawForDelivery: unknown;
  deps: EventConsumerDeps;
  baseEvent: BaseEvent<any>;
  traceCtx: ReturnType<typeof traceContextFromEvent>;
}): Promise<ProcessSingleResult> {
  const { rawForDelivery, deps, baseEvent, traceCtx } = params;
  const effectiveAttempt = computeEffectiveDeliveryAttempt(
    rawForDelivery,
    baseEvent.meta?.retryCount,
  );

  const decision = evaluateDeliveryPolicy({
    effectiveAttempt,
    maxAttempts: deps.retry.maxAttempts,
    dlq: deps.dlq ?? { enabled: false },
    allowTransportRetry: true,
    delayMs: deps.retry.delayMs,
    idempotencyContention: true,
  });

  if (decision.type === 'retry') {
    if (deps.transportRetry) {
      await deps.transportRetry.scheduleRetry({
        rawEvent: rawForDelivery,
        retryCount: decision.nextRetryCount ?? effectiveAttempt + 1,
        delayMs: decision.delayMs ?? deps.retry.delayMs,
      });
      recordConsumerRetry(baseEvent.eventType, decision.nextRetryCount);
      deps.tracing?.onRetry?.({
        ...traceCtx,
        attempt: effectiveAttempt,
        delayMs: decision.delayMs,
        reason: decision.reason,
      });
      return { outcome: 'retry_scheduled' };
    }

    if (useSqsSurfaceRetry(rawForDelivery, deps)) {
      recordConsumerRetry(baseEvent.eventType, effectiveAttempt);
      deps.tracing?.onRetry?.({
        ...traceCtx,
        attempt: effectiveAttempt,
        delayMs: decision.delayMs,
        reason: decision.reason,
      });
      return { outcome: 'needs_transport_retry', error: new Error('idempotency_contention') };
    }

    await sleep(decision.delayMs ?? deps.retry.delayMs);
    recordConsumerRetry(baseEvent.eventType, effectiveAttempt);
    deps.tracing?.onRetry?.({
      ...traceCtx,
      attempt: effectiveAttempt,
      delayMs: decision.delayMs,
      reason: decision.reason,
    });
    return { outcome: 'needs_transport_retry', error: new Error('idempotency_contention') };
  }

  return applyTerminalDecision(decision, new Error('idempotency_contention'), {
    rawForDelivery,
    deps,
    baseEvent,
    effectiveAttempt,
    traceCtx,
  });
}

async function runSingleHandlerAttempt(params: {
  baseEvent: BaseEvent<any>;
  rawForDelivery: unknown;
  deps: EventConsumerDeps;
  beforeDispatch?: (event: BaseEvent<any>) => Promise<void>;
  handler: (event: BaseEvent<any>) => Promise<void>;
  traceCtx: ReturnType<typeof traceContextFromEvent>;
}): Promise<ProcessSingleResult> {
  const { baseEvent, rawForDelivery, deps, beforeDispatch, handler, traceCtx } = params;

  try {
    await beforeDispatch?.(baseEvent);
    await handler(baseEvent);
  } catch (err) {
    const effectiveAttempt = computeEffectiveDeliveryAttempt(
      rawForDelivery,
      baseEvent.meta?.retryCount,
    );

    const decision = evaluateDeliveryPolicy({
      effectiveAttempt,
      maxAttempts: deps.retry.maxAttempts,
      dlq: deps.dlq ?? { enabled: false },
      error: err,
      allowTransportRetry: true,
      delayMs: deps.retry.delayMs,
    });

    if (decision.type === 'retry') {
      if (deps.transportRetry) {
        await deps.transportRetry.scheduleRetry({
          rawEvent: rawForDelivery,
          retryCount: decision.nextRetryCount ?? effectiveAttempt + 1,
          delayMs: decision.delayMs ?? deps.retry.delayMs,
        });
        recordConsumerRetry(baseEvent.eventType, decision.nextRetryCount);
        deps.tracing?.onRetry?.({
          ...traceCtx,
          attempt: effectiveAttempt,
          delayMs: decision.delayMs,
          reason: decision.reason,
        });
        return { outcome: 'retry_scheduled' };
      }

      recordConsumerRetry(baseEvent.eventType, effectiveAttempt);
      deps.tracing?.onRetry?.({
        ...traceCtx,
        attempt: effectiveAttempt,
        delayMs: decision.delayMs,
        reason: decision.reason,
      });
      return { outcome: 'needs_transport_retry', error: err };
    }

    return applyTerminalDecision(decision, err, {
      rawForDelivery,
      deps,
      baseEvent,
      effectiveAttempt,
      traceCtx,
    });
  }

  try {
    await deps.idempotencyStrategy.afterSuccess({
      eventId: baseEvent.eventId,
      eventType: baseEvent.eventType,
    });
  } catch (idemErr) {
    console.error('Idempotency afterSuccess failed', {
      eventId: baseEvent.eventId,
      error: idemErr,
    });
  }

  fireProcessingSuccess(deps.tracing, traceCtx);
  recordConsumerEventProcessed(baseEvent.eventType);
  return { outcome: 'success' };
}

async function runInProcessHandlerAttempts(params: {
  baseEvent: BaseEvent<any>;
  rawForDelivery: unknown;
  deps: EventConsumerDeps;
  beforeDispatch?: (event: BaseEvent<any>) => Promise<void>;
  handler: (event: BaseEvent<any>) => Promise<void>;
  traceCtx: ReturnType<typeof traceContextFromEvent>;
}): Promise<ProcessSingleResult> {
  const { baseEvent, rawForDelivery, deps, beforeDispatch, handler, traceCtx } = params;

  let current: BaseEvent<any> = baseEvent;
  const max = Math.max(1, deps.retry.maxAttempts);

  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      await beforeDispatch?.(current);
      await handler(current);
    } catch (err) {
      const decision = evaluateDeliveryPolicy({
        effectiveAttempt: attempt,
        maxAttempts: max,
        dlq: deps.dlq ?? { enabled: false },
        error: err,
        allowTransportRetry: attempt < max,
        delayMs: deps.retry.delayMs,
      });

      if (decision.type === 'retry' && attempt < max) {
        recordConsumerRetry(current.eventType, attempt);
        deps.tracing?.onRetry?.({
          ...traceCtx,
          attempt,
          delayMs: decision.delayMs,
          reason: decision.reason,
        });
        await sleep(decision.delayMs ?? deps.retry.delayMs);
        current = {
          ...current,
          meta: {
            ...current.meta,
            retryCount: attempt,
          },
        };
        continue;
      }

      return applyTerminalDecision(decision, err, {
        rawForDelivery,
        deps,
        baseEvent: current,
        effectiveAttempt: attempt,
        traceCtx,
      });
    }

    try {
      await deps.idempotencyStrategy.afterSuccess({
        eventId: current.eventId,
        eventType: current.eventType,
      });
    } catch (idemErr) {
      console.error('Idempotency afterSuccess failed', {
        eventId: current.eventId,
        error: idemErr,
      });
    }

    fireProcessingSuccess(deps.tracing, traceCtx);
    recordConsumerEventProcessed(current.eventType);
    return { outcome: 'success' };
  }

  throw new Error('unreachable: in-process handler attempts exhausted without outcome');
}

export async function orchestratePreparedConsumerEvent({
  baseEvent,
  rawForDelivery,
  deps,
  registry,
  beforeDispatch,
}: {
  baseEvent: BaseEvent<any>;
  rawForDelivery: unknown;
  deps: EventConsumerDeps;
  registry: Record<string, (event: BaseEvent<any>) => Promise<void>>;
  beforeDispatch?: (event: BaseEvent<any>) => Promise<void>;
}): Promise<ProcessSingleResult> {
  const traceCtx = traceContextFromEvent(baseEvent);
  fireProcessingStart(deps.tracing, traceCtx);

  const idemContext = {
    eventId: baseEvent.eventId,
    eventType: baseEvent.eventType,
  };

  const idemDecision = await deps.idempotencyStrategy.before(idemContext);

  if (idemDecision === 'DUPLICATE') {
    recordConsumerDuplicateEvent(baseEvent.eventType);
    return { outcome: 'duplicate' };
  }

  if (idemDecision === 'RETRY') {
    return handleIdempotencyContention({
      rawForDelivery,
      deps,
      baseEvent,
      traceCtx,
    });
  }

  const handler = registry[baseEvent.eventType];
  if (!handler) {
    const err = new Error(`No handler for ${baseEvent.eventType}`);
    const effectiveAttempt = computeEffectiveDeliveryAttempt(
      rawForDelivery,
      baseEvent.meta?.retryCount,
    );
    const decision = evaluateDeliveryPolicy({
      effectiveAttempt,
      maxAttempts: deps.retry.maxAttempts,
      dlq: deps.dlq ?? { enabled: false },
      error: err,
      allowTransportRetry: true,
      delayMs: deps.retry.delayMs,
    });

    if (decision.type === 'retry') {
      if (deps.transportRetry) {
        await deps.transportRetry.scheduleRetry({
          rawEvent: rawForDelivery,
          retryCount: decision.nextRetryCount ?? effectiveAttempt + 1,
          delayMs: decision.delayMs ?? deps.retry.delayMs,
        });
        recordConsumerRetry(baseEvent.eventType, decision.nextRetryCount);
        return { outcome: 'retry_scheduled' };
      }
      return { outcome: 'needs_transport_retry', error: err };
    }

    return applyTerminalDecision(decision, err, {
      rawForDelivery,
      deps,
      baseEvent,
      effectiveAttempt,
      traceCtx,
    });
  }

  const sqsSurface = useSqsSurfaceRetry(rawForDelivery, deps);

  if (sqsSurface || deps.transportRetry) {
    return runSingleHandlerAttempt({
      baseEvent,
      rawForDelivery,
      deps,
      beforeDispatch,
      handler,
      traceCtx,
    });
  }

  return runInProcessHandlerAttempts({
    baseEvent,
    rawForDelivery,
    deps,
    beforeDispatch,
    handler,
    traceCtx,
  });
}

export async function handlePreparationFailure(
  err: unknown,
  raw: unknown,
  deps: EventConsumerDeps,
  partialEvent: BaseEvent<any> | undefined,
): Promise<ProcessSingleResult> {
  const eventType = partialEvent?.eventType;
  const effectiveAttempt = computeEffectiveDeliveryAttempt(
    raw,
    partialEvent?.meta?.retryCount,
  );
  const dlq = deps.dlq ?? { enabled: false };
  const correlationId =
    partialEvent?.meta?.correlationId?.trim() ||
    partialEvent?.eventId ||
    getContext().correlationId ||
    'unknown';

  const traceCtx = partialEvent
    ? traceContextFromEvent(partialEvent)
    : {
        correlationId,
        eventId: correlationId,
        eventType: eventType ?? 'unknown',
      };

  const decision = evaluateDeliveryPolicy({
    effectiveAttempt,
    maxAttempts: deps.retry.maxAttempts,
    dlq,
    error: err,
    allowTransportRetry: true,
    delayMs: deps.retry.delayMs,
  });

  const stage =
    err instanceof Error && err.message.includes('correlationId')
      ? ('schema' as const)
      : err instanceof Error && err.message.includes('version')
        ? ('version' as const)
        : ('schema' as const);

  fireProcessingFailure(deps.tracing, {
    stage,
    error: err,
    correlationId: traceCtx.correlationId,
    eventId: traceCtx.eventId,
    eventType: traceCtx.eventType,
  });

  if (decision.type === 'retry') {
    if (deps.transportRetry) {
      await deps.transportRetry.scheduleRetry({
        rawEvent: raw,
        retryCount: decision.nextRetryCount ?? effectiveAttempt + 1,
        delayMs: decision.delayMs ?? deps.retry.delayMs,
      });
      recordConsumerRetry(eventType, decision.nextRetryCount);
      return { outcome: 'retry_scheduled' };
    }
    recordConsumerRetry(eventType, effectiveAttempt);
    return { outcome: 'needs_transport_retry', error: err };
  }

  return applyTerminalDecision(decision, err, {
    rawForDelivery: raw,
    deps,
    baseEvent: partialEvent,
    effectiveAttempt,
    traceCtx,
  });
}
