import { BaseEvent } from '../typings/base-event.types';
import { z } from 'zod';
 
import { DlqConfig } from '../core/dlq/dlq-config';
import { IdempotencyStrategy } from '../core/idempotency/idempotency-strategy';
import { EventTracingHooks } from '../core/tracing/event-tracing-hooks';

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

  payloadSchemas?: PayloadSchemaRegistry;

  versionCheck?: VersionCheckConfig; // ✅ HERE

  tracing?: EventTracingHooks;

  mapRawToBaseEvent?: (raw: unknown) => BaseEvent;
};

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
