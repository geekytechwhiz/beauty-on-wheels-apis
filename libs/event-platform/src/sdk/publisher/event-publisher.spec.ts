import { generateIdempotencyKey } from '../../core/idempotency/generate-idempotency-key';
import { buildPublishEnvelope } from './build-publish-envelope';
import { EventPublisher } from './event-publisher';

describe('buildPublishEnvelope', () => {
  it('produces a structurally correct BaseEvent', () => {
    const input = {
      eventType: 'Order.Placed',
      version: '1',
      source: 'orders-api',
      payload: { orderId: 'o1' },
      correlationId: 'corr-1',
    };
    const event = buildPublishEnvelope(input);

    expect(event.eventType).toBe('Order.Placed');
    expect(event.version).toBe('1');
    expect(event.source).toBe('orders-api');
    expect(event.payload).toEqual({ orderId: 'o1' });
    expect(event.correlationId).toBe('corr-1');
    expect(event.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.idempotencyKey).toBe(
      generateIdempotencyKey({
        eventType: input.eventType,
        version: input.version,
        source: input.source,
        payload: input.payload,
      }),
    );
  });

  it('is stable idempotency for identical publish inputs', () => {
    const input = {
      eventType: 'X',
      version: '1',
      source: 's',
      payload: { a: 1 },
    };
    expect(buildPublishEnvelope(input).idempotencyKey).toBe(
      buildPublishEnvelope(input).idempotencyKey,
    );
  });
});

describe('EventPublisher', () => {
  it('delegates to the adapter with the built envelope', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const publisher = new EventPublisher({
      adapter: { publish },
    });

    const input = {
      eventType: 'T',
      version: '1',
      source: 'src',
      payload: { k: true },
    };

    await publisher.publish(input);

    expect(publish).toHaveBeenCalledTimes(1);
    const arg = publish.mock.calls[0][0];
    expect(arg.eventType).toBe('T');
    expect(arg.version).toBe('1');
    expect(arg.source).toBe('src');
    expect(arg.payload).toEqual({ k: true });
    expect(arg.idempotencyKey).toBe(
      generateIdempotencyKey({
        eventType: input.eventType,
        version: input.version,
        source: input.source,
        payload: input.payload,
      }),
    );
  });
});
