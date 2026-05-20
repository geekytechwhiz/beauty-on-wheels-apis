import type { BaseEvent } from '../../typings/base-event.types';
import type { EventConsumerDeps } from '../../typings/consumer.types';
import { processBatch } from '../processor/process-batch';
import type { ProcessSingleResult } from '../processor/process-outcomes';
import { processSingle } from '../processor/process-single';
import { extractRecords } from '../normalizer/transport-normalizer';

/**
 * Optional hook to wrap each record processor (e.g. per-message AsyncLocalStorage,
 * tracing, or metrics scoping) without changing {@link processSingle} semantics.
 */
export type ConsumeEventWrapProcessSingle = (_args: {
  raw: unknown;
  run: () => Promise<ProcessSingleResult>;
}) => Promise<ProcessSingleResult>;

export type ConsumeEventOptions = {
  wrapProcessSingle?: ConsumeEventWrapProcessSingle;
};

export function consumeEvent(
  deps: EventConsumerDeps,
  registry: Record<string, (_event: BaseEvent<unknown>) => Promise<void>>,
  beforeDispatch?: (_event: BaseEvent<unknown>) => Promise<void>,
  consumeOptions?: ConsumeEventOptions,
) {
  return async function consumed(rawEvent: unknown) {
    const records = extractRecords(rawEvent);

    const runOne = (raw: unknown) => {
      const run = () =>
        processSingle({ raw, deps, registry, beforeDispatch });
      return consumeOptions?.wrapProcessSingle
        ? consumeOptions.wrapProcessSingle({ raw, run })
        : run();
    };

    if (records) {
      return processBatch(
        records,
        ({ raw }) => runOne(raw),
        {
          concurrency: deps.batchConcurrency,
          sqsFifoGroupScheduling: deps.sqsFifoGroupScheduling,
          sqsFifoPoisonReceiveCountThreshold:
            deps.sqsFifoPoisonReceiveCountThreshold,
          tracing: deps.tracing,
        },
      );
    }

    return runOne(rawEvent);
  };
}
