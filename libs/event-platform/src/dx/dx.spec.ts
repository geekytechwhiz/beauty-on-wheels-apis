import { z } from 'zod';

import { DomainIdempotencyStrategy } from '../core/idempotency/domain-idempotency.strategy';
import { configureEventPlatform } from './configure-event-pladtform';
import { defineEvent } from './define-event';
import { onEvent } from './on-event';
import { publishEvent } from './publish-event';

function baseConsumerOptions() {
  return {
    idempotencyStrategy: new DomainIdempotencyStrategy(),
    retry: { maxAttempts: 3, strategy: 'exponential' as const, delayMs: 1 },
    dlq: { enabled: false },
  };
}

describe('@api-hub/event-platform/dx', () => {
  describe('publishEvent', () => {
    it('delegates to SDK with eventType, source, version from __meta', async () => {
      const publish = jest.fn().mockResolvedValue(undefined);
      const schema = defineEvent(z.object({ orderId: z.string() }), {
        eventType: 'Order.Created',
        eventVersion: '1.0.0',
        source: 'orders-svc',
        transport: 'eventbridge',
      });

      configureEventPlatform({
        publishers: { eventbridge: { publish } },
        consumer: baseConsumerOptions(),
      });

      await publishEvent(schema, { orderId: 'o1' });

      expect(publish).toHaveBeenCalledTimes(1);
      const envelope = publish.mock.calls[0][0];
      expect(envelope.eventType).toBe('Order.Created');
      expect(envelope.eventVersion).toBe('1.0.0');
      expect(envelope.source).toBe('orders-svc');
      expect(envelope.payload).toEqual({ orderId: 'o1' });
    });

    it('allows version override via third argument', async () => {
      const publish = jest.fn().mockResolvedValue(undefined);
      const schema = defineEvent(z.object({ x: z.number() }), {
        eventType: 'X',
        eventVersion: '1.0.0',
        source: 's',
        transport: 'eventbridge',
      });

      configureEventPlatform({
        publishers: { eventbridge: { publish } },
        consumer: baseConsumerOptions(),
      });

      await publishEvent(schema, { x: 1 }, {
        version: '2.0.0',
        idempotencyKey: 'idem-1',
        meta: { correlationId: 'cc', tenantId: 'tenant-1' },
      });

      expect(publish).toHaveBeenCalledTimes(1);
      const envelope = publish.mock.calls[0][0];
      expect(envelope.eventVersion).toBe('2.0.0');
      expect(envelope.idempotencyKey).toBe('idem-1');
      expect(envelope.meta.correlationId).toBe('cc');
      expect(envelope.meta.tenantId).toBe('tenant-1');
    });
  });

  describe('onEvent', () => {
    it('delegates to EventConsumer.handle and flattens payload with meta', async () => {
      const schema = defineEvent(z.object({ orderId: z.string() }), {
        eventType: 'Order.Created',
        eventVersion: '1.0.0',
        source: 'orders-svc',
        transport: 'eventbridge',
      });

        configureEventPlatform({
        publishers: {
          eventbridge: { publish: jest.fn() },
        },
        payloadSchemas: {
          'Order.Created': { '1.0.0': schema },
        },
        consumer: {
          ...baseConsumerOptions(),
          payloadSchemas: {
            'Order.Created': { '1.0.0': schema },
          },
        },
      });

      const received: unknown[] = [];
      const handler = onEvent(schema, async (input) => {
        received.push(input);
      });

      const raw = {
        eventId: 'e1',
        eventType: 'Order.Created',
        eventVersion: '1.0.0',
        timestamp: new Date().toISOString(),
        source: 'orders-svc',
        idempotencyKey: 'idem-1',
        payload: { orderId: 'o1' },
        meta: { correlationId: 'c1' },
      };

      const result = await handler(raw);
      expect(result.outcome).toBe('processed');
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(
        expect.objectContaining({
          orderId: 'o1',
          meta: expect.objectContaining({ correlationId: 'c1' }),
        }),
      );
    });

    it('unwraps EventBridge detail before reading envelope meta', async () => {
      const schema = defineEvent(z.object({ orderId: z.string() }), {
        eventType: 'Order.Created',
        eventVersion: '1.0.0',
        source: 'orders-svc',
        transport: 'eventbridge',
      });

      configureEventPlatform({
        publishers: {
          eventbridge: { publish: jest.fn() },
        },
        payloadSchemas: {
          'Order.Created': { '1.0.0': schema },
        },
        consumer: {
          ...baseConsumerOptions(),
          payloadSchemas: {
            'Order.Created': { '1.0.0': schema },
          },
        },
      });

      const received: unknown[] = [];
      const handler = onEvent(schema, async (input) => {
        received.push(input);
      });

      const detail = {
        eventId: 'e1',
        eventType: 'Order.Created',
        eventVersion: '1.0.0',
        timestamp: new Date().toISOString(),
        source: 'orders-svc',
        idempotencyKey: 'idem-1',
        payload: { orderId: 'o1' },
        meta: { correlationId: 'c1' },
      };

      const result = await handler({
        version: '0',
        id: 'aws-event-id',
        'detail-type': 'Order.Created',
        source: 'orders-svc',
        account: '123456789012',
        time: '2026-01-01T00:00:00Z',
        region: 'us-east-1',
        resources: [],
        detail,
      });

      expect(result.outcome).toBe('processed');
      expect(received[0]).toEqual(
        expect.objectContaining({
          orderId: 'o1',
          meta: expect.objectContaining({ correlationId: 'c1' }),
        }),
      );
    });
  });
});
