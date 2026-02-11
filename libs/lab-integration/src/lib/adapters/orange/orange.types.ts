/**
 * Orange Health-specific types.
 * Based on Orange Health API documentation: https://orangehealth.docs.apiary.io/
 * TODO: Verify exact response structure from API docs
 */
export interface OrangeOrderResponse {
  orderId?: string;
  id?: string; // Alternative field name
  status?: string;
  message?: string;
  // Add other response fields as needed after API verification
}
