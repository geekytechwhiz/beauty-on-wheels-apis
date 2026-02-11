import { isCanonicalLabEventType, type CanonicalLabEventType } from '@api-hub/integration-events';

/**
 * Subscription delivery stub — deliver FHIR subscription notifications to subscribers.
 * eventType should align with canonical lab event types when delivering lab events.
 */
export interface SubscriptionDeliveryPayload {
  subscriptionId: string;
  resourceType: string;
  resourceId: string;
  /** Use CanonicalLabEventType for lab events (SAMPLE_COLLECTED, REPORT_READY, etc.) */
  eventType: string;
  payload: unknown;
}

/**
 * Returns true if the event type is a canonical lab event (for routing/filtering).
 */
export function isLabSubscriptionEvent(eventType: string): eventType is CanonicalLabEventType {
  return isCanonicalLabEventType(eventType);
}

export async function deliverSubscription(
  _payload: SubscriptionDeliveryPayload
): Promise<{ success: boolean; statusCode?: number }> {
  // Placeholder: HTTP POST to subscriber endpoint, retry logic, etc.
  // When implementing: use isLabSubscriptionEvent(payload.eventType) to route lab events
  return { success: true };
}
