import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import type { RetryStrategy } from './retry.types';

export class SqsRetryStrategy implements RetryStrategy {
  private client = new SQSClient({});

  constructor(private queueUrl: string) {}

  async scheduleRetry({
    rawEvent,
    retryCount: _retryCount,
    delayMs,
  }: {
    rawEvent: unknown;
    retryCount: number;
    delayMs: number;
  }) {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(rawEvent),
        DelaySeconds: Math.min(Math.floor(delayMs / 1000), 900),
      }),
    );
  }
}
