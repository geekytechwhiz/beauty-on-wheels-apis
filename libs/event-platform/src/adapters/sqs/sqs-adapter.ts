import {
  ChangeMessageVisibilityCommand,
  type ChangeMessageVisibilityCommandInput,
  DeleteMessageCommand,
  type DeleteMessageCommandInput,
  MessageSystemAttributeName,
  ReceiveMessageCommand,
  type ReceiveMessageCommandInput,
  SendMessageCommand,
  type SendMessageCommandInput,
  SQSClient,
} from '@aws-sdk/client-sqs';

import { getLogger } from '@api-hub/observability';

import type { BaseEvent } from '../../typings/base-event.types';
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
  /**
   * Base visibility extension (seconds) after handler or parse failure (default 30).
   * Scales with {@link MessageSystemAttributeName.ApproximateReceiveCount} up to `maxFailureVisibilitySeconds`.
   */
  failureVisibilitySeconds?: number;
  /**
   * Upper bound for computed failure visibility (default 900). Capped at 43200 (SQS max).
   */
  maxFailureVisibilitySeconds?: number;
};

export class SqsAdapter {
  readonly transport = 'sqs' as const;
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
   * Deletes the message after the handler succeeds; on handler failure the message is not deleted
   * and visibility is extended with exponential backoff so other workers do not tight-loop.
   */
  async subscribe(
    handler: (event: BaseEvent, meta: SqsSubscribeMeta) => Promise<void>,
    options?: SqsSubscribeOptions,
  ): Promise<void> {
    const log = getLogger();
    const waitTimeSeconds = options?.waitTimeSeconds ?? 20;
    const maxNumberOfMessages = options?.maxNumberOfMessages ?? 10;
    const failureBaseSeconds = options?.failureVisibilitySeconds ?? 30;
    const failureMaxSeconds = Math.min(
      43_200,
      options?.maxFailureVisibilitySeconds ?? 900,
    );
    while (!options?.abortSignal?.aborted) {
      const receiveInput: ReceiveMessageCommandInput = {
        QueueUrl: this.config.queueUrl,
        WaitTimeSeconds: waitTimeSeconds,
        MaxNumberOfMessages: maxNumberOfMessages,
        VisibilityTimeout: options?.visibilityTimeout,
        MessageAttributeNames: ['All'],
        MessageSystemAttributeNames: [MessageSystemAttributeName.ApproximateReceiveCount],
      };
      const out = await this.client.send(new ReceiveMessageCommand(receiveInput));
      const messages = out.Messages ?? [];
      for (const msg of messages) {
        if (!msg.Body || !msg.ReceiptHandle) {
          continue;
        }
        const receiptHandle = msg.ReceiptHandle;
        const meta: SqsSubscribeMeta = {
          messageId: msg.MessageId ?? '',
          receiptHandle,
        };
        const receiveCount = parseApproximateReceiveCount(msg);
        let event: BaseEvent;
        try {
          event = parseMessageBody(msg.Body);
        } catch (parseErr) {
          log.error('sqs_subscribe_parse_failed', parseErr, {
            messageId: meta.messageId,
          });
          await this.extendVisibilityForFailure(
            receiptHandle,
            receiveCount,
            failureBaseSeconds,
            failureMaxSeconds,
          );
          continue;
        }
        try {
          await handler(event, meta);
        } catch (handlerErr) {
          log.error('sqs_subscribe_handler_failed', handlerErr, {
            messageId: meta.messageId,
            eventType: event.eventType,
          });
          await this.extendVisibilityForFailure(
            receiptHandle,
            receiveCount,
            failureBaseSeconds,
            failureMaxSeconds,
          );
          continue;
        }
        const del: DeleteMessageCommandInput = {
          QueueUrl: this.config.queueUrl,
          ReceiptHandle: receiptHandle,
        };
        await this.client.send(new DeleteMessageCommand(del));
      }
    }
  }

  private async extendVisibilityForFailure(
    receiptHandle: string,
    receiveCount: number,
    baseSeconds: number,
    maxSeconds: number,
  ): Promise<void> {
    const visibility = computeFailureVisibilitySeconds(
      receiveCount,
      baseSeconds,
      maxSeconds,
    );
    const input: ChangeMessageVisibilityCommandInput = {
      QueueUrl: this.config.queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: visibility,
    };
    try {
      await this.client.send(new ChangeMessageVisibilityCommand(input));
    } catch (err) {
      getLogger().error('sqs_subscribe_change_visibility_failed', err);
    }
  }
}

function parseApproximateReceiveCount(msg: { Attributes?: Record<string, string> }): number {
  const raw = msg.Attributes?.[MessageSystemAttributeName.ApproximateReceiveCount];
  if (raw === undefined) {
    return 1;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function computeFailureVisibilitySeconds(
  receiveCount: number,
  baseSeconds: number,
  maxSeconds: number,
): number {
  const exponent = Math.min(Math.max(0, receiveCount - 1), 12);
  const scaled = baseSeconds * 2 ** exponent;
  const capped = Math.min(maxSeconds, scaled);
  return Math.max(1, Math.min(43_200, Math.floor(capped)));
}
