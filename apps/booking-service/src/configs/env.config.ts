export const env = {
  SERVICE_NAME: process.env.SERVICE_NAME || '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || '',
  EVENT_BUS_NAME: process.env.EVENT_BUS_NAME || '',
  CATALOG_BASE_URL: process.env.CATALOG_BASE_URL || '',
  VENDOR_BASE_URL: process.env.VENDOR_BASE_URL || '',
  VENDOR_CHECKOUT_ELIGIBILITY_FUNCTION: process.env.VENDOR_CHECKOUT_ELIGIBILITY_FUNCTION || '',
  USER_BASE_URL: process.env.USER_BASE_URL || '',
  VEHICLE_BASE_URL: process.env.VEHICLE_BASE_URL || '',
  AVAILABILITY_BASE_URL: process.env.AVAILABILITY_BASE_URL || '',
  AVAILABILITY_RESERVE_BOOKING_FUNCTION: process.env.AVAILABILITY_RESERVE_BOOKING_FUNCTION || '',
  AVAILABILITY_CONSUME_HOLD_FUNCTION: process.env.AVAILABILITY_CONSUME_HOLD_FUNCTION || '',
  AVAILABILITY_RELEASE_ALLOCATION_FUNCTION: process.env.AVAILABILITY_RELEASE_ALLOCATION_FUNCTION || '',
  /**
   * When true, community bookings require an active offering-community mapping.
   * Leave false until GSI3 is ACTIVE and the backfill has been verified.
   */
  COMMUNITY_OFFERING_ENFORCEMENT: process.env.COMMUNITY_OFFERING_ENFORCEMENT || 'false',
  /**
   * When true, customers may complete sandbox payments through
   * POST /bookings/{bookingId}/payments/{paymentId}/sandbox-complete.
   * Forced off for prod/production stages regardless of this flag.
   */
  PAYMENT_SANDBOX_ENABLED: process.env.PAYMENT_SANDBOX_ENABLED || 'true',
  /** SANDBOX | RAZORPAY. RAZORPAY requires key/secret; falls back to SANDBOX when unset. */
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER || 'SANDBOX',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  STAGE: process.env.STAGE || process.env.AWS_STAGE || '',
};
