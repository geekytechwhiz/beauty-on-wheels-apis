 
export const CANONICAL_LAB_EVENT_TYPES = [
  'SAMPLE_COLLECTED',
  'SAMPLE_RECEIVED',
  'REPORT_READY',
  'BOOKING_CANCELLED',
] as const;

export type CanonicalLabEventType = (typeof CANONICAL_LAB_EVENT_TYPES)[number];

export function isCanonicalLabEventType(value: string): value is CanonicalLabEventType {
  return (CANONICAL_LAB_EVENT_TYPES as readonly string[]).includes(value);
}
