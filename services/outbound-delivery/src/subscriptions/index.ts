/**
 * Subscription delivery stub — deliver FHIR subscription notifications to subscribers.
 */
export interface SubscriptionDeliveryPayload {
  subscriptionId: string;
  resourceType: string;
  resourceId: string;
  eventType: string;
  payload: unknown;
}

export async function deliverSubscription(
  _payload: SubscriptionDeliveryPayload
): Promise<{ success: boolean; statusCode?: number }> {
  // Placeholder: HTTP POST to subscriber endpoint, retry logic, etc.
  return { success: true };
}
