import { SQSClient } from '@aws-sdk/client-sqs';

import { ConsoleDlqStrategy } from '../core/dlq/console.strategy';
import { SqsDlqStrategy } from '../core/dlq/sqs-dlq.strategy';
import type { DlqStrategy } from '../typings/dlq.types';
import type { EventConsumerDeps } from '../typings/consumer.types';
import { recommendedSqsRedriveMaxReceiveCount } from './recommended-sqs-redrive-max-receive-count';

export type ValidateConsumerDlqConfigOptions = {
  /** When true, throw instead of logging a warning. Default: true outside test. */
  strict?: boolean;
  serviceName?: string;
};

const isTestEnv = (): boolean =>
  process.env.NODE_ENV === 'test' ||
  process.env.JEST_WORKER_ID !== undefined;

/**
 * Validates consumer DLQ configuration. When `dlq.enabled` is true but no
 * `dlq.strategy` is supplied, terminal dead-letter outcomes cannot be sent.
 */
export function validateConsumerDlqConfig(
  consumer?: Partial<EventConsumerDeps>,
  options?: ValidateConsumerDlqConfigOptions,
): void {
  const dlq = consumer?.dlq;
  if (!dlq?.enabled || dlq.strategy) {
    return;
  }

  const strict = options?.strict ?? !isTestEnv();
  const service = options?.serviceName ?? process.env.SERVICE_NAME ?? 'event-consumer';
  const message =
    `[${service}] dlq.enabled is true but dlq.strategy is missing — ` +
    'terminal dead-letter outcomes will fall back to transport retry without sending to a DLQ. ' +
    'Wire SqsDlqStrategy or set dlq.enabled: false.';

  if (strict) {
    throw new Error(message);
  }

  console.warn(message);
}

/**
 * Creates an {@link SqsDlqStrategy} from env `DLQ_QUEUE_URL` / `EVENT_DLQ_QUEUE_URL` or an explicit URL.
 */
export function createDefaultSqsDlqStrategy(input?: {
  queueUrl?: string;
  client?: SQSClient;
}): SqsDlqStrategy | undefined {
  const queueUrl =
    (typeof input?.queueUrl === 'string' && input.queueUrl.trim()) ||
    (typeof process.env.DLQ_QUEUE_URL === 'string' && process.env.DLQ_QUEUE_URL.trim()) ||
    (typeof process.env.EVENT_DLQ_QUEUE_URL === 'string' &&
      process.env.EVENT_DLQ_QUEUE_URL.trim()) ||
    '';

  if (!queueUrl) {
    return undefined;
  }

  return new SqsDlqStrategy(queueUrl, input?.client);
}

/**
 * Resolves DLQ strategy: explicit override, SQS URL from env, or console in local dev.
 */
export function resolveConsumerDlqStrategy(input?: {
  strategy?: DlqStrategy;
  queueUrl?: string;
  client?: SQSClient;
  fallbackToConsole?: boolean;
}): DlqStrategy | undefined {
  if (input?.strategy) {
    return input.strategy;
  }

  const sqs = createDefaultSqsDlqStrategy({
    queueUrl: input?.queueUrl,
    client: input?.client,
  });
  if (sqs) {
    return sqs;
  }

  if (input?.fallbackToConsole ?? process.env.NODE_ENV === 'development') {
    return new ConsoleDlqStrategy();
  }

  return undefined;
}

export type SqsRedrivePolicyFragment = {
  maxReceiveCount: number;
  deadLetterTargetArn: string;
};

export function buildSqsRedrivePolicyFragment(input: {
  consumer: Pick<EventConsumerDeps, 'retry'>;
  deadLetterTargetArn: string;
  buffer?: number;
}): SqsRedrivePolicyFragment {
  const base = recommendedSqsRedriveMaxReceiveCount(input.consumer);
  return {
    maxReceiveCount: base + (input.buffer ?? 0),
    deadLetterTargetArn: input.deadLetterTargetArn,
  };
}
