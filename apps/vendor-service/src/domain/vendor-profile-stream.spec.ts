import {
  shouldInitiateAccountProvisioning,
  isVendorProfileRecord,
} from './vendor-profile-stream';

describe('vendor profile stream rules', () => {
  const profile = {
    entityType: 'Vendor',
    SK: 'PROFILE',
    vendorId: 'vendor-1',
    loginPhoneNumber: '+919876543210',
    accountProvisioningStatus: 'PENDING',
  };

  it('recognizes vendor PROFILE records only', () => {
    expect(isVendorProfileRecord(profile)).toBe(true);
    expect(isVendorProfileRecord({ ...profile, entityType: 'VendorDocument' })).toBe(false);
    expect(isVendorProfileRecord({ ...profile, SK: 'OWNER' })).toBe(false);
  });

  it('initiates provisioning on PROFILE INSERT with PENDING status', () => {
    expect(
      shouldInitiateAccountProvisioning({
        eventName: 'INSERT',
        newImage: profile,
      }),
    ).toBe(true);
  });

  it('does not initiate when provisioning is already COMPLETED with identityId', () => {
    expect(
      shouldInitiateAccountProvisioning({
        eventName: 'INSERT',
        newImage: {
          ...profile,
          accountProvisioningStatus: 'COMPLETED',
          identityId: 'sub-1',
        },
      }),
    ).toBe(false);
  });

  it('ignores linkage/status-only MODIFY without a retry token', () => {
    expect(
      shouldInitiateAccountProvisioning({
        eventName: 'MODIFY',
        oldImage: profile,
        newImage: {
          ...profile,
          identityId: 'sub-1',
          accountProvisioningStatus: 'COMPLETED',
          ownerUserId: 'u-1',
        },
      }),
    ).toBe(false);
  });

  it('retries only when accountProvisioningRetryRequestedAt changes', () => {
    expect(
      shouldInitiateAccountProvisioning({
        eventName: 'MODIFY',
        oldImage: { ...profile, accountProvisioningStatus: 'FAILED' },
        newImage: {
          ...profile,
          accountProvisioningStatus: 'FAILED',
          accountProvisioningRetryRequestedAt: '2026-01-02T00:00:00.000Z',
        },
      }),
    ).toBe(true);

    expect(
      shouldInitiateAccountProvisioning({
        eventName: 'MODIFY',
        oldImage: {
          ...profile,
          accountProvisioningStatus: 'FAILED',
          accountProvisioningRetryRequestedAt: '2026-01-02T00:00:00.000Z',
        },
        newImage: {
          ...profile,
          accountProvisioningStatus: 'FAILED',
          accountProvisioningRetryRequestedAt: '2026-01-02T00:00:00.000Z',
          businessName: 'Renamed',
        },
      }),
    ).toBe(false);
  });

  it('ignores REMOVE and missing login phone', () => {
    expect(
      shouldInitiateAccountProvisioning({
        eventName: 'REMOVE',
        oldImage: profile,
      }),
    ).toBe(false);
    expect(
      shouldInitiateAccountProvisioning({
        eventName: 'INSERT',
        newImage: { ...profile, loginPhoneNumber: '' },
      }),
    ).toBe(false);
  });
});
