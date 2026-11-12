import { VendorAccountProvisioningService } from './vendor-account-provisioning.service';

describe('VendorAccountProvisioningService', () => {
  const cognito = {
    findOrCreateUser: jest.fn(),
  };
  const repository = {
    getUserByPhone: jest.fn(),
    ensureVendorRoleMapping: jest.fn(),
  };
  const registration = {
    createIdentity: jest.fn(),
  };
  const authentication = {
    ensureCognitoLink: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  function service() {
    return new VendorAccountProvisioningService(
      repository as never,
      cognito as never,
      registration,
      authentication,
    );
  }

  it('creates a new identity with VENDOR as the initial application role', async () => {
    repository.getUserByPhone.mockResolvedValueOnce(null);
    cognito.findOrCreateUser.mockResolvedValue({
      sub: 'sub-new',
      username: 'phone_+919876543210',
    });
    registration.createIdentity.mockResolvedValue({
      userId: 'u-new',
      identityId: 'sub-new',
      phoneNumber: '+919876543210',
    });
    authentication.ensureCognitoLink.mockResolvedValue({
      userId: 'u-new',
      identityId: 'sub-new',
    });
    repository.ensureVendorRoleMapping.mockResolvedValue('exists');

    const result = await service().ensure({
      vendorId: 'vendor-1',
      loginPhoneNumber: '+91 98765 43210',
      displayName: 'Priya',
      email: 'priya@example.com',
    });

    expect(registration.createIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: '+919876543210',
        userType: 'VENDOR',
        vendorRegistration: true,
        phoneVerified: false,
        emailVerified: false,
        identityId: 'sub-new',
      }),
    );
    expect(repository.ensureVendorRoleMapping).toHaveBeenCalledWith('u-new', 'vendor-1');
    expect(result).toEqual({ identityId: 'sub-new', userId: 'u-new' });
  });

  it('reuses an existing CUSTOMER and adds VENDOR without creating a new identity', async () => {
    repository.getUserByPhone.mockResolvedValue({
      userId: 'u-existing',
      identityId: 'sub-existing',
      phoneNumber: '+919876543210',
      cognitoUsername: 'phone_+919876543210',
    });
    authentication.ensureCognitoLink.mockResolvedValue({
      userId: 'u-existing',
      identityId: 'sub-existing',
      cognitoUsername: 'phone_+919876543210',
    });
    repository.ensureVendorRoleMapping.mockResolvedValue('created');

    const result = await service().ensure({
      vendorId: 'vendor-2',
      loginPhoneNumber: '+919876543210',
      displayName: 'Priya',
    });

    expect(cognito.findOrCreateUser).not.toHaveBeenCalled();
    expect(registration.createIdentity).not.toHaveBeenCalled();
    expect(repository.ensureVendorRoleMapping).toHaveBeenCalledWith('u-existing', 'vendor-2');
    expect(result).toEqual({
      identityId: 'sub-existing',
      userId: 'u-existing',
    });
  });

  it('reuses an existing VENDOR without creating duplicates', async () => {
    repository.getUserByPhone.mockResolvedValue({
      userId: 'u-vendor',
      identityId: 'sub-vendor',
      phoneNumber: '+919876543210',
      cognitoUsername: 'phone_+919876543210',
    });
    authentication.ensureCognitoLink.mockResolvedValue({
      userId: 'u-vendor',
      identityId: 'sub-vendor',
      cognitoUsername: 'phone_+919876543210',
    });
    repository.ensureVendorRoleMapping.mockResolvedValue('exists');

    const result = await service().ensure({
      vendorId: 'vendor-3',
      loginPhoneNumber: '+919876543210',
      displayName: 'Priya',
    });

    expect(registration.createIdentity).not.toHaveBeenCalled();
    expect(result).toEqual({ identityId: 'sub-vendor', userId: 'u-vendor' });
  });

  it('recovers from a concurrent create by reusing the winning phone identity', async () => {
    repository.getUserByPhone
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        userId: 'u-race',
        identityId: 'sub-race',
        phoneNumber: '+919876543210',
      });
    cognito.findOrCreateUser.mockResolvedValue({
      sub: 'sub-race',
      username: 'phone_+919876543210',
    });
    registration.createIdentity.mockRejectedValue(new Error('conditional'));
    authentication.ensureCognitoLink.mockResolvedValue({
      userId: 'u-race',
      identityId: 'sub-race',
    });
    repository.ensureVendorRoleMapping.mockResolvedValue('exists');

    const result = await service().ensure({
      vendorId: 'vendor-4',
      loginPhoneNumber: '+919876543210',
      displayName: 'Priya',
    });

    expect(result).toEqual({ identityId: 'sub-race', userId: 'u-race' });
  });

  it('rejects a missing vendorId before Cognito or identity mutations', async () => {
    await expect(service().ensure({
      vendorId: '   ',
      loginPhoneNumber: '+91 98765 43210',
      displayName: 'Priya',
    })).rejects.toThrow('vendorId is required');

    expect(repository.getUserByPhone).not.toHaveBeenCalled();
    expect(cognito.findOrCreateUser).not.toHaveBeenCalled();
    expect(registration.createIdentity).not.toHaveBeenCalled();
    expect(repository.ensureVendorRoleMapping).not.toHaveBeenCalled();
  });

  it('does not complete provisioning when the VENDOR mapping persistence fails', async () => {
    repository.getUserByPhone.mockResolvedValue({
      userId: 'u-existing', identityId: 'sub-existing', phoneNumber: '+919876543210',
    });
    authentication.ensureCognitoLink.mockResolvedValue({
      userId: 'u-existing', identityId: 'sub-existing',
    });
    repository.ensureVendorRoleMapping.mockRejectedValue(new Error('role write failed'));

    await expect(service().ensure({
      vendorId: 'vendor-2', loginPhoneNumber: '+919876543210', displayName: 'Priya',
    })).rejects.toThrow('role write failed');
  });
});
