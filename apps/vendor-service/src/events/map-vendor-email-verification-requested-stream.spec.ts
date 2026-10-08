import {
  isVendorEmailVerificationRequestedTransition,
  toVendorEmailVerificationRequestedPayload,
} from './map-vendor-email-verification-requested-stream';

const requiredSections = ['BUSINESS_INFO', 'OWNER_DETAILS', 'ADDRESS', 'BRANCH', 'BANK_DETAILS'];

describe('vendor email verification stream mapping', () => {
  it('detects only the unordered five-section completion transition', () => {
    expect(isVendorEmailVerificationRequestedTransition(
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION', completedSections: requiredSections.slice(0, 4) },
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION', completedSections: ['BANK_DETAILS', 'ADDRESS', 'BRANCH', 'BUSINESS_INFO', 'OWNER_DETAILS', 'DOCUMENTS'] },
    )).toBe(true);
    expect(isVendorEmailVerificationRequestedTransition(
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION', completedSections: requiredSections },
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION', completedSections: requiredSections, businessName: 'Renamed' },
    )).toBe(false);
    expect(isVendorEmailVerificationRequestedTransition(
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION', completedSections: requiredSections.slice(0, 3) },
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION', completedSections: requiredSections.slice(0, 4) },
    )).toBe(false);
  });

  it('does not request verification for a verified or non-profile record', () => {
    expect(isVendorEmailVerificationRequestedTransition(
      { entityType: 'Vendor', completedSections: [] },
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION', completedSections: requiredSections, emailVerifiedAt: '2026-01-01T00:00:00.000Z' },
    )).toBe(false);
    expect(isVendorEmailVerificationRequestedTransition(
      { entityType: 'Vendor', completedSections: [] },
      { entityType: 'Vendor', status: 'PENDING_VERIFICATION', completedSections: requiredSections, emailVerificationConsumedAt: '2026-01-01T00:00:00.000Z' },
    )).toBe(false);
    expect(isVendorEmailVerificationRequestedTransition(
      { entityType: 'VendorDocument' },
      { entityType: 'VendorDocument', status: 'PENDING_VERIFICATION', completedSections: requiredSections },
    )).toBe(false);
  });

  it('maps the verification request contract without extra vendor PII', () => {
    expect(toVendorEmailVerificationRequestedPayload({
      vendorId: 'vendor-1', emailVerificationRequestId: 'verify-1', ownerUserId: 'user-1',
      email: 'owner@example.com', contactName: 'Priya Sharma', emailVerificationOtp: '482193',
      emailVerificationExpiryMinutes: 10, applicationId: 'app-1', phoneNumber: '+919876543210',
    })).toEqual({
      vendorId: 'vendor-1', verificationRequestId: 'verify-1', intent: 'VENDOR_EMAIL_VERIFICATION',
      ownerUserId: 'user-1', email: 'owner@example.com', firstName: 'Priya', otp: '482193',
      expiryMinutes: 10, vendorStatus: 'PENDING_VERIFICATION', applicationId: 'app-1',
    });
  });
});
