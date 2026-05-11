import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import type { DlqMessage, DlqStrategy } from '../../typings/dlq.types';

export class SqsDlqStrategy implements DlqStrategy {
  private client: SQSClient;

  constructor(
    private queueUrl: string,
    client?: SQSClient,
  ) {
    this.client = client ?? new SQSClient({});
  }

  async send(message: DlqMessage): Promise<void> {
    try {
      const body = JSON.stringify(message);

      if (Buffer.byteLength(body, 'utf8') > 256 * 1024) {
        console.warn('DLQ message too large, truncating...');
      }

      await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: body,
          MessageAttributes: {
            eventType: {
              DataType: 'String',
              StringValue: message.metadata?.eventType ?? 'unknown',
            },
            correlationId: {
              DataType: 'String',
              StringValue: message.metadata?.correlationId ?? 'unknown',
            },
            retryCount: {
              DataType: 'Number',
              StringValue: String(message.metadata?.retryCount ?? 0),
            },
          },
        }),
      );
    } catch (err) {
      console.error('DLQ send failed', {
        error: err,
        fallbackMessage: message,
      });
    }
  }
}
