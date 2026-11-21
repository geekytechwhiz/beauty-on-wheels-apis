import { LambdaRequest } from '@api-hub/utils';
import {
  ConditionalWriteConflictError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from '@api-hub/utils';
import type { AuthUserDirectory } from '@api-hub/authentication-core';

import { VendorsService } from './vendors.service';
import { VendorsRepository } from '../repositories/vendors.repository';
import { CommunitiesRepository } from '../repositories/communities.repository';
import { CapabilitiesRepository } from '../repositories/capabilities.repository';
import { StaffRepository } from '../repositories/staff.repository';
import {
  validateCreateVendorRequest,
  validateUpdateVendorRequest,
} from '../schemas/vendors.schema';
import { VendorDdbItem } from '../types/repository.types';

function authRequest(overrides: Record<string, unknown> = {}): LambdaRequest {
  return {
    pathParameters: { vendorId: 'vendor-1', ...(overrides.pathParameters as object) },
    params: { vendorId: 'vendor-1', ...(overrides.params as object) },
    body: overrides.body,
    context: {
      userContext: { userId: 'user-1' },
      ...(overrides.context as object),
    },
    ...overrides,
  } as unknown as LambdaRequest;
}

function vendorAuthorized(
  roles: string[],
  overrides: Record<string, unknown> = {},
  permissions: string[] = [],
): LambdaRequest {
  return authRequest({
    ...overrides,
    context: {
      userContext: { userId: 'user-1', roles, permissions },
      authContext: {
        userId: 'user-1',
        identityId: 'sub-1',
        roles,
        permissions,
        claims: {},
      },
    },
  });
}

function vendorItem(): VendorDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'PROFILE',
    vendorId: 'vendor-1',
    ownerUserId: 'user-1',
     businessType: 'BUSINESS',
    status: 'PENDING_VERIFICATION',
    operationalStatus: 'OFFLINE',
    onboardingStatus: 'DRAFT',
    contactName: 'Priya Sharma',
    email: 'priya@glowsalon.example',
    currentSection: 'BUSINESS_INFO',
    completedSections: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    GSI1PK: 'VENDOR',
    GSI1SK: 'STATUS#PENDING_VERIFICATION#OPERATIONAL#OFFLINE#2026-01-01T00:00:00.000Z#vendor-1',
    entityType: 'Vendor',
  };
}

describe('VendorsService', () => {
  let repository: jest.Mocked<VendorsRepository>;
  let communitiesRepository: jest.Mocked<CommunitiesRepository>;
  let capabilitiesRepository: jest.Mocked<Pick<CapabilitiesRepository, 'getCapabilities'>>;
  let staffRepository: jest.Mocked<Pick<StaffRepository, 'listMembershipsByUserId'>>;
  let service: VendorsService;

  beforeEach(() => {
    repository = {
      getVendorById: jest.fn().mockResolvedValue(vendorItem()),
      getVendorIdByOwnerUserId: jest.fn().mockResolvedValue(null),
      listOwnersByUserId: jest.fn().mockResolvedValue([]),
      getOwnershipVendorId: jest.fn().mockResolvedValue(null),
      putOwnershipIfAbsent: jest.fn().mockResolvedValue(undefined),
      createVendor: jest.fn().mockResolvedValue(undefined),
      getAddress: jest.fn().mockResolvedValue(null),
      getOperatingPreferences: jest.fn().mockResolvedValue(null),
      getIndicativeCapacity: jest.fn().mockResolvedValue(null),
      putIfAbsent: jest.fn().mockResolvedValue(undefined),
      updateVendor: jest.fn().mockResolvedValue(undefined),
      queryVendorItems: jest.fn().mockResolvedValue([vendorItem()]),
      transactVendorProfile: jest.fn().mockResolvedValue(undefined),
      listVendors: jest.fn(),
      listStatusHistory: jest.fn().mockResolvedValue([]),
      getVendorsByIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<VendorsRepository>;

    communitiesRepository = {
      listByVendor: jest.fn().mockResolvedValue([]),
      listByCommunity: jest.fn(),
      getActiveCommunity: jest.fn(),
    } as unknown as jest.Mocked<CommunitiesRepository>;
    capabilitiesRepository = {
      getCapabilities: jest.fn().mockResolvedValue(null),
    };
    staffRepository = {
      listMembershipsByUserId: jest.fn().mockResolvedValue([]),
    };
    service = new VendorsService(
      repository,
      communitiesRepository,
      staffRepository as unknown as StaffRepository,
      undefined,
      capabilitiesRepository as unknown as CapabilitiesRepository,
    );
  });

  const createBody = {
    businessInfo: {
      businessName: 'Glow Mobile Salon',
      contactName: 'Priya Sharma',
      phoneNumber: '+919876543210',
      email: 'priya@glowsalon.example',
      description: 'Premium mobile beauty and grooming services',
      gstNumber: '29ABCDE1234F1Z5',
      panNumber: 'ABCDE1234F',
      profileImageUrl: 'https://cdn.example.com/vendors/glow.jpg',
    },
    ownerDetails: {
      phoneNumber: '+919876543210',
      fullName: 'Priya Sharma',
      email: 'priya@glowsalon.example',
    },
  };

  it('creates a vendor with a unique vendorId and persisted business info', async () => {
    const result = await service.createvendor(
      vendorAuthorized(['VENDOR'], { body: createBody }),
    );

    expect(result.createdBy).toBe('user-1');
    expect(result.ownerUserId).toBeUndefined();
    expect(result.loginPhoneNumber).toBe('+919876543210');
    expect(result.accountProvisioningStatus).toBe('PENDING');
    expect(result.vendorId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(result.businessName).toBe('Glow Mobile Salon');
    expect(result.contactName).toBe('Priya Sharma');
    expect(result.gstNumber).toBe('29ABCDE1234F1Z5');
    expect(result.panNumber).toBe('ABCDE1234F');
    expect(result.onboardingStatus).toBe('IN_PROGRESS');
    expect(result.status).toBe('PENDING_VERIFICATION');
    expect(repository.createVendor).toHaveBeenCalledTimes(1);
    const [profile, additional] = repository.createVendor.mock.calls[0];
    expect(profile.SK).toBe('PROFILE');
    expect(profile.createdBy).toBe('user-1');
    expect(profile.loginPhoneNumber).toBe('+919876543210');
    expect(profile.accountProvisioningStatus).toBe('PENDING');
    expect(profile.ownerUserId).toBeUndefined();
    expect(profile.vendorId).toBe(result.vendorId);
    expect(profile).toMatchObject({
      GSI1PK: 'VENDOR',
      GSI1SK: `STATUS#PENDING_VERIFICATION#OPERATIONAL#OFFLINE#${profile.createdAt}#${result.vendorId}`,
    });
    expect(additional).toEqual([]);
    expect(result.onboarding?.initialCapacity).toBeNull();
    expect(result.onboarding?.communityCoverage.communities).toEqual([]);
  });

  it('allows one staff member to create multiple vendors while retaining createdBy as audit data', async () => {
    const request = vendorAuthorized(['admin'], { body: createBody });
    const first = await service.createvendor(request);
    const second = await service.createvendor(request);

    expect(first.vendorId).not.toBe(second.vendorId);
    expect(first.createdBy).toBe('user-1');
    expect(second.createdBy).toBe('user-1');
    for (const [profile] of repository.createVendor.mock.calls) {
      expect(profile).toMatchObject({ createdBy: 'user-1', GSI1PK: 'VENDOR' });
      expect(profile.GSI1SK).toBe(
        `STATUS#${profile.status}#OPERATIONAL#${profile.operationalStatus}#${profile.createdAt}#${profile.vendorId}`,
      );
    }
  });

  it('creates the vendor and initial sections in one transaction', async () => {
    const capabilities = {
      buildInitialCapabilities: jest.fn().mockResolvedValue({
        PK: 'VENDOR#id',
        SK: 'CAPABILITIES',
        vendorId: 'id',
        vehicleTypes: ['HATCHBACK', 'SEDAN', 'SUV'],
        washMethods: ['wash:EXTERIOR'],
        serviceIds: [],
        packageIds: [],
        services: [],
        packages: [],
        configurationVersion: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        entityType: 'VendorCapabilities',
      }),
    };
    const postal = {
      resolve: jest.fn().mockResolvedValue({
        postalCode: '682021',
        locality: 'Palarivattom',
        city: 'Kochi',
        district: 'Ernakulam',
        state: 'Kerala',
        countryCode: 'IN',
      }),
    };
    communitiesRepository.getActiveCommunity.mockResolvedValue({
      PK: 'COMMUNITY#com-1',
      SK: 'META',
      communityId: 'com-1',
      name: 'Test Community',
      cityId: 'KOCHI',
      cityName: 'Kochi',
      localityName: 'Palarivattom',
      status: 'ACTIVE',
      searchText: 'test',
    });
    const onboardingService = new VendorsService(
      repository,
      communitiesRepository,
      staffRepository as unknown as StaffRepository,
      undefined,
      capabilitiesRepository as unknown as CapabilitiesRepository,
      capabilities,
      postal,
    );

    const result = await onboardingService.createvendor(vendorAuthorized(['VENDOR'], {
      body: {
        businessInfo: {
          businessName: 'Carish Test Partner',
          businessType: 'BUSINESS',
          contactName: 'Carish Contact',
          phoneNumber: '9037243199',
          email: 'info.carish@gmail.com',
          locality: 'Palarivattom',
          location: {
            addressLine1: '',
            locality: 'Palarivattom',
            city: 'Kochi',
            district: 'Ernakulam',
            state: 'Kerala',
            postalCode: '682021',
            countryCode: 'IN',
          },
        },
        ownerDetails: {
          fullName: 'Carish Contact',
          email: 'info.carish@gmail.com',
          phoneNumber: '+919037243199',
        },
        capabilities: {
          vehicleTypes: ['HATCHBACK', 'SEDAN', 'SUV'],
          serviceIds: [],
          packageIds: [],
          washMethodIds: ['EXTERIOR'],
        },
        communityCoverage: { communityIds: ['com-1'] },
        operatingPreferences: { serviceWindowIds: ['morning'] },
        initialCapacity: { activeCrewCount: 2, indicativeVisitsPerWeek: 20 },
      },
    }));

    expect(result.businessName).toBe('Carish Test Partner');
    expect(result.address).toMatchObject({
      locality: 'Palarivattom',
      city: 'Kochi',
      district: 'Ernakulam',
      state: 'Kerala',
      postalCode: '682021',
      country: 'IN',
    });
    expect(result.onboarding?.communityCoverage.communities).toEqual([
      { communityId: 'com-1', approvalStatus: 'REQUESTED' },
    ]);
    expect(result.onboarding?.initialCapacity).toEqual({
      activeCrewCount: 2,
      indicativeVisitsPerWeek: 20,
      capacityKind: 'indicative',
    });
    expect(result.onboarding?.operatingPreferences.serviceWindowIds).toEqual(['morning']);
    expect(repository.createVendor).toHaveBeenCalledTimes(1);
    const additional = repository.createVendor.mock.calls[0][1];
    expect(additional).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'VendorAddress', locality: 'Palarivattom' }),
      expect.objectContaining({ entityType: 'VendorCapabilities' }),
      expect.objectContaining({ entityType: 'VendorOperatingPreferences', serviceWindowIds: ['morning'] }),
      expect.objectContaining({ entityType: 'VendorIndicativeCapacity', capacityKind: 'indicative' }),
      expect.objectContaining({ entityType: 'VendorCommunity', approvalStatus: 'REQUESTED', communityId: 'com-1' }),
    ]));
    expect(result).not.toHaveProperty('locality');
  });

  it('rejects conflicting locality values before writing', async () => {
    await expect(service.createvendor(vendorAuthorized(['VENDOR'], {
      body: {
        businessInfo: {
          businessName: 'Carish Test Partner',
          locality: 'Kakkanad',
          location: {
            locality: 'Palarivattom',
            postalCode: '682021',
          },
        },
      },
    }))).rejects.toThrow('Invalid vendor registration request');
    expect(repository.createVendor).not.toHaveBeenCalled();
  });

  it('does not treat staff createdBy as a one-vendor ownership lock', async () => {
    repository.getOwnershipVendorId.mockResolvedValue('vendor-1');

    const result = await service.createvendor(
      vendorAuthorized(['VENDOR'], { body: createBody }),
    );

    expect(result.vendorId).not.toBe('vendor-1');
    expect(result.createdBy).toBe('user-1');
    expect(result.loginPhoneNumber).toBe('+919876543210');
    expect(repository.createVendor).toHaveBeenCalledTimes(1);
  });

  it('surfaces a create conflict without inventing ownership from createdBy', async () => {
    repository.createVendor.mockRejectedValue(
      new ConditionalWriteConflictError(new Error('conflict')),
    );

    await expect(
      service.createvendor(vendorAuthorized(['VENDOR'], { body: createBody })),
    ).rejects.toThrow('Vendor creation conflict; please retry');
    expect(repository.createVendor).toHaveBeenCalledTimes(1);
  });

  it('ignores client-supplied ownerDetails.userId and keeps createdBy as staff audit', async () => {
    const result = await service.createvendor(
      vendorAuthorized(['VENDOR'], {
        body: {
          ...createBody,
          ownerDetails: {
            ...createBody.ownerDetails,
            userId: 'user_1791439785533',
          },
        },
      }),
    );

    expect(result.createdBy).toBe('user-1');
    expect(result.ownerUserId).toBeUndefined();
    expect(result.loginPhoneNumber).toBe('+919876543210');
    const [profile] = repository.createVendor.mock.calls[0];
    expect(profile.createdBy).toBe('user-1');
    expect(profile.ownerUserId).toBeUndefined();
  });

  it('rejects vendor creation for a customer role', async () => {
    await expect(
      service.createvendor(vendorAuthorized(['CUSTOMER'], { body: createBody })),
    ).rejects.toThrow(ForbiddenError);
    expect(repository.createVendor).not.toHaveBeenCalled();
  });

  it('rejects vendor creation when the only signal is a client userType', async () => {
    await expect(
      service.createvendor(
        vendorAuthorized([], {
          body: { ...createBody, userType: 'VENDOR' },
        }),
      ),
    ).rejects.toThrow(ForbiddenError);
    expect(repository.createVendor).not.toHaveBeenCalled();
  });

  function registrantRequest(
    body: Record<string, unknown>,
    auth: Record<string, unknown> = {},
  ): LambdaRequest {
    return authRequest({
      body,
      context: {
        authContext: {
          identityId: 'sub-1',
          userId: 'user-1',
          roles: ['REGISTRANT'],
          permissions: [],
          phoneVerified: true,
          phoneNumber: '+919811122233',
          claims: {},
          ...auth,
        },
        userContext: {
          userId: 'attacker',
          roles: ['ADMIN', 'VENDOR'],
          permissions: ['vendor:create'],
        },
      },
    });
  }

  const registrationBody = {
    businessInfo: { businessName: 'Carish Dev Test Vendor' },
    ownerDetails: { fullName: 'Test Vendor Owner' },
  };

  it('creates a DRAFT vendor for a phone-verified REGISTRANT using the verified login phone', async () => {
    const result = await service.createvendor(
      registrantRequest({
        businessInfo: {
          businessName: 'Carish Dev Test Vendor',
          phoneNumber: '+910000000000',
        },
        ownerDetails: {
          fullName: 'Test Vendor Owner',
          userId: 'attacker',
          phoneNumber: '+919811122233',
        },
      }),
    );

    expect(result.createdBy).toBe('user-1');
    expect(result.ownerUserId).toBeUndefined();
    expect(result.loginPhoneNumber).toBe('+919811122233');
    expect(result.accountProvisioningStatus).toBe('PENDING');
    expect(result.businessName).toBe('Carish Dev Test Vendor');
    expect(result.onboardingStatus).toBe('DRAFT');
    expect(result.panNumber).toBeUndefined();
    expect(result.gstNumber).toBeUndefined();
    await expect(
      service.createvendor(
        registrantRequest({
          ...registrationBody,
          role: 'ADMIN',
          permissions: ['vendor:create'],
          userId: 'attacker',
        }),
      ),
    ).rejects.toThrow('Invalid vendor registration request');
    const [profile] = repository.createVendor.mock.calls[0];
    expect(profile.createdBy).toBe('user-1');
    expect(profile.ownerUserId).toBeUndefined();
    expect(profile.loginPhoneNumber).toBe('+919811122233');
  });

  it('lets a REGISTRANT create again when no ownership lock is enforced at create time', async () => {
    repository.getOwnershipVendorId.mockResolvedValue('vendor-1');
    const result = await service.createvendor(
      registrantRequest({
        ...registrationBody,
        ownerDetails: {
          ...registrationBody.ownerDetails,
          phoneNumber: '+919811122233',
        },
      }),
    );
    expect(result.vendorId).not.toBe('vendor-1');
    expect(result.loginPhoneNumber).toBe('+919811122233');
    expect(repository.createVendor).toHaveBeenCalledTimes(1);
  });

  it('denies CUSTOMER with userType VENDOR', async () => {
    await expect(
      service.createvendor(
        vendorAuthorized(['CUSTOMER'], {
          body: { ...registrationBody, userType: 'VENDOR' },
        }),
      ),
    ).rejects.toThrow(ForbiddenError);
    expect(repository.createVendor).not.toHaveBeenCalled();
  });

  it('denies an unverified phone and a missing phone contract', async () => {
    await expect(
      service.createvendor(
        registrantRequest(registrationBody, { phoneVerified: false }),
      ),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      service.createvendor(
        registrantRequest(registrationBody, { phoneNumber: undefined }),
      ),
    ).rejects.toMatchObject({ code: 'VERIFIED_PHONE_UNAVAILABLE' });
    expect(repository.createVendor).not.toHaveBeenCalled();
  });

  it('rejects a REGISTRANT with no identity-to-user mapping', async () => {
    const directory = {
      findUserByIdentityId: jest.fn().mockResolvedValue(null),
      getUserRoles: jest.fn(),
      getPermissionsForRoles: jest.fn(),
    } as unknown as jest.Mocked<AuthUserDirectory>;
    const mapped = new VendorsService(
      repository,
      communitiesRepository,
      staffRepository as unknown as StaffRepository,
      directory,
    );
    await expect(
      mapped.createvendor(
        authRequest({
          body: registrationBody,
          context: {
            authContext: {
              identityId: 'sub-1',
              roles: ['REGISTRANT'],
              permissions: [],
              phoneVerified: true,
              phoneNumber: '+919811122233',
              claims: {},
            },
            userContext: { userId: 'sub-1', identityId: 'sub-1' },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'APPLICATION_USER_NOT_FOUND' });
    expect(directory.findUserByIdentityId).toHaveBeenCalledWith('sub-1');
    expect(repository.createVendor).not.toHaveBeenCalled();
  });

  it('loads the verified phone from Identity when the authorizer omitted it', async () => {
    const directory = {
      findUserByIdentityId: jest.fn().mockResolvedValue({
        userId: 'user-1',
        phoneNumber: '+919811122233',
        phoneVerified: true,
        status: 'active',
      }),
      getUserRoles: jest.fn(),
      getPermissionsForRoles: jest.fn(),
    } as unknown as jest.Mocked<AuthUserDirectory>;
    const mapped = new VendorsService(
      repository,
      communitiesRepository,
      staffRepository as unknown as StaffRepository,
      directory,
    );
    const result = await mapped.createvendor(
      registrantRequest(
        {
          ...registrationBody,
          ownerDetails: {
            ...registrationBody.ownerDetails,
            phoneNumber: '+919811122233',
          },
        },
        {
          phoneNumber: undefined,
          phoneVerified: undefined,
        },
      ),
    );
    expect(result.loginPhoneNumber).toBe('+919811122233');
    expect(directory.findUserByIdentityId).toHaveBeenCalledWith('sub-1');
  });

  it('denies REGISTRANT access to profile, activation, and the caller vendor lookup', async () => {
    const request = registrantRequest({});
    await expect(service.getvendor(request)).rejects.toThrow(ForbiddenError);
    await expect(service.getMyVendor(request)).rejects.toThrow(ForbiddenError);
    await expect(
      service.approvevendor(authRequest({
        ...request,
        body: {},
      })),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      service.updatevendoroperationalstatus(authRequest({
        ...request,
        body: { operationalStatus: 'ONLINE' },
      })),
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows vendor creation when the authorizer resolved the VENDOR role', async () => {
    const result = await service.createvendor(
      vendorAuthorized(['VENDOR'], { body: createBody }),
    );
    expect(result.createdBy).toBe('user-1');
    expect(result.ownerUserId).toBeUndefined();
    expect(result.loginPhoneNumber).toBe('+919876543210');
    expect(repository.createVendor).toHaveBeenCalledTimes(1);
  });

  it('rejects vendor creation when the caller is unauthenticated', async () => {
    await expect(
      service.createvendor(
        authRequest({
          context: { userContext: {} },
          body: createBody,
        }),
      ),
    ).rejects.toThrow(UnauthorizedError);
    expect(repository.createVendor).not.toHaveBeenCalled();
  });

  it('does not trust ownerUserId from the request body', async () => {
    await expect(
      service.createvendor(
        authRequest({
          context: { userContext: {} },
          body: { ...createBody, ownerUserId: 'owner-from-body' },
        }),
      ),
    ).rejects.toThrow(UnauthorizedError);
    expect(repository.createVendor).not.toHaveBeenCalled();
  });

  it('rejects staff create when the explicit login phone is missing', async () => {
    await expect(
      service.createvendor(
        vendorAuthorized(['VENDOR'], {
          body: {
            businessInfo: {
              businessName: 'vendor@youpmail.com',
              contactName: 'vendor@youpmail.com',
              phoneNumber: '',
              email: '',
              description: 'KL-401-0104',
              gstNumber: 'prasanth@gmail.com',
              panNumber: 'KL-401-0104',
              profileImageUrl: 'prasanth@gmail.com',
            },
          },
        }),
      ),
    ).rejects.toThrow('ownerDetails.phoneNumber is required for vendor account provisioning');
    expect(repository.createVendor).not.toHaveBeenCalled();
  });

  it('accepts blank optional fields on the create vendor request body', () => {
    const parsed = validateCreateVendorRequest(
      authRequest({
        body: {
          businessInfo: {
            businessName: 'vendor@youpmail.com',
            contactName: 'vendor@youpmail.com',
            phoneNumber: '',
            email: '',
            description: 'KL-401-0104',
            gstNumber: 'prasanth@gmail.com',
            panNumber: 'KL-401-0104',
            profileImageUrl: 'prasanth@gmail.com',
          },
        },
      }),
    );

    expect(parsed.businessInfo?.businessName).toBe('vendor@youpmail.com');
    expect(parsed.businessInfo?.phoneNumber).toBeUndefined();
    expect(parsed.businessInfo?.email).toBeUndefined();
    expect(parsed.businessInfo?.gstNumber).toBe('prasanth@gmail.com');
    expect(parsed.businessInfo?.profileImageUrl).toBe('prasanth@gmail.com');
  });

  it('accepts business info when optional locality is omitted', () => {
    const parsed = validateCreateVendorRequest(
      authRequest({
        body: {
          businessInfo: {
            businessName: 'Glow Mobile Salon',
            contactName: 'Priya Sharma',
          },
        },
      }),
    );

    expect(parsed.businessInfo?.locality).toBeUndefined();
    expect(parsed.businessInfo?.location).toBeUndefined();
  });

  it('approves a vendor that is pending review without issuing an email OTP', async () => {
    repository.getVendorById.mockResolvedValue({
      ...vendorItem(),
      onboardingStatus: 'PENDING_REVIEW',
    });

    const result = await service.updatevendorstatus(
      authRequest({
        context: {
          userContext: { userId: 'admin-1', roles: ['admin'] },
        },
        body: { status: 'ACTIVE' },
      }),
    );

    expect(result.status).toBe('ACTIVE');
    expect(result.latestReview?.previousStatus).toBe('PENDING_VERIFICATION');
    expect(result.latestReview?.reviewerUserId).toBe('admin-1');
    expect(result).not.toHaveProperty('emailVerificationOtp');
    expect(repository.transactVendorProfile).toHaveBeenCalledTimes(1);
    const saved = repository.transactVendorProfile.mock.calls[0][0].profile;
    expect(saved.status).toBe('ACTIVE');
    expect(saved.emailVerificationOtp).toBeUndefined();
    expect(saved.latestReview?.newStatus).toBe('ACTIVE');
  });

  it('rejects approval before onboarding review', async () => {
    await expect(
      service.approvevendor(
        authRequest({
          context: {
            userContext: { userId: 'admin-1', roles: ['admin'] },
          },
          body: {},
        }),
      ),
    ).rejects.toThrow(ConflictError);
    expect(repository.transactVendorProfile).not.toHaveBeenCalled();
  });

  it('rejects an invalid lifecycle jump', async () => {
    await expect(
      service.updatevendorstatus(
        authRequest({
          context: {
            userContext: { userId: 'admin-1', roles: ['admin'] },
          },
          body: { status: 'SUSPENDED' },
        }),
      ),
    ).rejects.toThrow(ConflictError);
  });

  it('is idempotent when the vendor is already in the requested status', async () => {
    repository.getVendorById.mockResolvedValue({
      ...vendorItem(),
      status: 'ACTIVE',
      onboardingStatus: 'PENDING_REVIEW',
    });

    const result = await service.approvevendor(
      authRequest({
        context: {
          userContext: { userId: 'admin-1', roles: ['admin'] },
        },
        body: {},
      }),
    );

    expect(result.status).toBe('ACTIVE');
    expect(repository.transactVendorProfile).not.toHaveBeenCalled();
  });

  it('patches business and contact fields on the existing vendor profile', async () => {
    const result = await service.updatevendor(
      authRequest({
        body: {
          businessName: 'Glow Mobile',
          contactName: 'Priya Sharma',
          phoneNumber: '+919876543210',
          gstNumber: '29ABCDE1234F1Z5',
        },
      }),
    );

    expect(result.vendorId).toBe('vendor-1');
    expect(result.businessName).toBe('Glow Mobile');
    expect(result.gstNumber).toBe('29ABCDE1234F1Z5');
    const write = repository.transactVendorProfile.mock.calls[0][0];
    expect(write.profile.PK).toBe('VENDOR#vendor-1');
    expect(write.profile.businessName).toBe('Glow Mobile');
    expect(write.expectedUpdatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(write.puts).toBeUndefined();
    expect(repository.createVendor).not.toHaveBeenCalled();
  });

  it('rejects address fields on the profile patch', () => {
    expect(() =>
      validateUpdateVendorRequest(
        authRequest({
          body: {
            businessName: 'Glow Mobile',
            address: { city: 'Bengaluru' },
          },
        }),
      ),
    ).toThrow(/validation failed/i);
  });

  it('does not regenerate verification data for unrelated status updates', async () => {
    repository.getVendorById.mockResolvedValue({
      ...vendorItem(),
      status: 'ACTIVE',
    });

    await service.updatevendorstatus(
      authRequest({
        context: {
          userContext: { userId: 'admin-1', roles: ['admin'] },
        },
        body: { status: 'SUSPENDED' },
      }),
    );

    const saved = repository.transactVendorProfile.mock.calls[0][0].profile;
    expect(saved.status).toBe('SUSPENDED');
    expect(saved.emailVerificationOtp).toBeUndefined();
  });

  it('omits bank details from the standard vendor response', async () => {
    const result = await service.getvendor(authRequest());
    expect(result).not.toHaveProperty('accountNumber');
    expect(result).not.toHaveProperty('bankDetails');
  });

  it('rejects listing vendors when the caller is unauthenticated', async () => {
    await expect(
      service.listvendors(authRequest({ context: { userContext: {} } })),
    ).rejects.toThrow(UnauthorizedError);
    expect(repository.listVendors).not.toHaveBeenCalled();
  });

  it('requires admin access to list vendors when a JWT is present', async () => {
    await expect(service.listvendors(authRequest())).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('rejects creation when the context only has a Cognito identity id', async () => {
    await expect(
      service.createvendor(
        authRequest({
          context: {
            userContext: {
              userId: 'cognito-sub-1',
              identityId: 'cognito-sub-1',
            },
          },
          body: createBody,
        }),
      ),
    ).rejects.toThrow('Authenticated user id is required');
    expect(repository.createVendor).not.toHaveBeenCalled();
  });

  it('forbids a caller from reading another user vendor', async () => {
    await expect(
      service.getvendor(
        authRequest({
          context: { userContext: { userId: 'other-user' } },
        }),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  describe('getMyVendor', () => {
    function owned(overrides: Partial<VendorDdbItem> = {}) {
      const item = { ...vendorItem(), ...overrides };
      repository.listOwnersByUserId.mockResolvedValue([
        {
          PK: 'VENDOR#vendor-1',
          SK: 'OWNER',
          vendorId: item.vendorId,
          userId: 'user-1',
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          GSI1PK: 'OWNER#user-1',
          GSI1SK: `VENDOR#${item.vendorId}`,
          entityType: 'VendorOwner',
        },
      ]);
      repository.getVendorsByIds.mockResolvedValue([item]);
      return item;
    }

    it('resolves an active staff member by user id without treating them as the owner', async () => {
      repository.getVendorById.mockResolvedValue({ ...vendorItem(), status: 'ACTIVE', onboardingStatus: 'PENDING_REVIEW' });
      staffRepository.listMembershipsByUserId.mockResolvedValue([{
        PK: 'STAFF_USER#user-1',
        SK: 'VENDOR#vendor-1',
        userId: 'user-1',
        vendorId: 'vendor-1',
        staffId: 'staff-1',
        status: 'ACTIVE',
        entityType: 'StaffMembership',
      }]);
      const result = await service.getMyVendor(authRequest());
      expect(result).toMatchObject({
        hasVendor: true,
        vendorId: 'vendor-1',
        membership: { role: 'staff', staffId: 'staff-1', permissions: ['visits:view'] },
        nextAction: 'OPEN_VENDOR_DASHBOARD',
      });
      expect(result.membership?.permissions).not.toContain('visits:publish');
      expect(result.membership?.permissions).not.toContain('staff:manage');
      expect(result.membership?.permissions).not.toContain('crew:manage');
    });

    it('returns start onboarding when the user has no vendor', async () => {
      const result = await service.getMyVendor(authRequest());
      expect(result).toEqual({
        hasVendor: false,
        nextAction: 'START_ONBOARDING',
      });
      expect(result).not.toHaveProperty('membership');
      expect(repository.listOwnersByUserId).toHaveBeenCalledWith('user-1');
    });

    it('rejects an unauthenticated membership lookup', async () => {
      await expect(
        service.getMyVendor(
          authRequest({
            context: { userContext: {} },
          }),
        ),
      ).rejects.toThrow(UnauthorizedError);
      expect(repository.listOwnersByUserId).not.toHaveBeenCalled();
    });

    it('returns a draft vendor for resume', async () => {
      owned();
      const result = await service.getMyVendor(authRequest());
      expect(result).toMatchObject({
        hasVendor: true,
        vendorId: 'vendor-1',
        status: 'DRAFT',
        onboarding: { currentStep: 'BUSINESS_INFO', completed: false },
        nextAction: 'RESUME_ONBOARDING',
        membership: { role: 'owner' },
      });
    });

    it('returns an application that is under review', async () => {
      owned({ onboardingStatus: 'PENDING_REVIEW', currentSection: 'BANK_DETAILS' });
      const result = await service.getMyVendor(authRequest());
      expect(result.nextAction).toBe('VIEW_APPLICATION_STATUS');
      expect(result.status).toBe('PENDING_REVIEW');
      expect(result.onboarding?.completed).toBe(true);
    });

    it('returns the dashboard action for an approved operational vendor', async () => {
      owned({
        status: 'ACTIVE',
        onboardingStatus: 'PENDING_REVIEW',
        revision: 1,
        detailsAcceptedRevision: 1,
        detailsAcceptedAt: '2026-01-01T00:00:00.000Z',
      });
      const result = await service.getMyVendor(authRequest());
      expect(result.status).toBe('ACTIVE');
      expect(result.nextAction).toBe('OPEN_VENDOR_DASHBOARD');
      expect(result.detailsAcceptance).toMatchObject({
        accepted: true,
        acceptedRevision: 1,
        profileRevision: 1,
      });
      expect(result.membership).toMatchObject({
        role: 'owner',
        permissions: expect.arrayContaining(['staff:view', 'staff:manage', 'crew:view', 'crew:manage']),
      });
    });

    it('asks an approved owner to accept support-prepared details before the dashboard', async () => {
      owned({ status: 'ACTIVE', onboardingStatus: 'PENDING_REVIEW', revision: 3 });
      const result = await service.getMyVendor(authRequest());
      expect(result.nextAction).toBe('ACCEPT_VENDOR_DETAILS');
      expect(result.detailsAcceptance).toMatchObject({
        accepted: false,
        profileRevision: 3,
      });
    });

    it('returns setup when an approved vendor is not operationally eligible', async () => {
      owned({ status: 'ACTIVE', onboardingStatus: 'IN_PROGRESS' });
      const result = await service.getMyVendor(authRequest());
      expect(result.nextAction).toBe('COMPLETE_VENDOR_SETUP');
    });

    it('returns a correction action for a rejected vendor', async () => {
      owned({ status: 'REJECTED', onboardingStatus: 'PENDING_REVIEW' });
      const result = await service.getMyVendor(authRequest());
      expect(result.status).toBe('REJECTED');
      expect(result.nextAction).toBe('CORRECT_APPLICATION');
    });

    it('returns an account-status action for a suspended vendor', async () => {
      owned({ status: 'SUSPENDED', onboardingStatus: 'COMPLETED' });
      const result = await service.getMyVendor(authRequest());
      expect(result.status).toBe('SUSPENDED');
      expect(result.nextAction).toBe('VIEW_ACCOUNT_STATUS');
    });

    it('does not return a vendor indexed to this user when the profile owner differs', async () => {
      owned({ ownerUserId: 'someone-else' });
      const result = await service.getMyVendor(authRequest());
      expect(result).toEqual({
        hasVendor: false,
        nextAction: 'START_ONBOARDING',
      });
    });
  });

  describe('resolveOperationalAccess', () => {
    it('returns the owned vendor and does not accept a caller-supplied vendor id', async () => {
      repository.listOwnersByUserId.mockResolvedValue([{
        PK: 'VENDOR#vendor-1',
        SK: 'OWNER',
        vendorId: 'vendor-1',
        userId: 'user-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        GSI1PK: 'OWNER#user-1',
        GSI1SK: 'VENDOR#vendor-1',
        entityType: 'VendorOwner',
      }]);
      repository.getVendorsByIds.mockResolvedValue([{ ...vendorItem(), status: 'ACTIVE' }]);
      await expect(service.resolveOperationalAccess('user-1')).resolves.toEqual({
        role: 'owner',
        vendorId: 'vendor-1',
        active: true,
      });
    });

    it('identifies active staff without owner access', async () => {
      repository.getVendorById.mockResolvedValue({ ...vendorItem(), status: 'ACTIVE' });
      staffRepository.listMembershipsByUserId.mockResolvedValue([{
        PK: 'STAFF_USER#user-1',
        SK: 'VENDOR#vendor-1',
        userId: 'user-1',
        vendorId: 'vendor-1',
        staffId: 'staff-1',
        status: 'ACTIVE',
        entityType: 'StaffMembership',
      }]);
      await expect(service.resolveOperationalAccess('user-1')).resolves.toMatchObject({
        role: 'staff',
        vendorId: 'vendor-1',
        staffId: 'staff-1',
        active: true,
      });
    });
  });
});
