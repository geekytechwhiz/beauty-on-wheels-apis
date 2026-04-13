import type { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import type { SQSClient } from '@aws-sdk/client-sqs';

import {
  type EventPublishAdapter,
  EventBridgeAdapter,
  EventConsumer,
  EventPublisher,
  InMemoryIdempotencyStore,
  SqsAdapter,
} from '../index';

/**
 * STEP 12 — SDK-only examples (no direct SendMessage / PutEvents in app code).
 * Adapters encapsulate AWS SDK usage.
 */

const fastRetry = {
  maxAttempts: 3,
  strategy: 'fixed' as const,
  delayMs: 1,
};

/** In-memory transport for local / tests — implements the same adapter contract as SQS/EventBridge. */
class InMemoryPublishAdapter implements EventPublishAdapter {
  readonly published: unknown[] = [];

  async publish(event: Parameters<EventPublishAdapter['publish']>[0]): Promise<void> {
    this.published.push(structuredClone(event));
  }
}

describe('Example: publish then consume (in-memory, SDK only)', () => {
  it('runs end-to-end without AWS', async () => {
    const transport = new InMemoryPublishAdapter();
    const publisher = new EventPublisher({ adapter: transport });

    await publisher.publish({
      eventType: 'example.Demo',
      version: '1.0.0',
      source: 'step12-example',
      payload: { message: 'hello' },
    });

    expect(transport.published).toHaveLength(1);

    const consumer = new EventConsumer({
      idempotencyStore: new InMemoryIdempotencyStore(),
      retry: fastRetry,
    });

    const wireEvent = transport.published[0];
    const result = await consumer.handle(wireEvent, async () => {
      /* domain handler */
    });

    expect(result).toEqual({ outcome: 'processed' });
  });
});

describe('Example: SQS adapter wiring (SDK — no direct SendMessage in app code)', () => {
  it('sends through SqsAdapter created with a mock client', async () => {
    const send = jest.fn().mockResolvedValue({});
    const mockClient = { send } as unknown as SQSClient;

    const adapter = new SqsAdapter(
      {
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/example',
        region: 'us-east-1',
      },
      mockClient,
    );

    const publisher = new EventPublisher({ adapter });

    await publisher.publish({
      eventType: 'example.Sqs',
      version: '1.0.0',
      source: 'step12-example',
      payload: { n: 1 },
    });

    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('Example: EventBridge adapter wiring (SDK — no direct PutEvents in app code)', () => {
  it('sends through EventBridgeAdapter created with a mock client', async () => {
    const send = jest.fn().mockResolvedValue({});
    const mockClient = { send } as unknown as EventBridgeClient;

    const adapter = new EventBridgeAdapter(
      {
        eventBusName: 'example-bus',
        region: 'us-east-1',
        source: 'step12-example',
        detailType: 'example.EventBridge',
      },
      mockClient,
    );

    const publisher = new EventPublisher({ adapter });

    await publisher.publish({
      eventType: 'example.EventBridge',
      version: '1.0.0',
      source: 'envelope-source',
      payload: { ok: true },
    });

    expect(send).toHaveBeenCalledTimes(1);
  });
});
