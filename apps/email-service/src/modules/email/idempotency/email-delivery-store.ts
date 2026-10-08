import {
  DELIVERY_SK,
  DELIVERY_STATUS,
  FAILURE_CLASS,
  canApplyLifecycleStatus,
  deliveryPartitionKey,
  type DeliveryStatus,
  type FailureClass,
} from '../domain/delivery-status.js';

export type DeliveryClaimInput = {
  idempotencyKey: string;
  eventId: string;
  eventType: string;
  source: string;
  correlationId?: string;
  templateName: string;
  recipientHash: string;
};

export type DeliveryClaimResult =
  | { outcome: 'acquired' }
  | { outcome: 'duplicate'; status: DeliveryStatus; messageId?: string }
  | { outcome: 'inProgress' }
  | { outcome: 'uncertain' };

export type DeliveryRecord = {
  pk: string;
  sk: string;
  status: DeliveryStatus;
  messageId?: string;
  failureClass?: FailureClass;
  errorCode?: string;
  updatedAt: string;
  eventId: string;
  templateName: string;
};

export interface EmailDeliveryStore {
  claim(input: DeliveryClaimInput): Promise<DeliveryClaimResult>;
  markSent(idempotencyKey: string, messageId: string): Promise<void>;
  markFailed(
    idempotencyKey: string,
    failureClass: FailureClass,
    errorCode: string,
  ): Promise<void>;
  recordLifecycle(
    messageId: string,
    status: DeliveryStatus,
  ): Promise<'updated' | 'ignored' | 'missing'>;
}

/**
 * Consistency trade-off for at-least-once SQS delivery:
 * claim uses a conditional put. SES acceptance and the sent write are not one transaction.
 * If the process dies after SES accepts the message and before markSent, the record stays
 * inProgress without a messageId. A later delivery sees that stale claim and stops
 * (uncertain) instead of sending a second email. Operators reconcile from the DLQ and
 * the SES message id emitted in the success log when the write itself failed.
 * A retryable SES error that is persisted as failed/retryable can be claimed again.
 */
export class MemoryEmailDeliveryStore implements EmailDeliveryStore {
  private readonly records = new Map<string, DeliveryRecord>();
  private now = Date.now();

  constructor(private readonly lockTimeoutMs = 150_000) {}

  setNow(epochMs: number): void {
    this.now = epochMs;
  }

  async claim(input: DeliveryClaimInput): Promise<DeliveryClaimResult> {
    const pk = deliveryPartitionKey(input.idempotencyKey);
    const existing = this.records.get(pk);
    if (!existing) {
      this.records.set(pk, this.inProgress(pk, input));
      return { outcome: 'acquired' };
    }
    return this.decideExisting(existing, input);
  }

  async markSent(idempotencyKey: string, messageId: string): Promise<void> {
    const pk = deliveryPartitionKey(idempotencyKey);
    const existing = this.records.get(pk);
    if (!existing || existing.status !== DELIVERY_STATUS.IN_PROGRESS || existing.messageId) {
      if (existing?.messageId === messageId && existing.status === DELIVERY_STATUS.SENT) {
        return;
      }
      throw new Error('Conditional markSent failed');
    }
    existing.status = DELIVERY_STATUS.SENT;
    existing.messageId = messageId;
    existing.updatedAt = new Date(this.now).toISOString();
  }

  async markFailed(
    idempotencyKey: string,
    failureClass: FailureClass,
    errorCode: string,
  ): Promise<void> {
    const pk = deliveryPartitionKey(idempotencyKey);
    const existing = this.records.get(pk);
    if (!existing || existing.status !== DELIVERY_STATUS.IN_PROGRESS || existing.messageId) {
      throw new Error('Conditional markFailed failed');
    }
    existing.status = DELIVERY_STATUS.FAILED;
    existing.failureClass = failureClass;
    existing.errorCode = errorCode;
    existing.updatedAt = new Date(this.now).toISOString();
  }

  async recordLifecycle(
    messageId: string,
    status: DeliveryStatus,
  ): Promise<'updated' | 'ignored' | 'missing'> {
    const record = [...this.records.values()].find((item) => item.messageId === messageId);
    if (!record) {
      return 'missing';
    }
    if (!canApplyLifecycleStatus(record.status, status)) {
      return 'ignored';
    }
    record.status = status;
    record.updatedAt = new Date(this.now).toISOString();
    return 'updated';
  }

  private decideExisting(
    existing: DeliveryRecord,
    input: DeliveryClaimInput,
  ): DeliveryClaimResult {
    if (
      existing.status === DELIVERY_STATUS.SENT ||
      existing.status === DELIVERY_STATUS.DELIVERED ||
      existing.status === DELIVERY_STATUS.BOUNCED ||
      existing.status === DELIVERY_STATUS.COMPLAINED ||
      existing.status === DELIVERY_STATUS.REJECTED
      || existing.status === DELIVERY_STATUS.RENDERING_FAILED
    ) {
      return {
        outcome: 'duplicate',
        status: existing.status,
        messageId: existing.messageId,
      };
    }
    if (existing.status === DELIVERY_STATUS.FAILED && existing.failureClass === FAILURE_CLASS.PERMANENT) {
      return { outcome: 'duplicate', status: existing.status, messageId: existing.messageId };
    }
    if (existing.status === DELIVERY_STATUS.FAILED && existing.failureClass === FAILURE_CLASS.RETRYABLE) {
      existing.status = DELIVERY_STATUS.IN_PROGRESS;
      existing.failureClass = undefined;
      existing.errorCode = undefined;
      existing.updatedAt = new Date(this.now).toISOString();
      existing.eventId = input.eventId;
      return { outcome: 'acquired' };
    }
    if (existing.messageId) {
      return { outcome: 'duplicate', status: existing.status, messageId: existing.messageId };
    }
    const age = this.now - Date.parse(existing.updatedAt);
    if (age > this.lockTimeoutMs) {
      return { outcome: 'uncertain' };
    }
    return { outcome: 'inProgress' };
  }

  private inProgress(pk: string, input: DeliveryClaimInput): DeliveryRecord {
    return {
      pk,
      sk: DELIVERY_SK,
      status: DELIVERY_STATUS.IN_PROGRESS,
      updatedAt: new Date(this.now).toISOString(),
      eventId: input.eventId,
      templateName: input.templateName,
    };
  }
}
