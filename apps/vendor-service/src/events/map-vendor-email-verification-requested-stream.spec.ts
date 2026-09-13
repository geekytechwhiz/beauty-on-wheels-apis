import {
  isVendorConfirmedTransition,
  toVendorEmailVerificationRequestedPayload,
} from './map-vendor-email-verification-requested-stream';

describe('isVendorConfirmedTransition', () => {
  it('is true only for Vendor profile PENDING_VERIFICATION → ACTIVE', () => {
    expect(
      isVendorConfirmedTransition(
        { entityType: 'Vendor', status: 'PENDING_VERIFICATION' },
        { entityType: 'Vendor', status: 'ACTIVE' },
      ),
    ).toBe(true);
  });

  it('is false for ACTIVE → ACTIVE', () => {
    expect(
      isVendorConfirmedTransition(
        { entityType: 'Vendor', status: 'ACTIVE' },
        { entityType: 'Vendor', status: 'ACTIVE', businessName: 'Renamed' },
      ),
    ).toBe(false);
  });

  it('is false for PENDING_VERIFICATION → REJECTED', () => {
    expect(
      isVendorConfirmedTransition(
        { entityType: 'Vendor', status: 'PENDING_VERIFICATION' },
        { entityType: 'Vendor', status: 'REJECTED' },
      ),
    ).toBe(false);
  });

  it('is false for child entity updates', () => {
    expect(
      isVendorConfirmedTransition(
        { entityType: 'VendorDocument' },
        { entityType: 'VendorDocument' },
      ),
    ).toBe(false);
  });
});

describe('toVendorEmailVerificationRequestedPayload', () => {
  it('maps confirmation and verification fields without extra vendor PII', () => {
    expect(
      toVendorEmailVerificationRequestedPayload({
        vendorId: 'vendor-1',
        ownerUserId: 'user-1',
        email: 'owner@example.com',
        contactName: 'Priya Sharma',
        emailVerificationOtp: '482193',
        emailVerificationExpiryMinutes: 10,
        status: 'ACTIVE',
        applicationId: 'app-1',
        phoneNumber: '+919876543210',
        gstNumber: 'GST',
      }),
    ).toEqual({
      vendorId: 'vendor-1',
      ownerUserId: 'user-1',
      email: 'owner@example.com',
      firstName: 'Priya',
      otp: '482193',
      expiryMinutes: 10,
      vendorStatus: 'ACTIVE',
      applicationId: 'app-1',
    });
  });
});
