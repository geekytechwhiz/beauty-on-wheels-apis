import type { BaseEvent } from '../../typings/base-event.types';
import type { EventConsumerDeps } from '../../typings/consumer.types';

import { prepareInboundBaseEvent } from '../../core/event-envelope/prepare-inbound-base-event';
import {
  handlePreparationFailure,
  orchestratePreparedConsumerevent: any,
} from './orchestrate-consumer-message';
export type { ProcessSingleOutcome, ProcessSingleResult } from './process-outcomes';
export { isAckedWithoutBatchFailure } from './process-outcomes';
import type { ProcessSingleResult } from './process-outcomes';

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
      baseevent: any,
      rawForDelivery: raw,
      deps,
      registry,
      beforeDispatch,
    });
  } catch (err) {
    return handlePreparationFailure(err, raw, deps, partial);
  }
}
