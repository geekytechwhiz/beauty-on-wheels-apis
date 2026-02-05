import type { CanonicalLabEventType } from '@api-hub/integration-events';

/**
 * Partner-agnostic canonical lab event (no FHIR).
 */
export interface CanonicalLabEvent {
  eventType: CanonicalLabEventType;
  partnerId: string;
  labOrderId: string;
  occurredAt: string;
  rawReferenceId: string;
}
