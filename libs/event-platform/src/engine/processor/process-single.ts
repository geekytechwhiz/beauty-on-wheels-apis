import type { BaseEvent } from '../../typings/base-event.types';
import type { EventConsumerDeps } from '../../typings/consumer.types';

import { prepareInboundBaseEvent } from '../../core/event-envelope/prepare-inbound-base-event';
import {
  handlePreparationFailure,
  orchestratePreparedConsumerEvent,
} from './orchestrate-consumer-message';
export type { ProcessSingleOutcome, ProcessSingleResult } from './process-outcomes';
export { isAckedWithoutBatchFailure } from './process-outcomes';
import type { ProcessSingleResult } from './process-outcomes';

import { recordDynamoStreamRecordFiltered } from '@api-hub/observability';

import { StreamRecordFilteredError } from '../../dynamo-stream/stream-record-filtered.error';
import { effectiveTransportMode } from '../../typings/consumer.types';

export async function processSingle({
  raw,
  deps,
  registry,
  beforeDispatch,
}: {
  raw: unknown;
  deps: EventConsumerDeps;
  registry: Record<string, (event: BaseEvent<any>) => Promise<void>>;
  beforeDispatch?: (event: BaseEvent<any>) => Promise<void>;
}): Promise<ProcessSingleResult> {
  let partial: BaseEvent<any> | undefined;

  try {
    partial = deps.mapRawToBaseEvent
      ? deps.mapRawToBaseEvent(raw)
      : (raw as BaseEvent<any>);
    if (partial == null) {
      throw new Error('Event mapping produced no event');
    }
    const baseEvent = prepareInboundBaseEvent(partial, deps);
    return await orchestratePreparedConsumerEvent({
      baseEvent,
      rawForDelivery: raw,
      deps,
      registry,
      beforeDispatch,
    });
  } catch (err) {
    if (err instanceof StreamRecordFilteredError) {
      if (effectiveTransportMode(deps) === 'dynamodb-stream') {
        recordDynamoStreamRecordFiltered(1);
      }
      return { outcome: 'success' };
    }
    return handlePreparationFailure(err, raw, deps, partial);
  }
}
