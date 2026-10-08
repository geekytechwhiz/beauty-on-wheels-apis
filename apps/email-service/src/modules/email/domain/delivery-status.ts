export const DELIVERY_STATUS = {
  IN_PROGRESS: 'inProgress',
  SENT: 'sent',
  DELIVERED: 'delivered',
  BOUNCED: 'bounced',
  COMPLAINED: 'complained',
  REJECTED: 'rejected',
  RENDERING_FAILED: 'renderingFailed',
  DELIVERY_DELAYED: 'deliveryDelayed',
  FAILED: 'failed',
} as const;

export type DeliveryStatus =
  (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS];

export const FAILURE_CLASS = {
  RETRYABLE: 'retryable',
  PERMANENT: 'permanent',
} as const;

export type FailureClass = (typeof FAILURE_CLASS)[keyof typeof FAILURE_CLASS];

export const DELIVERY_ENTITY_TYPE = 'EmailDelivery';
export const DELIVERY_SK = 'STATUS';

export function deliveryPartitionKey(idempotencyKey: string): string {
  return `DELIVERY#${idempotencyKey}`;
}

export function messageIndexKey(messageId: string): string {
  return `MSG#${messageId}`;
}

const TERMINAL_FAILURES = new Set<DeliveryStatus>([
  DELIVERY_STATUS.BOUNCED,
  DELIVERY_STATUS.COMPLAINED,
  DELIVERY_STATUS.REJECTED,
  DELIVERY_STATUS.RENDERING_FAILED,
]);

export function canApplyLifecycleStatus(
  current: DeliveryStatus,
  next: DeliveryStatus,
): boolean {
  if (current === next) {
    return false;
  }
  if (TERMINAL_FAILURES.has(next)) {
    return (
      current === DELIVERY_STATUS.IN_PROGRESS ||
      current === DELIVERY_STATUS.SENT ||
      current === DELIVERY_STATUS.DELIVERY_DELAYED ||
      current === DELIVERY_STATUS.DELIVERED
    );
  }
  if (next === DELIVERY_STATUS.DELIVERED) {
    return (
      current === DELIVERY_STATUS.SENT ||
      current === DELIVERY_STATUS.IN_PROGRESS ||
      current === DELIVERY_STATUS.DELIVERY_DELAYED
    );
  }
  if (next === DELIVERY_STATUS.SENT) {
    return current === DELIVERY_STATUS.IN_PROGRESS;
  }
  if (next === DELIVERY_STATUS.DELIVERY_DELAYED) {
    return (
      current === DELIVERY_STATUS.IN_PROGRESS ||
      current === DELIVERY_STATUS.SENT
    );
  }
  return false;
}
