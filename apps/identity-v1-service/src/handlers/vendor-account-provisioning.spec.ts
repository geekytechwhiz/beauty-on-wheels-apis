const mockPublishEvent = jest.fn();

jest.mock('@api-hub/event-platform', () => ({
  onEvent: jest.fn((options) => options),
  publishEvent: mockPublishEvent,
  VendorAccountProvisioningRequestedEvent: {},
  VendorAccountProvisionedEvent: {},
  vendorAccountProvisionedIdempotencyKey: (vendorId: string, identityId: string) =>
    `Vendor.AccountProvisioned:${vendorId}:${identityId}`,
}));

jest.mock('../events/configure-identity-event-platform', () => ({
  ensureIdentityEventPlatform: jest.fn(),
}));

jest.mock('../services/vendor-account-provisioning.service', () => ({
  VendorAccountProvisioningService: class {
    async ensure() {
      throw new Error('test default service should not be invoked');
    }
  },
}));

import { createVendorAccountProvisioningHandler } from './vendor-account-provisioning';

describe('Vendor account provisioning event handler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('publishes completion only after VENDOR role mapping provisioning succeeds', async () => {
    const service = { ensure: jest.fn().mockResolvedValue({ identityId: 'identity-1', userId: 'user-1' }) };
    const options = createVendorAccountProvisioningHandler(service as never) as unknown as {
      events: Array<{ handler: (input: Record<string, unknown>) => Promise<void> }>;
    };

    await options.events[0].handler({
      vendorId: 'vendor-1', loginPhoneNumber: '+919876543210', displayName: 'Priya',
      meta: { correlationId: 'correlation-1', causationId: 'cause-1' },
    });

    expect(mockPublishEvent).toHaveBeenCalledWith(
      expect.anything(),
      { vendorId: 'vendor-1', identityId: 'identity-1', userId: 'user-1', status: 'COMPLETED' },
      expect.objectContaining({ idempotencyKey: 'Vendor.AccountProvisioned:vendor-1:identity-1' }),
    );
  });

  it('does not publish successful completion when role persistence fails', async () => {
    const service = { ensure: jest.fn().mockRejectedValue(new Error('role write failed')) };
    const options = createVendorAccountProvisioningHandler(service as never) as unknown as {
      events: Array<{ handler: (input: Record<string, unknown>) => Promise<void> }>;
    };

    await expect(options.events[0].handler({
      vendorId: 'vendor-1', loginPhoneNumber: '+919876543210', displayName: 'Priya', meta: {},
    })).rejects.toThrow('role write failed');

    expect(mockPublishEvent).not.toHaveBeenCalled();
  });
});
