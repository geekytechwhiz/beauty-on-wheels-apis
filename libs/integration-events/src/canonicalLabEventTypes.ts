export const CANONICAL_LAB_EVENT_TYPES = [
  // Original events
  'SAMPLE_COLLECTED',
  'SAMPLE_RECEIVED',
  'REPORT_READY',
  'BOOKING_CANCELLED',
  // Orange Health events
  'ORDER_CREATED',
  'ORDER_CONFIRMED',
  'ORDER_COMPLETED',
  'TASK_ASSIGNED',
  'TASK_ACCEPTED',
  'TASK_STARTED',
  'TASK_DELETED',
] as const;

export type CanonicalLabEventType = (typeof CANONICAL_LAB_EVENT_TYPES)[number];

export function isCanonicalLabEventType(value: string): value is CanonicalLabEventType {
  return (CANONICAL_LAB_EVENT_TYPES as readonly string[]).includes(value);
}
