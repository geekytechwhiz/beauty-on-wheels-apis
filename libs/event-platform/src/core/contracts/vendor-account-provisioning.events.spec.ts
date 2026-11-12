import {
  VendorAccountProvisioningRequestedEvent,
  vendorAccountProvisioningIdempotencyKey,
} from './vendor-account-provisioning.events';

describe('VendorAccountProvisioningRequestedEvent', () => {
  it('preserves the Vendor service ID in the provisioning payload', () => {
    const parsed = VendorAccountProvisioningRequestedEvent.parse({
      vendorId: 'vendor-123',
      loginPhoneNumber: '+919876543210',
      displayName: 'Priya',
    });

    expect(parsed.vendorId).toBe('vendor-123');
    expect(vendorAccountProvisioningIdempotencyKey(parsed.vendorId)).toBe(
      'Vendor.AccountProvisioningRequested:vendor-123',
    );
  });

  it('rejects a blank vendorId before Identity provisioning can start', () => {
    expect(() => VendorAccountProvisioningRequestedEvent.parse({
      vendorId: '   ',
      loginPhoneNumber: '+919876543210',
      displayName: 'Priya',
    })).toThrow('vendorId is required');
  });
});
