function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export const env = {
  SERVICE_NAME: process.env.SERVICE_NAME || '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || '',
  EVENT_BUS_NAME: process.env.EVENT_BUS_NAME || '',
  CATALOG_BASE_URL: process.env.CATALOG_BASE_URL || '',
  VENDOR_BASE_URL: process.env.VENDOR_BASE_URL || '',
  VENDOR_CHECKOUT_ELIGIBILITY_FUNCTION: process.env.VENDOR_CHECKOUT_ELIGIBILITY_FUNCTION || '',
  VENDOR_OPERATIONAL_ACCESS_FUNCTION: process.env.VENDOR_OPERATIONAL_ACCESS_FUNCTION || '',
  VENDOR_SCHEDULING_CREWS_FUNCTION: process.env.VENDOR_SCHEDULING_CREWS_FUNCTION || '',
  VENDOR_RESERVE_CAPACITY_FUNCTION: process.env.VENDOR_RESERVE_CAPACITY_FUNCTION || '',
  VENDOR_HOLD_CAPACITY_FUNCTION: process.env.VENDOR_HOLD_CAPACITY_FUNCTION || '',
  VENDOR_CONFIRM_CAPACITY_FUNCTION: process.env.VENDOR_CONFIRM_CAPACITY_FUNCTION || '',
  VENDOR_RELEASE_CAPACITY_FUNCTION: process.env.VENDOR_RELEASE_CAPACITY_FUNCTION || '',
  VENDOR_RESERVE_VISIT_CAPACITY_FUNCTION: process.env.VENDOR_RESERVE_VISIT_CAPACITY_FUNCTION || '',
  VENDOR_RELEASE_VISIT_CAPACITY_FUNCTION: process.env.VENDOR_RELEASE_VISIT_CAPACITY_FUNCTION || '',
  /** Minutes required between a crew's communities. Not a driving-time estimate. */
  TRAVEL_BUFFER_MINUTES: process.env.TRAVEL_BUFFER_MINUTES || '30',
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
  /**
   * Local/test escape hatch for exercising the online choice before a payment
   * provider is available. It is deliberately forbidden in production.
   */
  ALLOW_UNPAID_ONLINE_BOOKING: process.env.ALLOW_UNPAID_ONLINE_BOOKING || 'false',
  /** SANDBOX | RAZORPAY. RAZORPAY requires key/secret; falls back to SANDBOX when unset. */
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER || 'SANDBOX',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  /**
   * Private bucket for visit completion evidence and issue attachments.
   * Empty means upload-url routes answer 501 and completion is checklist-only.
   */
  EVIDENCE_BUCKET: process.env.EVIDENCE_BUCKET || '',
  EVIDENCE_UPLOAD_URL_EXPIRY: positiveInt(process.env.EVIDENCE_UPLOAD_URL_EXPIRY, 900, 3600),
  AWS_REGION: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
  STAGE: process.env.STAGE || process.env.AWS_STAGE || '',
};

export function isProductionStage(stage = env.STAGE): boolean {
  return ['prod', 'production'].includes(stage.trim().toLowerCase());
}

export function isUnpaidOnlineBookingEnabled(): boolean {
  const enabled = (process.env.ALLOW_UNPAID_ONLINE_BOOKING
    ?? env.ALLOW_UNPAID_ONLINE_BOOKING
    ?? 'false').trim().toLowerCase() === 'true';
  const stage = process.env.STAGE ?? process.env.AWS_STAGE ?? env.STAGE;
  return enabled && !isProductionStage(stage);
}

/** Fails Lambda initialization rather than permitting a production bypass. */
export function validatePaymentConfiguration(input = {
  stage: env.STAGE,
  allowUnpaidOnlineBooking: env.ALLOW_UNPAID_ONLINE_BOOKING,
}): void {
  if (
    isProductionStage(input.stage)
    && input.allowUnpaidOnlineBooking.trim().toLowerCase() === 'true'
  ) {
    throw new Error('ALLOW_UNPAID_ONLINE_BOOKING must not be enabled in production');
  }
}

validatePaymentConfiguration();
