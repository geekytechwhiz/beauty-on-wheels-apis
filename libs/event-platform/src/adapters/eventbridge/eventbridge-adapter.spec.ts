import type { BaseEvent } from '../../typings/base-event.types';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { serializeBaseEvent } from '../../core/event-envelope/serialize-base-event';
import { EventBridgeAdapter } from './eventbridge-adapter';
import { toPutEventsEntry } from './eventbridge-put-events';

function sampleEvent(): BaseEvent<{ n: number }> {
  return {
    eventId: 'e1',
    eventType: 'MyDomain.Event',
    eventVersion: '1.0.0',
    timestamp: '2026-01-01T00:00:00.000Z',
    source: 'app',
    idempotencyKey: 'k1',
    payload: { n: 1 },
    meta: {
      correlationId: 'c1',
      publishedAt: '2026-01-01T00:00:00.000Z',
      retryCount: 0,
      schemaRef: 'MyDomain.Event@1.0.0',
      causationId: 'e1',
      attributes: { n: 1 },
    },
  };
}

describe('toPutEventsEntry (event transformation)', () => {
  it('maps BaseEvent to PutEvents entry fields', () => {
    const event = sampleEvent();
    const entry = toPutEventsEntry(event, {
      eventBusName: 'my-bus',
      source: 'order-service',
      detailType: 'OrderPlaced',
    });

    expect(entry).toEqual({
      EventBusName: 'my-bus',
      Source: 'order-service',
      DetailType: 'OrderPlaced',
      Detail: serializeBaseEvent(event),
    });
  });

  it('defaults DetailType to event.eventType when detailType is omitted', () => {
    const event = sampleEvent();
    const entry = toPutEventsEntry(event, {
      eventBusName: 'bus',
      source: 'svc',
    });

    expect(entry.DetailType).toBe('MyDomain.Event');
  });
});

describe('EventBridgeAdapter.publish', () => {
  it('sends PutEvents with the transformed entry', async () => {
    const send = jest.fn().mockResolvedValue({});
    const client = { send } as unknown as EventBridgeClient;
    const adapter = new EventBridgeAdapter(
      {
        eventBusName: 'custom-bus', 
        source: 'platform-test',
        detailType: 'Test.Event',
      },
      client,
    );

    const event = sampleEvent();
    await adapter.publish(event);

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0] as PutEventsCommand;
    expect(cmd.input.Entries?.[0]).toEqual(
      toPutEventsEntry(event, {
        eventBusName: 'custom-bus',
        source: 'platform-test',
        detailType: 'Test.Event',
      }),
    );
  });
});
