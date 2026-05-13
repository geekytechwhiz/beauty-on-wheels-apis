import {
  getLogger,
  recordSqsFifoBatchPoisonShortCircuit,
  recordSqsFifoBatchScheduleSnapshot,
  recordSqsFifoBatchTailDeferred,
} from '@api-hub/observability';

import { fireFifoBatchTailDeferred } from '../../core/tracing/event-tracing-hooks';
import type { EventTracingHooks } from '../../core/tracing/event-tracing-hooks';
import {
  approximateReceiveCountFromSqsRecord,
  getSqsRecordShape,
} from '../../lib/sqs-per-message-context';
import type { ProcessSingleResult } from './process-outcomes';
import { isAckedWithoutBatchFailure } from './process-outcomes';

/** Stable lane key: FIFO uses MessageGroupId; standard SQS uses one lane per messageId. */
export function sqsFifoSchedulingLaneKey(raw: unknown, batchIndex: number): string {
  const r = getSqsRecordShape(raw);
  const attrs = r?.attributes as Record<string, string> | undefined;
  const mg = attrs?.MessageGroupId;
  if (typeof mg === 'string' && mg.length > 0) {
    return `fifo:${mg}`;
  }
  const mid = r?.messageId;
  if (typeof mid === 'string' && mid.length > 0) {
    return `ungrouped:${mid}`;
  }
  return `ungrouped:idx:${batchIndex}`;
}

function batchRecordItemIdentifier(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const r = raw as {
      messageId?: string;
      eventID?: string;
      sequenceNumber?: string;
    };
    return r.messageId ?? r.eventID ?? r.sequenceNumber ?? 'unknown';
  }
  return 'unknown';
}

export type FifoLanePartition = { laneKey: string; indices: number[] };

/**
 * Preserves batch-relative order within each scheduling lane (MessageGroupId or per-message lane).
 */
export function partitionSqsBatchBySchedulingLane(
  records: unknown[],
): FifoLanePartition[] {
  const order: string[] = [];
  const map = new Map<string, number[]>();
  records.forEach((raw, index) => {
    const laneKey = sqsFifoSchedulingLaneKey(raw, index);
    if (!map.has(laneKey)) {
      order.push(laneKey);
      map.set(laneKey, []);
    }
    map.get(laneKey)!.push(index);
  });
  return order.map((laneKey) => ({
    laneKey,
    indices: map.get(laneKey)!,
  }));
}

class AsyncSemaphore {
  private available: number;

  private readonly waiters: Array<() => void> = [];

  constructor(capacity: number) {
    this.available = Math.max(1, capacity);
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.available += 1;
    }
  }
}

function isUnlimitedConcurrency(concurrency: number): boolean {
  return !Number.isFinite(concurrency) || concurrency < 1;
}

async function withConcurrencySlot<T>(
  sem: AsyncSemaphore | null,
  fn: () => Promise<T>,
): Promise<T> {
  if (!sem) {
    return fn();
  }
  await sem.acquire();
  try {
    return await fn();
  } finally {
    sem.release();
  }
}

type ProcessSingleOutcomeOrThrow =
  | { kind: 'outcome'; outcome: ProcessSingleResult['outcome'] }
  | { kind: 'throw'; error: unknown };

function outcomeFromSettled(
  res: PromiseSettledResult<ProcessSingleResult>,
): ProcessSingleOutcomeOrThrow {
  if (res.status === 'rejected') {
    return { kind: 'throw', error: res.reason };
  }
  return { kind: 'outcome', outcome: res.value.outcome };
}

function isAckedOutcomeOrThrow(o: ProcessSingleOutcomeOrThrow): boolean {
  if (o.kind === 'throw') {
    return false;
  }
  return isAckedWithoutBatchFailure(o.outcome);
}

async function invokeProcessOne(
  processOne: (input: { raw: unknown }) => Promise<ProcessSingleResult>,
  raw: unknown,
): Promise<PromiseSettledResult<ProcessSingleResult>> {
  try {
    const value = await processOne({ raw });
    return { status: 'fulfilled', value };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

/**
 * FIFO-aware scheduling: strict order within each scheduling lane (`MessageGroupId` or per-message),
 * capped by a global concurrency limit across lanes. Head-of-line failure defers later records in the
 * same lane (partial batch parity). Optional poison short-circuit by receive count.
 */
export async function runFifoAwareSqsBatchProcess(
  records: unknown[],
  processOne: (input: { raw: unknown }) => Promise<ProcessSingleResult>,
  options: {
    concurrency: number;
    poisonReceiveCountThreshold?: number;
    tracing?: EventTracingHooks;
  },
): Promise<PromiseSettledResult<ProcessSingleResult>[]> {
  const results: PromiseSettledResult<ProcessSingleResult>[] = new Array(
    records.length,
  );

  const partitions = partitionSqsBatchBySchedulingLane(records);
  recordSqsFifoBatchScheduleSnapshot({
    groupCount: partitions.length,
    recordCount: records.length,
  });
  getLogger().info('sqs_fifo_batch_schedule', {
    logType: 'sqs_fifo_batch',
    groupCount: partitions.length,
    recordCount: records.length,
    concurrency: options.concurrency,
    laneSample: partitions.slice(0, 32).map((p) => p.laneKey),
  });

  const sem = isUnlimitedConcurrency(options.concurrency)
    ? null
    : new AsyncSemaphore(options.concurrency);

  const poisonThreshold = options.poisonReceiveCountThreshold;

  const drainLane = async (lane: FifoLanePartition): Promise<void> => {
    for (let p = 0; p < lane.indices.length; p += 1) {
      const batchIndex = lane.indices[p]!;
      const raw = records[batchIndex]!;

      const settled = await withConcurrencySlot(sem, async () => {
        const rc = approximateReceiveCountFromSqsRecord(raw);
        if (
          poisonThreshold !== undefined &&
          rc !== undefined &&
          rc >= poisonThreshold
        ) {
          recordSqsFifoBatchPoisonShortCircuit(1);
          getLogger().warn('sqs_fifo_batch_poison_short_circuit', {
            logType: 'sqs_fifo_batch',
            schedulingLaneKey: lane.laneKey,
            messageId: batchRecordItemIdentifier(raw),
            approximateReceiveCount: rc,
            poisonReceiveCountThreshold: poisonThreshold,
          });
          const poisonResult: ProcessSingleResult = {
            outcome: 'needs_transport_retry',
          };
          return {
            status: 'fulfilled' as const,
            value: poisonResult,
          };
        }
        return invokeProcessOne(processOne, raw);
      });

      results[batchIndex] = settled;
      const head = outcomeFromSettled(settled);
      if (isAckedOutcomeOrThrow(head)) {
        continue;
      }

      const tailIndices = lane.indices.slice(p + 1);
      if (tailIndices.length === 0) {
        return;
      }

      const skippedIds = tailIndices.map((i) => batchRecordItemIdentifier(records[i]!));
      const reason: 'head_not_acked' | 'poison_receive_count_threshold' =
        poisonThreshold !== undefined &&
        (() => {
          const rc = approximateReceiveCountFromSqsRecord(raw);
          return rc !== undefined && rc >= poisonThreshold;
        })()
          ? 'poison_receive_count_threshold'
          : 'head_not_acked';

      recordSqsFifoBatchTailDeferred(tailIndices.length, reason);
      getLogger().warn('sqs_fifo_batch_tail_deferred', {
        logType: 'sqs_fifo_batch',
        schedulingLaneKey: lane.laneKey,
        skippedMessageIds: skippedIds,
        reason,
        blockingBatchIndex: batchIndex,
        blockingMessageId: batchRecordItemIdentifier(raw),
      });
      fireFifoBatchTailDeferred(options.tracing, {
        schedulingLaneKey: lane.laneKey,
        skippedMessageIds: skippedIds,
        reason,
        blockingMessageId: batchRecordItemIdentifier(raw),
        blockingBatchIndex: batchIndex,
      });

      for (const ti of tailIndices) {
        results[ti] = {
          status: 'fulfilled',
          value: { outcome: 'needs_transport_retry' },
        };
      }
      return;
    }
  };

  await Promise.all(partitions.map((lane) => drainLane(lane)));
  return results;
}
