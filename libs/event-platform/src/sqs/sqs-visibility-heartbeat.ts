import {
  ChangeMessageVisibilityCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

import {
  getLogger,
  recordSqsVisibilityHeartbeatExtend,
  recordSqsVisibilityHeartbeatLoopEnded,
  recordSqsVisibilityHeartbeatSkipped,
} from '@api-hub/observability';

import { getSqsRecordShape } from '../lib/sqs-per-message-context';

const SQS_MAX_VISIBILITY_SECONDS = 43_200;

export type SqsVisibilityHeartbeatStopReason =
  | 'success'
  | 'failure'
  | 'lambda_timeout'
  | 'aborted'
  | 'disabled';

/**
 * Optional tracing / custom telemetry for visibility extensions.
 * Keep side-effects light; failures here must not break the consumer.
 */
export type SqsVisibilityHeartbeatHooks = {
  /** Fired after a successful ChangeMessageVisibility API call. */
  onVisibilityExtended?: (ctx: {
    messageId?: string;
    receiptHandlePrefix: string;
    visibilityTimeoutSeconds: number;
    extensionCount: number;
    remainingMs: number;
  }) => void;
  /** Fired when the SDK call rejects or returns an unexpected state. */
  onVisibilityExtendFailed?: (ctx: {
    messageId?: string;
    error: unknown;
    extensionCount: number;
  }) => void;
  /** Fired once when the heartbeat loop ends (timer cleared, in-flight work drained). */
  onHeartbeatStopped?: (ctx: {
    reason: SqsVisibilityHeartbeatStopReason;
    messageId?: string;
    extensionCount: number;
  }) => void;
};

export type SqsVisibilityHeartbeatConfig = {
  queueUrl: string;
  receiptHandle: string;
  messageId?: string;
  /**
   * Visibility timeout to apply on each heartbeat (seconds).
   * Capped at 43200 (SQS max). Default 900 (15 minutes).
   */
  visibilityExtensionSeconds?: number;
  /**
   * Minimum wall time between ChangeMessageVisibility attempts.
   * Default 25000ms. Add jitter internally to reduce synchronized bursts across messages.
   */
  heartbeatIntervalMs?: number;
  /**
   * Skip scheduling extensions when Lambda has less than this many ms remaining.
   * Default 10000.
   */
  minRemainingMsToExtend?: number;
  /**
   * Hard stop: cancel pending timers and skip new extensions below this threshold.
   * Default 3000.
   */
  minRemainingMsHardStop?: number;
  /** Lambda / synthetic context — required for safe shutdown near invoke timeout. */
  getRemainingTimeInMillis: () => number;
  /** Optional injected client (tests); otherwise constructed from region. */
  client?: SQSClient;
  region?: string;
  hooks?: SqsVisibilityHeartbeatHooks;
};

/**
 * Per-message visibility extender for Lambda SQS consumers.
 *
 * - One timer + one serialized extend chain per {@link SqsVisibilityHeartbeatController} instance
 *   (safe under {@link processBatch} concurrency: each record uses its own controller).
 * - Stops on {@link stop}, Lambda low remaining time, or process completion via {@link runWithSqsVisibilityHeartbeat}.
 */
export class SqsVisibilityHeartbeatController {
  private readonly queueUrl: string;

  private readonly receiptHandle: string;

  private readonly messageId?: string;

  private readonly visibilitySeconds: number;

  private readonly heartbeatIntervalMs: number;

  private readonly minRemainingMsToExtend: number;

  private readonly minRemainingMsHardStop: number;

  private readonly getRemainingTimeInMillis: () => number;

  private readonly client: SQSClient;

  private readonly hooks?: SqsVisibilityHeartbeatHooks;

  private timer: ReturnType<typeof setTimeout> | undefined;

  private stopped = false;

  private extensionCount = 0;

  /** Serializes ChangeMessageVisibility so only one in-flight call exists per message. */
  private extendChain: Promise<void> = Promise.resolve();

  constructor(config: SqsVisibilityHeartbeatConfig) {
    this.queueUrl = config.queueUrl;
    this.receiptHandle = config.receiptHandle;
    this.messageId = config.messageId;
    this.visibilitySeconds = clampVisibilitySeconds(
      config.visibilityExtensionSeconds ?? 900,
    );
    this.heartbeatIntervalMs = Math.max(
      1_000,
      config.heartbeatIntervalMs ?? 25_000,
    );
    this.minRemainingMsToExtend = Math.max(
      500,
      config.minRemainingMsToExtend ?? 10_000,
    );
    this.minRemainingMsHardStop = Math.max(
      250,
      config.minRemainingMsHardStop ?? 3_000,
    );
    this.getRemainingTimeInMillis = config.getRemainingTimeInMillis;
    this.hooks = config.hooks;
    this.client =
      config.client ??
      new SQSClient(config.region ? { region: config.region } : {});
  }

  /**
   * Starts the periodic extension loop (first tick after interval + jitter).
   */
  start(): void {
    if (this.stopped) {
      return;
    }
    this.scheduleNext(this.nextDelayMs());
  }

  /**
   * Clears timers and waits for any in-flight ChangeMessageVisibility to finish.
   */
  async stop(reason: SqsVisibilityHeartbeatStopReason): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.extendChain.catch(() => undefined);
    try {
      this.hooks?.onHeartbeatStopped?.({
        reason,
        messageId: this.messageId,
        extensionCount: this.extensionCount,
      });
    } catch {
      /* hook errors are non-fatal */
    }
  }

  private nextDelayMs(): number {
    const jitter = Math.floor(Math.random() * 2_000);
    return this.heartbeatIntervalMs + jitter;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    const remaining = this.getRemainingTimeInMillis();
    if (remaining <= this.minRemainingMsHardStop) {
      void this.emitLambdaTimeoutLog(remaining);
      recordSqsVisibilityHeartbeatLoopEnded('lambda_hard_stop');
      return;
    }
    const safeDelay = Math.min(delayMs, Math.max(0, remaining - this.minRemainingMsHardStop));
    if (safeDelay <= 0) {
      void this.emitLambdaTimeoutLog(remaining);
      recordSqsVisibilityHeartbeatLoopEnded('lambda_hard_stop');
      return;
    }
    this.timer = setTimeout(() => {
      void this.onTimerTick();
    }, safeDelay);
  }

  private async onTimerTick(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.timer = undefined;

    const remaining = this.getRemainingTimeInMillis();
    if (remaining <= this.minRemainingMsHardStop) {
      recordSqsVisibilityHeartbeatSkipped('lambda_hard_stop');
      recordSqsVisibilityHeartbeatLoopEnded('lambda_hard_stop');
      getLogger().info('sqs_visibility_heartbeat_skip', {
        logType: 'sqs_visibility_heartbeat',
        reason: 'lambda_hard_stop',
        messageId: this.messageId,
        remainingMs: remaining,
      });
      return;
    }

    if (remaining < this.minRemainingMsToExtend) {
      recordSqsVisibilityHeartbeatSkipped('lambda_low_remaining');
      getLogger().info('sqs_visibility_heartbeat_skip', {
        logType: 'sqs_visibility_heartbeat',
        reason: 'lambda_low_remaining',
        messageId: this.messageId,
        remainingMs: remaining,
      });
      this.scheduleNext(this.nextDelayMs());
      return;
    }

    this.extendChain = this.extendChain
      .then(() => this.extendVisibilityOnce(remaining))
      .catch(() => undefined);

    await this.extendChain;

    if (!this.stopped) {
      this.scheduleNext(this.nextDelayMs());
    }
  }

  private async extendVisibilityOnce(remainingBefore: number): Promise<void> {
    if (this.stopped) {
      return;
    }
    const remaining = this.getRemainingTimeInMillis();
    if (remaining <= this.minRemainingMsHardStop) {
      recordSqsVisibilityHeartbeatSkipped('lambda_hard_stop');
      return;
    }

    try {
      await this.client.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: this.receiptHandle,
          VisibilityTimeout: this.visibilitySeconds,
        }),
      );
      this.extensionCount += 1;
      recordSqsVisibilityHeartbeatExtend(true);
      getLogger().info('sqs_visibility_extended', {
        logType: 'sqs_visibility_heartbeat',
        messageId: this.messageId,
        visibilityTimeoutSeconds: this.visibilitySeconds,
        extensionCount: this.extensionCount,
        remainingMsAfter: this.getRemainingTimeInMillis(),
        remainingMsBefore: remainingBefore,
      });
      this.hooks?.onVisibilityExtended?.({
        messageId: this.messageId,
        receiptHandlePrefix: receiptHandlePrefix(this.receiptHandle),
        visibilityTimeoutSeconds: this.visibilitySeconds,
        extensionCount: this.extensionCount,
        remainingMs: this.getRemainingTimeInMillis(),
      });
    } catch (error) {
      recordSqsVisibilityHeartbeatExtend(false);
      getLogger().error(
        'sqs_visibility_extend_failed',
        error,
        {
          logType: 'sqs_visibility_heartbeat',
          messageId: this.messageId,
          extensionCount: this.extensionCount,
        },
      );
      this.hooks?.onVisibilityExtendFailed?.({
        messageId: this.messageId,
        error,
        extensionCount: this.extensionCount,
      });
    }
  }

  private emitLambdaTimeoutLog(remaining: number): void {
    getLogger().warn('sqs_visibility_heartbeat_stopped_near_timeout', {
      logType: 'sqs_visibility_heartbeat',
      messageId: this.messageId,
      remainingMs: remaining,
    });
  }
}

/**
 * Runs `fn` while extending SQS visibility on an interval until `fn` settles.
 * Always stops the controller in `finally` (success, failure, or throw).
 */
export async function runWithSqsVisibilityHeartbeat<T>(
  config: SqsVisibilityHeartbeatConfig,
  fn: () => Promise<T>,
): Promise<T> {
  const ctrl = new SqsVisibilityHeartbeatController(config);
  ctrl.start();
  try {
    const out = await fn();
    await ctrl.stop('success');
    return out;
  } catch (err) {
    await ctrl.stop('failure');
    throw err;
  }
}

/**
 * Builds heartbeat config from an SQS batch record + Lambda context, or returns null when disabled / invalid.
 */
export function resolveSqsVisibilityHeartbeatConfig(input: {
  rawRecord: unknown;
  queueUrl: string | undefined;
  getRemainingTimeInMillis: () => number;
  hooks?: SqsVisibilityHeartbeatHooks;
  visibilityExtensionSeconds?: number;
  heartbeatIntervalMs?: number;
  minRemainingMsToExtend?: number;
  minRemainingMsHardStop?: number;
  client?: SQSClient;
  region?: string;
}): SqsVisibilityHeartbeatConfig | null {
  const url = input.queueUrl?.trim();
  if (!url) {
    return null;
  }
  const rec = getSqsRecordShape(input.rawRecord);
  if (!rec?.receiptHandle) {
    return null;
  }
  return {
    queueUrl: url,
    receiptHandle: rec.receiptHandle,
    messageId: rec.messageId,
    getRemainingTimeInMillis: input.getRemainingTimeInMillis,
    visibilityExtensionSeconds: input.visibilityExtensionSeconds,
    heartbeatIntervalMs: input.heartbeatIntervalMs,
    minRemainingMsToExtend: input.minRemainingMsToExtend,
    minRemainingMsHardStop: input.minRemainingMsHardStop,
    hooks: input.hooks,
    client: input.client,
    region: input.region,
  };
}

function clampVisibilitySeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 30;
  }
  return Math.min(SQS_MAX_VISIBILITY_SECONDS, Math.floor(seconds));
}

function receiptHandlePrefix(handle: string): string {
  if (handle.length <= 12) {
    return handle;
  }
  return `${handle.slice(0, 6)}…${handle.slice(-4)}`;
}
