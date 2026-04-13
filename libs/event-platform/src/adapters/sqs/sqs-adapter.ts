import {
  DeleteMessageCommand,
  type DeleteMessageCommandInput,
  ReceiveMessageCommand,
  type ReceiveMessageCommandInput,
  SendMessageCommand,
  type SendMessageCommandInput,
  SQSClient,
} from '@aws-sdk/client-sqs';

import type { BaseEvent } from '../../core/event-envelope/base-event';
import type { SqsAdapterConfig } from './sqs-adapter-config';
import { parseMessageBody, serializeBaseEvent } from './message-serialization';

export type SqsSubscribeMeta = {
  messageId: string;
  receiptHandle: string;
};

export type SqsSubscribeOptions = {
  /** Long poll wait (default 20). */
  waitTimeSeconds?: number;
  maxNumberOfMessages?: number;
  visibilityTimeout?: number;
  /** When aborted, the receive loop exits after the current batch. */
  abortSignal?: AbortSignal;
};

export class SqsAdapter {
  private readonly client: SQSClient;

  constructor(
    private readonly config: SqsAdapterConfig,
    client?: SQSClient,
  ) {
    this.client = client ?? new SQSClient({ region: config.region });
  }

  /** Returns config for tests / observability (DLQ awareness without enforcement). */
  getConfig(): Readonly<SqsAdapterConfig> {
    return this.config;
  }

  async publish(event: BaseEvent): Promise<void> {
    const body = serializeBaseEvent(event);
    const input: SendMessageCommandInput = {
      QueueUrl: this.config.queueUrl,
      MessageBody: body,
      MessageAttributes: {
        eventType: {
          DataType: 'String',
          StringValue: event.eventType,
        },
      },
    };
    await this.client.send(new SendMessageCommand(input));
  }

  /**
   * Long-polls the configured queue and invokes `handler` for each message.
   * Deletes the message after the handler succeeds; on handler failure the message is not deleted.
   */
  async subscribe(
    handler: (event: BaseEvent, meta: SqsSubscribeMeta) => Promise<void>,
    options?: SqsSubscribeOptions,
  ): Promise<void> {
    const waitTimeSeconds = options?.waitTimeSeconds ?? 20;
    const maxNumberOfMessages = options?.maxNumberOfMessages ?? 10;
    while (!options?.abortSignal?.aborted) {
      const receiveInput: ReceiveMessageCommandInput = {
        QueueUrl: this.config.queueUrl,
        WaitTimeSeconds: waitTimeSeconds,
        MaxNumberOfMessages: maxNumberOfMessages,
        VisibilityTimeout: options?.visibilityTimeout,
        MessageAttributeNames: ['All'],
      };
      const out = await this.client.send(new ReceiveMessageCommand(receiveInput));
      const messages = out.Messages ?? [];
      for (const msg of messages) {
        if (!msg.Body || !msg.ReceiptHandle) {
          continue;
        }
        const event = parseMessageBody(msg.Body);
        await handler(event, {
          messageId: msg.MessageId ?? '',
          receiptHandle: msg.ReceiptHandle,
        });
        const del: DeleteMessageCommandInput = {
          QueueUrl: this.config.queueUrl,
          ReceiptHandle: msg.ReceiptHandle,
        };
        await this.client.send(new DeleteMessageCommand(del));
      }
    }
  }
}
