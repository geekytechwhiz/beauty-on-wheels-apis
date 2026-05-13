/**
 * @jest-environment node
 */
import {
  recordSqsFifoBatchPoisonShortCircuit,
  recordSqsFifoBatchScheduleSnapshot,
  recordSqsFifoBatchTailDeferred,
} from '@api-hub/observability';

import type { EventTracingHooks } from '../../core/tracing/event-tracing-hooks';
import { processBatch } from './process-batch';
import {
  partitionSqsBatchBySchedulingLane,
  runFifoAwareSqsBatchProcess,
  sqsFifoSchedulingLaneKey,
} from './sqs-fifo-group-scheduler';

jest.mock('@api-hub/observability', () => {
  const actual = jest.requireActual('@api-hub/observability');
  return {
    ...actual,
    getLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
    recordSqsFifoBatchScheduleSnapshot: jest.fn(),
    recordSqsFifoBatchTailDeferred: jest.fn(),
    recordSqsFifoBatchPoisonShortCircuit: jest.fn(),
  };
});

function sqsRecord(
  messageId: string,
  fifo?: { messageGroupId?: string; receiveCount?: string },
) {
  return {
    messageId,
    body: '{}',
    receiptHandle: `rh-${messageId}`,
    attributes: {
      ...(fifo?.messageGroupId
        ? { MessageGroupId: fifo.messageGroupId }
        : {}),
      ...(fifo?.receiveCount
        ? { ApproximateReceiveCount: fifo.receiveCount }
        : {}),
    },
  };
}

describe('sqsFifoSchedulingLaneKey / partitionSqsBatchBySchedulingLane', () => {
  it('uses MessageGroupId for FIFO lanes', () => {
    const r = sqsRecord('m1', { messageGroupId: 'orders' });
    expect(sqsFifoSchedulingLaneKey(r, 0)).toBe('fifo:orders');
  });

  it('uses one lane per standard message when no MessageGroupId', () => {
    const a = sqsRecord('a');
    const b = sqsRecord('b');
    expect(sqsFifoSchedulingLaneKey(a, 0)).toBe('ungrouped:a');
    expect(sqsFifoSchedulingLaneKey(b, 1)).toBe('ungrouped:b');
  });

  it('partitions preserves batch order within each lane', () => {
    const records = [
      sqsRecord('1', { messageGroupId: 'A' }),
      sqsRecord('2', { messageGroupId: 'B' }),
      sqsRecord('3', { messageGroupId: 'A' }),
    ];
    const parts = partitionSqsBatchBySchedulingLane(records);
    expect(parts.find((p) => p.laneKey === 'fifo:A')?.indices).toEqual([0, 2]);
    expect(parts.find((p) => p.laneKey === 'fifo:B')?.indices).toEqual([1]);
  });
});

describe('runFifoAwareSqsBatchProcess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs same MessageGroupId strictly in batch index order', async () => {
    const order: string[] = [];
    const records = [
      sqsRecord('a', { messageGroupId: 'G' }),
      sqsRecord('b', { messageGroupId: 'G' }),
      sqsRecord('c', { messageGroupId: 'G' }),
    ];
    await runFifoAwareSqsBatchProcess(
      records,
      async ({ raw }) => {
        order.push((raw as { messageId: string }).messageId);
        return { outcome: 'success' };
      },
      { concurrency: 10 },
    );
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('allows concurrent heads across different groups (simulation)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const records = [
      sqsRecord('g1-1', { messageGroupId: 'G1' }),
      sqsRecord('g2-1', { messageGroupId: 'G2' }),
    ];
    await runFifoAwareSqsBatchProcess(
      records,
      async ({ raw }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 25));
        inFlight -= 1;
        return { outcome: 'success' };
      },
      { concurrency: 2 },
    );
    expect(maxInFlight).toBe(2);
  });

  it('caps global concurrency across lanes', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const records = [
      sqsRecord('g1-1', { messageGroupId: 'G1' }),
      sqsRecord('g2-1', { messageGroupId: 'G2' }),
      sqsRecord('g3-1', { messageGroupId: 'G3' }),
    ];
    await runFifoAwareSqsBatchProcess(
      records,
      async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        inFlight -= 1;
        return { outcome: 'success' };
      },
      { concurrency: 2 },
    );
    expect(maxInFlight).toBe(2);
  });

  it('keeps at most one in-flight handler per FIFO lane even with high concurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const records = [
      sqsRecord('a', { messageGroupId: 'only' }),
      sqsRecord('b', { messageGroupId: 'only' }),
      sqsRecord('c', { messageGroupId: 'only' }),
    ];
    await runFifoAwareSqsBatchProcess(
      records,
      async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 12));
        inFlight -= 1;
        return { outcome: 'success' };
      },
      { concurrency: 20 },
    );
    expect(maxInFlight).toBe(1);
  });

  it('defers same-lane tails when head is not acked (failure simulation)', async () => {
    const calls: string[] = [];
    const records = [
      sqsRecord('m1', { messageGroupId: 'X' }),
      sqsRecord('m2', { messageGroupId: 'X' }),
      sqsRecord('m3', { messageGroupId: 'X' }),
    ];
    const tracing = {
      onFifoBatchTailDeferred: jest.fn(),
    } as unknown as EventTracingHooks;

    const { batchItemFailures } = await processBatch(
      records,
      async ({ raw }) => {
        calls.push((raw as { messageId: string }).messageId);
        if ((raw as { messageId: string }).messageId === 'm1') {
          return { outcome: 'success' };
        }
        return { outcome: 'needs_transport_retry' };
      },
      {
        concurrency: 5,
        sqsFifoGroupScheduling: true,
        tracing,
      },
    );

    expect(calls).toEqual(['m1', 'm2']);
    expect(batchItemFailures.map((f) => f.itemIdentifier).sort()).toEqual([
      'm2',
      'm3',
    ]);
    expect(tracing.onFifoBatchTailDeferred).toHaveBeenCalledWith(
      expect.objectContaining({
        schedulingLaneKey: 'fifo:X',
        skippedMessageIds: ['m3'],
        reason: 'head_not_acked',
      }),
    );
    expect(recordSqsFifoBatchTailDeferred).toHaveBeenCalledWith(
      1,
      'head_not_acked',
    );
  });

  it('short-circuits poison by receive count and defers tail with poison reason', async () => {
    const calls: string[] = [];
    const records = [
      sqsRecord('m1', {
        messageGroupId: 'P',
        receiveCount: '5',
      }),
      sqsRecord('m2', { messageGroupId: 'P', receiveCount: '1' }),
    ];
    const tracing = {
      onFifoBatchTailDeferred: jest.fn(),
    } as unknown as EventTracingHooks;

    const { batchItemFailures } = await processBatch(
      records,
      async ({ raw }) => {
        calls.push((raw as { messageId: string }).messageId);
        return { outcome: 'success' };
      },
      {
        concurrency: 3,
        sqsFifoGroupScheduling: true,
        sqsFifoPoisonReceiveCountThreshold: 3,
        tracing,
      },
    );

    expect(calls).toEqual([]);
    expect(batchItemFailures.map((f) => f.itemIdentifier).sort()).toEqual([
      'm1',
      'm2',
    ]);
    expect(recordSqsFifoBatchPoisonShortCircuit).toHaveBeenCalled();
    expect(tracing.onFifoBatchTailDeferred).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'poison_receive_count_threshold',
        skippedMessageIds: ['m2'],
      }),
    );
  });

  it('emits schedule snapshot metrics once per batch', async () => {
    await runFifoAwareSqsBatchProcess(
      [sqsRecord('a'), sqsRecord('b')],
      async () => ({ outcome: 'success' }),
      { concurrency: 2 },
    );
    expect(recordSqsFifoBatchScheduleSnapshot).toHaveBeenCalledWith({
      groupCount: 2,
      recordCount: 2,
    });
  });
});
