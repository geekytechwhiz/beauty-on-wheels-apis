jest.mock('@api-hub/observability', () => ({
  getLogger: () => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
}));

import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

import type { BaseEvent } from '../../typings/base-event.types';
import { computeFailureVisibilitySeconds, SqsAdapter } from './sqs-adapter';
import {
  parseMessageBody,
  serializeBaseEvent,
  SqsMessageParseError,
} from './message-serialization';

function sampleEvent(): BaseEvent<{ n: number }> {
  return {
    eventId: 'e1',
    eventType: 'test.event',
    eventVersion: '1',
    timestamp: '2026-01-01T00:00:00.000Z',
    source: 'test',
    idempotencyKey: 'k1',
    payload: { n: 1 },
    meta: { correlationId: 'c1' },
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

describe('computeFailureVisibilitySeconds', () => {
  it('applies exponential backoff capped by max', () => {
    expect(computeFailureVisibilitySeconds(1, 30, 900)).toBe(30);
    expect(computeFailureVisibilitySeconds(2, 30, 900)).toBe(60);
    expect(computeFailureVisibilitySeconds(3, 30, 90)).toBe(90);
  });
});

describe('SqsAdapter subscribe', () => {
  it('deletes after successful handler; extends visibility and skips delete on handler error', async () => {
    const body = serializeBaseEvent(sampleEvent());
    let receiveCalls = 0;
    const ac = new AbortController();
    const send = jest.fn().mockImplementation((cmd: unknown) => {
      if (cmd instanceof ReceiveMessageCommand) {
        receiveCalls += 1;
        if (receiveCalls === 1) {
          return Promise.resolve({
            Messages: [
              {
                Body: body,
                ReceiptHandle: 'rh-bad',
                MessageId: 'm-bad',
                Attributes: { ApproximateReceiveCount: '2' },
              },
              {
                Body: body,
                ReceiptHandle: 'rh-good',
                MessageId: 'm-good',
                Attributes: { ApproximateReceiveCount: '1' },
              },
            ],
          });
        }
        ac.abort();
        return Promise.resolve({ Messages: [] });
      }
      if (cmd instanceof ChangeMessageVisibilityCommand) {
        return Promise.resolve({});
      }
      if (cmd instanceof DeleteMessageCommand) {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });
    const client = { send } as unknown as SQSClient;
    const adapter = new SqsAdapter(
      { queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/q', region: 'us-east-1' },
      client,
    );

    const handler = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await adapter.subscribe(handler, {
      abortSignal: ac.signal,
      waitTimeSeconds: 0,
      maxNumberOfMessages: 1,
      failureVisibilitySeconds: 30,
      maxFailureVisibilitySeconds: 900,
    });

    expect(handler).toHaveBeenCalledTimes(2);
    const visCmd = send.mock.calls.find(
      (c) => c[0] instanceof ChangeMessageVisibilityCommand,
    )?.[0] as ChangeMessageVisibilityCommand;
    expect(visCmd?.input.VisibilityTimeout).toBe(
      computeFailureVisibilitySeconds(2, 30, 900),
    );
    const deleteCalls = send.mock.calls.filter((c) => c[0] instanceof DeleteMessageCommand);
    expect(deleteCalls).toHaveLength(1);
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
