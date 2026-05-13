import type { EventTracingHooks } from '../../core/tracing/event-tracing-hooks';
import type { ProcessSingleResult } from './process-outcomes';

import { isAckedWithoutBatchFailure } from './process-outcomes';
import { runFifoAwareSqsBatchProcess } from './sqs-fifo-group-scheduler';

function itemIdentifier(record: unknown): string {
  if (record && typeof record === 'object') {
    const r = record as {
      messageId?: string;
      eventID?: string;
      sequenceNumber?: string;
    };
    return r.messageId ?? r.eventID ?? r.sequenceNumber ?? 'unknown';
  }
  return 'unknown';
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = index++;
      if (current >= items.length) {
        return;
      }
      results[current] = await mapper(items[current], current);
    }
  }

  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export type ProcessBatchOptions = {
  concurrency?: number;
  sqsFifoGroupScheduling?: boolean;
  sqsFifoPoisonReceiveCountThreshold?: number;
  tracing?: EventTracingHooks;
};

export async function processBatch(
  records: unknown[],
  processOne: (input: { raw: unknown }) => Promise<ProcessSingleResult>,
  options?: ProcessBatchOptions,
): Promise<{ batchItemFailures: { itemIdentifier: string }[] }> {
  const concurrency = options?.concurrency ?? Number.POSITIVE_INFINITY;

  const runMapped = async (
    recordsList: unknown[],
  ): Promise<PromiseSettledResult<ProcessSingleResult>[]> => {
    if (options?.sqsFifoGroupScheduling && recordsList.length > 0) {
      return runFifoAwareSqsBatchProcess(recordsList, processOne, {
        concurrency,
        poisonReceiveCountThreshold: options.sqsFifoPoisonReceiveCountThreshold,
        tracing: options.tracing,
      });
    }

    if (
      !Number.isFinite(concurrency) ||
      concurrency < 1 ||
      concurrency >= recordsList.length
    ) {
      return Promise.allSettled(recordsList.map((r) => processOne({ raw: r })));
    }

    const outcomes = await mapPool(recordsList, concurrency, (r) =>
      processOne({ raw: r }),
    );
    return outcomes.map((value) => ({ status: 'fulfilled' as const, value }));
  };

  const results = await runMapped(records);

  const batchItemFailures: { itemIdentifier: string }[] = [];

  results.forEach((res, i) => {
    if (
      res.status === 'rejected' ||
      (res.status === 'fulfilled' && !isAckedWithoutBatchFailure(res.value.outcome))
    ) {
      batchItemFailures.push({
        itemIdentifier: itemIdentifier(records[i]),
      });
    }
  });

  return { batchItemFailures };
}
