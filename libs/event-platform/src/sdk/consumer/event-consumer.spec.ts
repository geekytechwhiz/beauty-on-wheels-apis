import { z } from 'zod';

import { EventSchemaError } from '../../core/schema/event-schema-error';
import { VersionIncompatibleError } from '../../core/versioning/version-compatibility';
import { InMemoryIdempotencyStore } from '../../core/idempotency/in-memory-idempotency-store';
import type { BaseEvent } from '../../core/event-envelope/base-event';
import { EventConsumer } from './event-consumer';

function makeEvent(overrides: Partial<BaseEvent<{ x: number }>> = {}): BaseEvent<{ x: number }> {
  return {
    eventId: 'e1',
    eventType: 't',
    version: '1.0.0',
    timestamp: '2026-01-01T00:00:00.000Z',
    source: 's',
    idempotencyKey: 'idem-1',
    payload: { x: 1 },
    ...overrides,
  };
}

const payloadSchemaT = { t: z.object({ x: z.number() }) };

const fastRetry = {
  maxAttempts: 5,
  strategy: 'fixed' as const,
  delayMs: 1,
};

const shortRetry = {
  maxAttempts: 2,
  strategy: 'fixed' as const,
  delayMs: 1,
};

describe('EventConsumer', () => {
  it('runs the success path and records idempotency', async () => {
    const store = new InMemoryIdempotencyStore();
    const consumer = new EventConsumer({
      idempotencyStore: store,
      retry: fastRetry,
    });
    const evt = makeEvent();
    const handler = jest.fn().mockResolvedValue(undefined);

    const result = await consumer.handle(evt, handler);

    expect(result).toEqual({ outcome: 'processed' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(evt);
    expect(await store.exists(evt.idempotencyKey)).toBe(true);
  });

  it('skips duplicate events', async () => {
    const store = new InMemoryIdempotencyStore();
    const consumer = new EventConsumer({
      idempotencyStore: store,
      retry: fastRetry,
    });
    const evt = makeEvent({ idempotencyKey: 'dup-key' });
    const handler = jest.fn().mockResolvedValue(undefined);

    await consumer.handle(evt, handler);
    const second = await consumer.handle(evt, handler);

    expect(second).toEqual({
      outcome: 'duplicate',
      idempotencyKey: 'dup-key',
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('retries the handler until it succeeds', async () => {
    const store = new InMemoryIdempotencyStore();
    const consumer = new EventConsumer({
      idempotencyStore: store,
      retry: fastRetry,
    });
    const evt = makeEvent({ idempotencyKey: 'retry-key' });
    let calls = 0;
    const handler = jest.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 2) {
        throw new Error('transient');
      }
    });

    const result = await consumer.handle(evt, handler);

    expect(result).toEqual({ outcome: 'processed' });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(await store.exists('retry-key')).toBe(true);
  });

  it('accepts a JSON string event', async () => {
    const store = new InMemoryIdempotencyStore();
    const consumer = new EventConsumer({
      idempotencyStore: store,
      retry: fastRetry,
    });
    const evt = makeEvent({ idempotencyKey: 'json-key' });
    const handler = jest.fn().mockResolvedValue(undefined);

    await consumer.handle(JSON.stringify(evt), handler);

    expect(handler).toHaveBeenCalledWith(evt);
  });

  it('returns dead_letter_candidate after retries exhaust when DLQ awareness is enabled', async () => {
    const store = new InMemoryIdempotencyStore();
    const consumer = new EventConsumer({
      idempotencyStore: store,
      retry: shortRetry,
      dlq: { enabled: true },
    });
    const evt = makeEvent({ idempotencyKey: 'dlq-key' });
    const err = new Error('always fails');
    const handler = jest.fn().mockRejectedValue(err);

    const result = await consumer.handle(evt, handler);

    expect(result).toEqual({
      outcome: 'dead_letter_candidate',
      idempotencyKey: 'dlq-key',
      error: err,
    });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(await store.exists('dlq-key')).toBe(false);
  });

  it('rejects incompatible event versions before the handler', async () => {
    const store = new InMemoryIdempotencyStore();
    const consumer = new EventConsumer({
      idempotencyStore: store,
      retry: fastRetry,
      versionCheck: { strategy: 'strict', supportedVersion: '1.0.0' },
    });
    const handler = jest.fn().mockResolvedValue(undefined);

    await expect(
      consumer.handle(makeEvent({ version: '1.0.1' }), handler),
    ).rejects.toThrow(VersionIncompatibleError);

    expect(handler).not.toHaveBeenCalled();
  });

  it('accepts compatible versions under backward strategy', async () => {
    const store = new InMemoryIdempotencyStore();
    const consumer = new EventConsumer({
      idempotencyStore: store,
      retry: fastRetry,
      versionCheck: { strategy: 'backward', supportedVersion: '1.2.0' },
    });
    const handler = jest.fn().mockResolvedValue(undefined);

    const result = await consumer.handle(makeEvent({ version: '1.1.0' }), handler);

    expect(result).toEqual({ outcome: 'processed' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('runs payload schema validation before the handler when configured', async () => {
    const store = new InMemoryIdempotencyStore();
    const consumer = new EventConsumer({
      idempotencyStore: store,
      retry: fastRetry,
      payloadSchemas: payloadSchemaT,
    });
    const handler = jest.fn().mockResolvedValue(undefined);

    await consumer.handle(makeEvent({ payload: { x: 2 } }), handler);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fails payload schema validation before the handler runs', async () => {
    const store = new InMemoryIdempotencyStore();
    const consumer = new EventConsumer({
      idempotencyStore: store,
      retry: fastRetry,
      payloadSchemas: payloadSchemaT,
    });
    const handler = jest.fn().mockResolvedValue(undefined);

    await expect(
      consumer.handle(makeEvent({ payload: { x: 'bad' } as unknown as { x: number } }), handler),
    ).rejects.toThrow(EventSchemaError);

    expect(handler).not.toHaveBeenCalled();
  });

  it('rethrows after retries exhaust when DLQ awareness is disabled', async () => {
    const store = new InMemoryIdempotencyStore();
    const consumer = new EventConsumer({
      idempotencyStore: store,
      retry: shortRetry,
    });
    const evt = makeEvent({ idempotencyKey: 'throw-key' });
    const err = new Error('always fails');
    const handler = jest.fn().mockRejectedValue(err);

    await expect(consumer.handle(evt, handler)).rejects.toBe(err);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(await store.exists('throw-key')).toBe(false);
  });

  it('invokes tracing hooks on success', async () => {
    const onEventReceived = jest.fn();
    const onEventProcessed = jest.fn();
    const onEventFailed = jest.fn();
    const consumer = new EventConsumer({
      idempotencyStore: new InMemoryIdempotencyStore(),
      retry: fastRetry,
      tracing: { onEventReceived, onEventProcessed, onEventFailed },
    });

    await consumer.handle(makeEvent({ idempotencyKey: 'trace-ok' }), jest.fn());

    expect(onEventReceived).toHaveBeenCalledTimes(1);
    expect(onEventProcessed).toHaveBeenCalledTimes(1);
    expect(onEventFailed).not.toHaveBeenCalled();
  });

  it('prefers correlationId override for tracing context', async () => {
    const onEventReceived = jest.fn();
    const consumer = new EventConsumer({
      idempotencyStore: new InMemoryIdempotencyStore(),
      retry: fastRetry,
      tracing: {
        onEventReceived,
        onEventProcessed: jest.fn(),
        onEventFailed: jest.fn(),
      },
    });

    await consumer.handle(
      makeEvent({ correlationId: 'from-envelope', idempotencyKey: 'trace-corr' }),
      jest.fn(),
      { correlationId: 'from-override' },
    );

    expect(onEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'from-override' }),
    );
  });

  it('calls onEventFailed when schema validation fails', async () => {
    const onEventFailed = jest.fn();
    const consumer = new EventConsumer({
      idempotencyStore: new InMemoryIdempotencyStore(),
      retry: fastRetry,
      payloadSchemas: payloadSchemaT,
      tracing: {
        onEventReceived: jest.fn(),
        onEventProcessed: jest.fn(),
        onEventFailed,
      },
    });

    await expect(
      consumer.handle(
        makeEvent({ payload: { x: 'bad' } as unknown as { x: number }, idempotencyKey: 'bad-pl' }),
        jest.fn(),
      ),
    ).rejects.toThrow(EventSchemaError);

    expect(onEventFailed).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'schema' }),
    );
  });
});
