import { EventValidationError } from './validate-base-event';
import { normalizeEventMeta } from './normalize-event-meta';

import type { BaseEvent, NormalizeMetaOptions } from '../../typings/base-event.types';
import type { EventConsumerDeps } from '../../typings/consumer.types';

import { resolveSchema } from '../schema/schema-resolver';
import { assertVersionCompatible } from '../versioning/version-compatibility';
import { enforceRegisteredEventCompatibility } from '../../governance/schema-compatibility';

/**
 * Ensures correlation exists for tracing and logs after {@link normalizeEventMeta}.
 */
export function assertCorrelationIdPresent<T>(event: BaseEvent<T>): void {
  const c = event.meta?.correlationId?.trim();
  if (!c) {
    throw new EventValidationError('meta.correlationId is required after normalization');
  }
}

/**
 * Map → normalize meta → enforce correlation → version check → payload schema (execution layer only; no idempotency / DLQ).
 */
export function prepareInboundBaseEvent<T>(
  mapped: BaseEvent<T>,
  deps: EventConsumerDeps,
  normalizeOptions?: NormalizeMetaOptions,
): BaseEvent<T> {
  let baseEvent = normalizeEventMeta(mapped, normalizeOptions);
  assertCorrelationIdPresent(baseEvent);

  if (deps.versionCheck !== undefined) {
    assertVersionCompatible(baseEvent.eventVersion, deps.versionCheck);
  }

  enforceRegisteredEventCompatibility(baseEvent.eventType, baseEvent.eventVersion);

  if (deps.payloadSchemas !== undefined) {
    const schema = resolveSchema(
      deps.payloadSchemas,
      baseEvent.eventType,
      baseEvent.eventVersion,
      deps.schemaResolution,
    );
    baseEvent = {
      ...baseEvent,
      payload: schema.parse(baseEvent.payload) as T,
    };
  }

  return baseEvent;
}
