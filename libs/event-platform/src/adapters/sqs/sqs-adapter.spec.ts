import {
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

import type { BaseEvent } from '../../typings/base-event.types';
import { SqsAdapter } from './sqs-adapter';
import {
  parseMessageBody,
  serializeBaseEvent,
  SqsMessageParseError,
} from './message-serialization';

function sampleEvent(): BaseEvent<{ n: number }> {
  return {
    eventId: 'e1',
    eventType: 'test.event',
    version: '1',
    timestamp: '2026-01-01T00:00:00.000Z',
    source: 'test',
    idempotencyKey: 'k1',
    payload: { n: 1 },
  };
}

describe('SqsAdapter publish (message send format)', () => {
  it('sends JSON body and queue URL on SendMessage', async () => {
    const send = jest.fn().mockResolvedValue({});
    const client = { send } as unknown as SQSClient;
    const adapter = new SqsAdapter(
      {
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/q',
        region: 'us-east-1',
        deadLetterQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/q-dlq',
      },
      client,
    );

    const event = sampleEvent();
    await adapter.publish(event);

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0] as SendMessageCommand;
    const input = cmd.input;
    expect(input.QueueUrl).toBe('https://sqs.us-east-1.amazonaws.com/123/q');
    expect(input.MessageBody).toBe(serializeBaseEvent(event));
    expect(input.MessageAttributes?.eventType?.StringValue).toBe('test.event');
  });
});

describe('message parsing', () => {
  it('parses a valid BaseEvent JSON body', () => {
    const event = sampleEvent();
    const body = serializeBaseEvent(event);
    expect(parseMessageBody(body)).toEqual(event);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseMessageBody('not json')).toThrow(SqsMessageParseError);
  });

  it('throws when required fields are missing', () => {
    expect(() => parseMessageBody('{}')).toThrow(SqsMessageParseError);
  });
});

describe('SqsAdapterConfig (DLQ awareness)', () => {
  it('exposes deadLetterQueueUrl without using it in publish', async () => {
    const send = jest.fn().mockResolvedValue({});
    const client = { send } as unknown as SQSClient;
    const adapter = new SqsAdapter(
      {
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/q',
        region: 'us-east-1',
        deadLetterQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/dlq',
      },
      client,
    );
    expect(adapter.getConfig().deadLetterQueueUrl).toContain('dlq');
    await adapter.publish(sampleEvent());
    expect(send).toHaveBeenCalledWith(expect.any(SendMessageCommand));
  });
});
