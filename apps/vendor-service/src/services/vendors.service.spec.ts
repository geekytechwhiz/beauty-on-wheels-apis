import { LambdaRequest } from '@api-hub/utils';
import { ConflictError, ForbiddenError, UnauthorizedError } from '@api-hub/utils';

import { VendorsService } from './vendors.service';
import { VendorsRepository } from '../repositories/vendors.repository';
import { CommunitiesRepository } from '../repositories/communities.repository';
import { validateCreateVendorRequest } from '../schemas/vendors.schema';
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

function vendorItem(): VendorDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'PROFILE',
    vendorId: 'vendor-1',
    ownerUserId: 'user-1',
    vendorType: 'BUSINESS',
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
  let service: VendorsService;

  beforeEach(() => {
    repository = {
      getVendorById: jest.fn().mockResolvedValue(vendorItem()),
      getVendorIdByOwnerUserId: jest.fn().mockResolvedValue(null),
      createVendor: jest.fn().mockResolvedValue(undefined),
      getAddress: jest.fn().mockResolvedValue(null),
      updateVendor: jest.fn().mockResolvedValue(undefined),
      transactVendorProfile: jest.fn().mockResolvedValue(undefined),
      listVendors: jest.fn(),
      listStatusHistory: jest.fn().mockResolvedValue([]),
      getVendorsByIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<VendorsRepository>;

    communitiesRepository = {
      listByVendor: jest.fn().mockResolvedValue([]),
      listByCommunity: jest.fn(),
    } as unknown as jest.Mocked<CommunitiesRepository>;

    service = new VendorsService(repository, communitiesRepository);
  });

  const createBody = {
    businessName: 'Glow Mobile Salon',
    contactName: 'Priya Sharma',
    phoneNumber: '+919876543210',
    email: 'priya@glowsalon.example',
    description: 'Premium mobile beauty and grooming services',
    gstNumber: '29ABCDE1234F1Z5',
    panNumber: 'ABCDE1234F',
    profileImageUrl: 'https://cdn.example.com/vendors/glow.jpg',
  };

  it('creates a vendor with a unique vendorId and persisted business info', async () => {
    const result = await service.createvendor(
      authRequest({ body: createBody }),
    );

    expect(result.ownerUserId).toBe('user-1');
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
    const [profile, owner] = repository.createVendor.mock.calls[0];
    expect(profile.SK).toBe('PROFILE');
    expect(profile.vendorId).toBe(result.vendorId);
    expect(owner.SK).toBe('OWNER');
    expect(owner.userId).toBe('user-1');
    expect(owner.GSI1PK).toBe('OWNER#user-1');
  });

  it('mints a unique vendorId on every POST for the same owner', async () => {
    const first = await service.createvendor(authRequest({ body: createBody }));
    const second = await service.createvendor(authRequest({ body: createBody }));

    expect(first.vendorId).not.toBe(second.vendorId);
    expect(repository.createVendor).toHaveBeenCalledTimes(2);
    expect(repository.getVendorIdByOwnerUserId).not.toHaveBeenCalled();
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

  it('persists onboarding business fields and stays DRAFT when phone is blank', async () => {
    const result = await service.createvendor(
      authRequest({
        body: {
          businessName: 'vendor@youpmail.com',
          contactName: 'vendor@youpmail.com',
          phoneNumber: '',
          email: '',
          description: 'KL-401-0104',
          gstNumber: 'prasanth@gmail.com',
          panNumber: 'KL-401-0104',
          profileImageUrl: 'prasanth@gmail.com',
        },
      }),
    );

    expect(result.vendorId).toBeTruthy();
    expect(result.businessName).toBe('vendor@youpmail.com');
    expect(result.description).toBe('KL-401-0104');
    expect(result.gstNumber).toBe('prasanth@gmail.com');
    expect(result.panNumber).toBe('KL-401-0104');
    expect(result.profileImageUrl).toBe('prasanth@gmail.com');
    expect(result.onboardingStatus).toBe('DRAFT');
    expect(result.currentSection).toBe('BUSINESS_INFO');
  });

  it('accepts blank optional fields on the create vendor request body', () => {
    const parsed = validateCreateVendorRequest(
      authRequest({
        body: {
          businessName: 'vendor@youpmail.com',
          contactName: 'vendor@youpmail.com',
          phoneNumber: '',
          email: '',
          description: 'KL-401-0104',
          gstNumber: 'prasanth@gmail.com',
          panNumber: 'KL-401-0104',
          profileImageUrl: 'prasanth@gmail.com',
        },
      }),
    );

    expect(parsed.businessName).toBe('vendor@youpmail.com');
    expect(parsed.phoneNumber).toBeUndefined();
    expect(parsed.email).toBeUndefined();
    expect(parsed.gstNumber).toBe('prasanth@gmail.com');
    expect(parsed.profileImageUrl).toBe('prasanth@gmail.com');
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
});
