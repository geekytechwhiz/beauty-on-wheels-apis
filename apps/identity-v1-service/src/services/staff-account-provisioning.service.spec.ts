import { APPLICATION_ROLE } from '@api-hub/authentication-core';

import { StaffAccountProvisioningService } from './staff-account-provisioning.service';

describe('StaffAccountProvisioningService', () => {
  const cognito = {
    findOrCreateUser: jest.fn(),
  };
  const repository = {
    getUserByPhone: jest.fn(),
    ensureUserRoleMapping: jest.fn(),
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
    return new StaffAccountProvisioningService(
      repository as never,
      cognito as never,
      registration,
      authentication,
    );
  }

  const request = {
    vendorId: 'vendor-1',
    staffId: 'staff-1',
    phoneNumber: '+91 98765 43210',
    displayName: 'Ananya Reddy',
  };

  it('creates a BUDDY with name and mobile number and no email', async () => {
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
    repository.ensureUserRoleMapping.mockResolvedValue('created');

    const result = await service().ensure(request);

    expect(cognito.findOrCreateUser).toHaveBeenCalledWith({
      phoneNumber: '+919876543210',
    });
    expect(cognito.findOrCreateUser.mock.calls[0][0]).not.toHaveProperty('email');
    expect(registration.createIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: '+919876543210',
        firstName: 'Ananya Reddy',
        userType: 'CUSTOMER',
        phoneVerified: false,
        identityId: 'sub-new',
      }),
    );
    expect(registration.createIdentity.mock.calls[0][0]).not.toHaveProperty('email');
    expect(repository.ensureUserRoleMapping).toHaveBeenCalledWith(
      'u-new',
      APPLICATION_ROLE.BUDDY,
    );
    expect(repository.ensureUserRoleMapping).not.toHaveBeenCalledWith(
      expect.anything(),
      APPLICATION_ROLE.STAFF,
    );
    expect(result).toEqual({ identityId: 'sub-new', userId: 'u-new' });
  });

  it('reuses an existing CUSTOMER and adds BUDDY without creating a new identity', async () => {
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
    repository.ensureUserRoleMapping.mockResolvedValue('created');

    const result = await service().ensure({
      ...request,
      phoneNumber: '+919876543210',
    });

    expect(cognito.findOrCreateUser).not.toHaveBeenCalled();
    expect(registration.createIdentity).not.toHaveBeenCalled();
    expect(repository.ensureUserRoleMapping).toHaveBeenCalledWith(
      'u-existing',
      APPLICATION_ROLE.BUDDY,
    );
    expect(result).toEqual({
      identityId: 'sub-existing',
      userId: 'u-existing',
    });
  });

  it('is idempotent when BUDDY is already mapped', async () => {
    repository.getUserByPhone.mockResolvedValue({
      userId: 'u-buddy',
      identityId: 'sub-buddy',
      phoneNumber: '+919876543210',
    });
    authentication.ensureCognitoLink.mockResolvedValue({
      userId: 'u-buddy',
      identityId: 'sub-buddy',
    });
    repository.ensureUserRoleMapping.mockResolvedValue('exists');

    const result = await service().ensure({
      ...request,
      phoneNumber: '+919876543210',
    });

    expect(registration.createIdentity).not.toHaveBeenCalled();
    expect(repository.ensureUserRoleMapping).toHaveBeenCalledWith(
      'u-buddy',
      APPLICATION_ROLE.BUDDY,
    );
    expect(result).toEqual({ identityId: 'sub-buddy', userId: 'u-buddy' });
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
    repository.ensureUserRoleMapping.mockResolvedValue('exists');

    const result = await service().ensure({
      ...request,
      phoneNumber: '+919876543210',
    });

    expect(result).toEqual({ identityId: 'sub-race', userId: 'u-race' });
  });

  it('does not grant STAFF and does not overwrite an existing identity profile', async () => {
    repository.getUserByPhone.mockResolvedValue({
      userId: 'u-vendor',
      identityId: 'sub-vendor',
      phoneNumber: '+919876543210',
      firstName: 'Existing Name',
    });
    authentication.ensureCognitoLink.mockResolvedValue({
      userId: 'u-vendor',
      identityId: 'sub-vendor',
    });
    repository.ensureUserRoleMapping.mockResolvedValue('created');

    await service().ensure({
      ...request,
      displayName: 'Would Overwrite',
      phoneNumber: '+919876543210',
    });

    expect(registration.createIdentity).not.toHaveBeenCalled();
    expect(repository.ensureUserRoleMapping).toHaveBeenCalledWith(
      'u-vendor',
      APPLICATION_ROLE.BUDDY,
    );
    expect(repository.ensureUserRoleMapping).not.toHaveBeenCalledWith(
      expect.anything(),
      APPLICATION_ROLE.STAFF,
    );
  });

  it('rejects a missing vendorId before Cognito or identity mutations', async () => {
    await expect(
      service().ensure({ ...request, vendorId: '   ' }),
    ).rejects.toThrow('vendorId is required');

    expect(repository.getUserByPhone).not.toHaveBeenCalled();
    expect(cognito.findOrCreateUser).not.toHaveBeenCalled();
    expect(registration.createIdentity).not.toHaveBeenCalled();
    expect(repository.ensureUserRoleMapping).not.toHaveBeenCalled();
  });

  it('does not complete provisioning when the BUDDY mapping persistence fails', async () => {
    repository.getUserByPhone.mockResolvedValue({
      userId: 'u-existing',
      identityId: 'sub-existing',
      phoneNumber: '+919876543210',
    });
    authentication.ensureCognitoLink.mockResolvedValue({
      userId: 'u-existing',
      identityId: 'sub-existing',
    });
    repository.ensureUserRoleMapping.mockRejectedValue(
      new Error('role write failed'),
    );

    await expect(
      service().ensure({ ...request, phoneNumber: '+919876543210' }),
    ).rejects.toThrow('role write failed');
  });

  it('surfaces Cognito provisioning failures without writing a role mapping', async () => {
    repository.getUserByPhone.mockResolvedValueOnce(null);
    cognito.findOrCreateUser.mockRejectedValue(new Error('cognito unavailable'));

    await expect(service().ensure(request)).rejects.toThrow('cognito unavailable');

    expect(registration.createIdentity).not.toHaveBeenCalled();
    expect(repository.ensureUserRoleMapping).not.toHaveBeenCalled();
  });
});
