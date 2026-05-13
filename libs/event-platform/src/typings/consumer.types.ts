import { BaseEvent } from '../typings/base-event.types';
import { z } from 'zod';

import type { DlqConfig } from '../core/dlq/dlq-config';
import type { IdempotencyStrategy } from '../core/idempotency/idempotency-strategy';
import type { RetryStrategy } from '../core/retry/retry.types';
import type { ResolveSchemaOptions } from '../core/schema/schema-resolver';
import type { TransportMode } from '../core/policy/delivery-policy';
import type { EventTracingHooks } from '../core/tracing/event-tracing-hooks';

export type PayloadSchemaRegistry = Partial<Record<string, z.ZodType<unknown>>>;

export type VersionedPayloadSchemas = Record<
  string,
  Record<string, z.ZodType<any>>
>;

export type RetryBackoffStrategy = 'exponential' | 'fixed';
export type RetryJitter = 'none' | 'full' | 'partial';

export type RetryLogger = {
  warn: (message: string, meta?: Record<string, unknown>) => void;
};

export type RetryContext = {
  currentRetryCount?: number;
};

export type RetryOptions = {
  maxAttempts: number;
  strategy: RetryBackoffStrategy;
  delayMs: number;

  factor?: number;
  maxDelayMs?: number;

  jitter?: RetryJitter;
  timeoutMs?: number;

  isRetryable?: (error: unknown) => boolean;
  shouldRetryResult?: (result: any) => boolean;

  shouldStop?: (error: unknown, attempt: number) => boolean;

  signal?: AbortSignal;

  logger?: RetryLogger;
  onBeforeRetry?: (info: RetryOnBeforeRetryInfo) => void;
  onComplete?: (info: { success: boolean; attempts: number }) => void;
};

export type RetryOnBeforeRetryInfo = {
  failedAttempt: number;
  maxAttempts: number;
  waitMs: number;
  error: unknown;
};

export type EventConsumerDeps = {
  idempotencyStrategy: IdempotencyStrategy;

  retry: RetryOptions;
  dlq?: DlqConfig;

  payloadSchemas?: VersionedPayloadSchemas;

  schemaResolution?: ResolveSchemaOptions;

  versionCheck?: VersionCheckConfig;

  tracing?: EventTracingHooks;

  mapRawToBaseEvent?: (raw: unknown) => BaseEvent;

  /**
   * When unset: `framework-managed` if {@link transportRetry} is set, otherwise `sqs-native`.
   */
  transportMode?: TransportMode;

  /**
   * Max concurrent record processing for batch consumers (SQS partial batch). Default: unbounded.
   */
  batchConcurrency?: number;

  /**
   * When true, SQS batch work is scheduled so records sharing the same FIFO `MessageGroupId` run
   * serially while different groups (and standard-queue “ungrouped” lanes) run with up to
   * {@link batchConcurrency} concurrent handlers. Later messages in a lane are not executed if an
   * earlier message in that lane is not acked this invocation (ordering + partial batch parity).
   */
  sqsFifoGroupScheduling?: boolean;

  /**
   * With {@link sqsFifoGroupScheduling}, skip the handler when `ApproximateReceiveCount` meets or
   * exceeds this value and surface `needs_transport_retry` (batch failure) to isolate poison retries.
   */
  sqsFifoPoisonReceiveCountThreshold?: number;

  /**
   * When set, retries re-publish the raw transport payload (e.g. SQS) instead of failing the Lambda.
   * If unset, Lambda fails / partial-batch failure so the queue drives redelivery up to {@link RetryOptions.maxAttempts}.
   */
  transportRetry?: RetryStrategy;
};

export function effectiveTransportMode(deps: EventConsumerDeps): TransportMode {
  if (deps.transportMode) return deps.transportMode;
  return deps.transportRetry ? 'framework-managed' : 'sqs-native';
}

export type StreamOrSqsRecord = {
  messageId?: string;
  eventID?: string;
  sequenceNumber?: string;
};

export type VersionCompatibilityStrategy = 'strict' | 'backward' | 'forward';

export type VersionCheckConfig = { 
  supportedVersions: string[];
 
  deprecatedVersions?: string[];
  
  strategy?: VersionCompatibilityStrategy;
 
  latestVersion?: string;
  supportedVersion: string;

  onDeprecated?: (version: string) => void;
};
