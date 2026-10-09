import {
  isVendorEmailVerificationRequestedTransition,
  toVendorEmailVerificationRequestedPayload,
} from './map-vendor-email-verification-requested-stream';

describe('vendor email verification stream mapping', () => {
  it('detects a newly persisted verification request independently of onboarding completion', () => {
    expect(isVendorEmailVerificationRequestedTransition(
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION' },
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION', emailVerificationDispatchPending: true, emailVerificationRequestId: 'request-1', emailVerificationOtp: 'vendor-1.token' },
    )).toBe(true);
    expect(isVendorEmailVerificationRequestedTransition(
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION', emailVerificationRequestId: 'request-1' },
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION', emailVerificationDispatchPending: true, emailVerificationRequestId: 'request-1', emailVerificationOtp: 'vendor-1.token' },
    )).toBe(false);
    expect(isVendorEmailVerificationRequestedTransition(
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION', emailVerificationRequestId: 'request-1' },
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION', emailVerificationRequestId: 'request-2', emailVerificationDispatchPending: true },
    )).toBe(false);
  });

  it('does not request verification for a verified or non-profile record', () => {
    expect(isVendorEmailVerificationRequestedTransition(
      { entityType: 'Vendor' },
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION', emailVerificationDispatchPending: true, emailVerificationRequestId: 'request-1', emailVerificationOtp: 'token', emailVerifiedAt: '2026-01-01T00:00:00.000Z' },
    )).toBe(false);
    expect(isVendorEmailVerificationRequestedTransition(
      { entityType: 'Vendor' },
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION', emailVerificationDispatchPending: true, emailVerificationRequestId: 'request-1', emailVerificationOtp: 'token', emailVerificationConsumedAt: '2026-01-01T00:00:00.000Z' },
    )).toBe(false);
    expect(isVendorEmailVerificationRequestedTransition(
      { entityType: 'VendorDocument' },
      { entityType: 'VendorDocument', status: 'PENDING_VERIFICATION' },
    )).toBe(false);
  });

  it('maps the verification request contract without extra vendor PII', () => {
    expect(toVendorEmailVerificationRequestedPayload({
      vendorId: 'vendor-1', emailVerificationRequestId: 'verify-1', ownerUserId: 'user-1',
      email: 'owner@example.com', contactName: 'Priya Sharma', businessName: 'ABC Car Wash', emailVerificationOtp: 'vendor-1.token',
      emailVerificationExpiryMinutes: 10, applicationId: 'app-1', phoneNumber: '+919876543210',
    })).toEqual({
      vendorId: 'vendor-1', verificationRequestId: 'verify-1', intent: 'VENDOR_EMAIL_VERIFICATION',
      ownerUserId: 'user-1', email: 'owner@example.com', ownerName: 'Priya', businessName: 'ABC Car Wash', verificationToken: 'vendor-1.token',
      expiryMinutes: 10, vendorStatus: 'PENDING_VERIFICATION', applicationId: 'app-1',
    });
  });
});
