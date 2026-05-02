import { PublishCommand, SNSClient, type SNSClientConfig } from '@aws-sdk/client-sns';
import { NodeHttpHandler } from '@smithy/node-http-handler';

import type { BaseEvent } from '../../typings/base-event.types';
import type { EventPublishAdapter } from './event-publish-adapter';
import { createSnsPublishEvent } from "@api-hub/event-platform";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export type SnsTopicAdapterOptions = {
  /** Resolved topic ARN; publish is a no-op when missing (caller may skip earlier). */
  topicArn: string;
  region?: string;
  maxAttempts?: number;
  connectionTimeoutMs?: number;
  socketTimeoutMs?: number;
};

/**
 * Publishes a {@link BaseEvent} JSON body to a single SNS topic with standard message attributes.
 */
export function createSnsTopicAdapter(options: SnsTopicAdapterOptions): EventPublishAdapter {
  const region = options.region ?? process.env.DEFAULT_REGION ?? process.env.DP_REGION ?? 'us-east-1';
  const maxAttempts = options.maxAttempts ?? parsePositiveInt(process.env.SNS_MAX_ATTEMPTS, 5);
  const connectionTimeoutMs =
    options.connectionTimeoutMs ?? parsePositiveInt(process.env.SNS_CONNECTION_TIMEOUT_MS, 5_000);
  const socketTimeoutMs =
    options.socketTimeoutMs ?? parsePositiveInt(process.env.SNS_SOCKET_TIMEOUT_MS, 30_000);

  const clientConfig: SNSClientConfig = {
    region,
    maxAttempts,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: connectionTimeoutMs,
      socketTimeout: socketTimeoutMs,
    }),
  };
  const sns = new SNSClient(clientConfig);
  const { topicArn } = options;
  if (!topicArn) {
    return { publish: async () => undefined };
  }

  return {
    async publish(event: BaseEvent): Promise<void> {
      const message = JSON.stringify(event);
      await sns.send(
        new PublishCommand({
          TopicArn: topicArn,
          Message: message,
          MessageAttributes: {
            eventType: { DataType: 'String', StringValue: event.eventType },
            source: { DataType: 'String', StringValue: event.source },
          },
        }),
      );
    },
  };
}

export function isNonProdRelaxed(): boolean {
  const stage = process.env.STAGE || process.env.SERVERLESS_STAGE || process.env.NODE_ENV;
  return (
    process.env.IS_OFFLINE === 'true' ||
    stage === 'local' ||
    stage === 'dev' ||
    stage === 'test' ||
    !stage
  );
}

const CREDENTIAL_LIKE_ERROR_CODES = [
  'UnrecognizedClientException',
  'InvalidClientTokenId',
  'SignatureDoesNotMatch',
  'AccessDeniedException',
  'InvalidAccessKeyId',
];

export function isCredentialLikeSnsError(err: unknown): boolean {
  const code = (err as { name?: string; code?: string })?.name || (err as { code?: string })?.code;
  return typeof code === 'string' && CREDENTIAL_LIKE_ERROR_CODES.includes(code);
}
