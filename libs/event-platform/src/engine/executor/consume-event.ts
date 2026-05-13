import type { BaseEvent } from '../../typings/base-event.types';
import type { EventConsumerDeps } from '../../typings/consumer.types';
import { processBatch } from '../processor/process-batch';
import { processSingle } from '../processor/process-single';
import { extractRecords } from '../normalizer/transport-normalizer';

export function consumeEvent(
  deps: EventConsumerDeps,
  registry: Record<string, (event: BaseEvent<any>) => Promise<void>>,
  beforeDispatch?: (event: BaseEvent<any>) => Promise<void>,
) {
  return async function consumed(rawEvent: unknown) {
    const records = extractRecords(rawEvent);

    if (records) {
      return processBatch(
        records,
        ({ raw }) => processSingle({ raw, deps, registry, beforeDispatch }),
        { concurrency: deps.batchConcurrency },
      );
    }

    return processSingle({
      raw: rawevent: any,
      deps,
      registry,
      beforeDispatch,
    });
  };
}
