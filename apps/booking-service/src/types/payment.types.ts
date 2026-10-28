export type CustomerPaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
export type PaymentProvider = 'SANDBOX' | 'RAZORPAY';

export interface CustomerPaymentRecord {
  paymentId: string;
  bookingId: string;
  customerId: string;
  /**
   * Catalog/booking integer amount (INR rupees historically named amountMinor).
   * Never trust a client amount; always sourced from the booking snapshot.
   */
  amountMinor: number;
  /** ISO 4217 minor units sent to the provider (paise for INR). */
  providerAmountMinor: number;
  currency: string;
  status: CustomerPaymentStatus;
  provider: PaymentProvider;
  checkoutToken: string;
  /** Public Razorpay key id for client checkout when provider=RAZORPAY. */
  checkoutKeyId?: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  idempotencyKey: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CustomerPaymentDdbItem extends CustomerPaymentRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK?: string;
  GSI2SK?: string;
  entityType: 'CustomerPayment';
}

export interface CustomerPaymentIdempotencyDdbItem {
  PK: string;
  SK: string;
  paymentId: string;
  bookingId: string;
  customerId: string;
  entityType: 'CustomerPaymentIdempotency';
}
