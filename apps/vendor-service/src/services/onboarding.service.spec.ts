import { LambdaRequest } from '@api-hub/utils';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '@api-hub/utils';

import { OnboardingService } from './onboarding.service';
import { VendorsRepository } from '../repositories/vendors.repository';
import { BranchesRepository } from '../repositories/branches.repository';
import { DocumentsRepository } from '../repositories/documents.repository';
import { DocumentStorage } from '../storage/document-storage';
import {
  VendorAddressDdbItem,
  VendorDdbItem,
  VendorOwnerDdbItem,
} from '../types/repository.types';

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

function vendorItem(overrides: Partial<VendorDdbItem> = {}): VendorDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'PROFILE',
    vendorId: 'vendor-1',
    ownerUserId: 'user-1',
    vendorType: 'BUSINESS',
    status: 'PENDING_VERIFICATION',
    operationalStatus: 'OFFLINE',
    onboardingStatus: 'DRAFT',
    currentSection: 'BUSINESS_INFO',
    completedSections: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    GSI1PK: 'VENDOR',
    GSI1SK: 'STATUS#PENDING_VERIFICATION#OPERATIONAL#OFFLINE#2026-01-01T00:00:00.000Z#vendor-1',
    entityType: 'Vendor',
    ...overrides,
  };
}

function ownerItem(): VendorOwnerDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'OWNER',
    vendorId: 'vendor-1',
    userId: 'user-1',
    fullName: 'Priya Sharma',
    email: 'priya@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    GSI1PK: 'OWNER#user-1',
    GSI1SK: 'VENDOR#vendor-1',
    entityType: 'VendorOwner',
  };
}

function addressItem(): VendorAddressDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'ADDRESS',
    vendorId: 'vendor-1',
    addressLine1: '1 Main',
    city: 'Bengaluru',
    state: 'KA',
    country: 'IN',
    postalCode: '560001',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entityType: 'VendorAddress',
  };
}

describe('OnboardingService', () => {
  let vendorsRepository: jest.Mocked<VendorsRepository>;
  let branchesRepository: jest.Mocked<BranchesRepository>;
  let documentsRepository: jest.Mocked<DocumentsRepository>;
  let documentStorage: jest.Mocked<DocumentStorage>;
  let service: OnboardingService;

  beforeEach(() => {
    vendorsRepository = {
      getVendorById: jest.fn().mockResolvedValue(vendorItem()),
      queryVendorItems: jest.fn().mockResolvedValue([vendorItem(), ownerItem()]),
      putSection: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VendorsRepository>;

    branchesRepository = {
      getBranch: jest.fn(),
      listBranches: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<BranchesRepository>;

    documentsRepository = {
      findByDocumentType: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<DocumentsRepository>;

    documentStorage = {
      createObjectKey: jest.fn().mockReturnValue('vendors/vendor-1/documents/doc-1/gst.pdf'),
      createUploadUrl: jest.fn().mockResolvedValue({
        bucket: 'docs',
        objectKey: 'vendors/vendor-1/documents/doc-1/gst.pdf',
        uploadUrl: 'https://s3.example/upload',
      }),
      createDownloadUrl: jest.fn(),
    };

    service = new OnboardingService(
      vendorsRepository,
      branchesRepository,
      documentsRepository,
      documentStorage,
    );
  });

  it('rejects onboarding reads when the caller is unauthenticated', async () => {
    await expect(
      service.getvendoronboarding(
        authRequest({ context: { userContext: {} } }),
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('returns 404 when the vendor does not exist', async () => {
    vendorsRepository.getVendorById.mockResolvedValue(null);

    await expect(service.getvendoronboarding(authRequest())).rejects.toThrow(
      NotFoundError,
    );
  });

  it('forbids access when the caller does not own the vendor', async () => {
    vendorsRepository.getVendorById.mockResolvedValue(
      vendorItem({ ownerUserId: 'other-user' }),
    );

    await expect(service.getvendoronboarding(authRequest())).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('returns backend-authoritative onboarding progress', async () => {
    vendorsRepository.queryVendorItems.mockResolvedValue([vendorItem()]);

    const result = await service.getvendoronboarding(authRequest());

    expect(result.vendorId).toBe('vendor-1');
    expect(result.status).toBe('DRAFT');
    expect(result.currentSection).toBe('BUSINESS_INFO');
    expect(result.completedSections).toEqual([]);
  });

  it('saves OWNER_DETAILS when the owner userId matches the caller', async () => {
    const result = await service.updatevendoronboarding(
      authRequest({
        body: {
          section: 'OWNER_DETAILS',
          data: {
            userId: 'user-1',
            fullName: 'Priya Sharma',
            designation: 'Founder',
            email: 'priya@example.com',
            phoneNumber: '+919037243199',
          },
        },
      }),
    );

    const sectionItem = vendorsRepository.putSection.mock.calls[0][1] as {
      SK: string;
      userId: string;
      fullName: string;
    };
    expect(sectionItem.SK).toBe('OWNER');
    expect(sectionItem.userId).toBe('user-1');
    expect(sectionItem.fullName).toBe('Priya Sharma');
    expect(result.completedSections).toContain('OWNER_DETAILS');
  });

  it('still forbids OWNER_DETAILS updates from a caller who does not own the vendor', async () => {
    vendorsRepository.getVendorById.mockResolvedValue(
      vendorItem({ ownerUserId: 'other-user' }),
    );

    await expect(
      service.updatevendoronboarding(
        authRequest({
          body: {
            section: 'OWNER_DETAILS',
            data: {
              userId: 'user_1788582970668',
              fullName: 'Priya Sharma',
            },
          },
        }),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('saves OWNER_DETAILS for a different userId when the caller already has vendor access', async () => {
    const result = await service.updatevendoronboarding(
      authRequest({
        body: {
          section: 'OWNER_DETAILS',
          data: {
            userId: 'user_1788582970668',
            fullName: 'Priya Sharma',
            designation: 'Founder',
            email: 'prasanth4@yopmail.com',
            phoneNumber: '+919037243199',
          },
        },
      }),
    );

    const sectionItem = vendorsRepository.putSection.mock.calls[0][1] as {
      userId: string;
    };
    expect(sectionItem.userId).toBe('user_1788582970668');
    expect(result.sections.OWNER_DETAILS?.userId).toBe('user_1788582970668');
  });

  it('allows an admin caller to set OWNER_DETAILS for a different userId', async () => {
    vendorsRepository.getVendorById.mockResolvedValue(
      vendorItem({ ownerUserId: 'other-owner' }),
    );
    vendorsRepository.queryVendorItems.mockResolvedValue([
      vendorItem({ ownerUserId: 'other-owner' }),
    ]);

    const result = await service.updatevendoronboarding(
      authRequest({
        context: {
          userContext: { userId: 'admin-1', roles: ['ADMIN'] },
        },
        body: {
          section: 'OWNER_DETAILS',
          data: {
            userId: 'user_1788582970668',
            fullName: 'Priya Sharma',
            designation: 'Founder',
          },
        },
      }),
    );

    const sectionItem = vendorsRepository.putSection.mock.calls[0][1] as {
      userId: string;
    };
    expect(sectionItem.userId).toBe('user_1788582970668');
    expect(result.sections.OWNER_DETAILS?.userId).toBe('user_1788582970668');
  });

  it('updates BUSINESS_INFO in place and marks the section complete', async () => {
    const result = await service.updatevendoronboarding(
      authRequest({
        body: {
          section: 'BUSINESS_INFO',
          data: {
            vendorType: 'BUSINESS',
            businessName: 'ABC Car Wash',
            contactName: 'Priya',
            phoneNumber: '+919876543210',
          },
        },
      }),
    );

    expect(vendorsRepository.putSection).toHaveBeenCalledTimes(1);
    const savedProfile = vendorsRepository.putSection.mock.calls[0][0];
    expect(savedProfile.SK).toBe('PROFILE');
    expect(savedProfile.businessName).toBe('ABC Car Wash');
    expect(result.completedSections).toContain('BUSINESS_INFO');
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('upserts ADDRESS on the deterministic ADDRESS sort key', async () => {
    vendorsRepository.queryVendorItems.mockResolvedValue([
      vendorItem({
        businessName: 'ABC Car Wash',
        contactName: 'Priya',
        phoneNumber: '+919876543210',
        vendorType: 'BUSINESS',
      }),
      ownerItem(),
      addressItem(),
    ]);

    await service.updatevendoronboarding(
      authRequest({
        body: {
          section: 'ADDRESS',
          data: {
            addressLine1: '22 Residency',
            city: 'Kochi',
            state: 'KL',
            country: 'IN',
            postalCode: '682001',
          },
        },
      }),
    );

    const sectionItem = vendorsRepository.putSection.mock.calls[0][1] as {
      SK: string;
      city: string;
    };
    expect(sectionItem.SK).toBe('ADDRESS');
    expect(sectionItem.city).toBe('Kochi');
  });

  it('does not create a second branch when BRANCH is saved again without branchId', async () => {
    const existingBranch = {
      PK: 'VENDOR#vendor-1',
      SK: 'BRANCH#branch-1',
      branchId: 'branch-1',
      vendorId: 'vendor-1',
      name: 'Main',
      isPrimary: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      entityType: 'VendorBranch' as const,
    };
    vendorsRepository.getVendorById.mockResolvedValue(
      vendorItem({ primaryBranchId: 'branch-1' }),
    );
    vendorsRepository.queryVendorItems.mockResolvedValue([
      vendorItem({ primaryBranchId: 'branch-1' }),
      existingBranch,
    ]);
    branchesRepository.getBranch.mockResolvedValue(existingBranch);

    await service.updatevendoronboarding(
      authRequest({
        body: {
          section: 'BRANCH',
          data: { name: 'Updated Main' },
        },
      }),
    );

    const sectionItem = vendorsRepository.putSection.mock.calls[0][1] as {
      SK: string;
      branchId: string;
      name: string;
    };
    expect(sectionItem.SK).toBe('BRANCH#branch-1');
    expect(sectionItem.branchId).toBe('branch-1');
    expect(sectionItem.name).toBe('Updated Main');
  });

  it('upserts DOCUMENTS by type instead of creating duplicates', async () => {
    const existingDocument = {
      PK: 'VENDOR#vendor-1',
      SK: 'DOCUMENT#doc-1',
      documentId: 'doc-1',
      vendorId: 'vendor-1',
      documentType: 'GST_REGISTRATION' as const,
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      bucket: 'docs',
      objectKey: 'old',
      status: 'PENDING_UPLOAD' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      entityType: 'VendorDocument' as const,
    };
    vendorsRepository.queryVendorItems.mockResolvedValue([
      vendorItem(),
      existingDocument,
    ]);

    const result = await service.updatevendoronboarding(
      authRequest({
        body: {
          section: 'DOCUMENTS',
          data: {
            documentType: 'GST_REGISTRATION',
            fileName: 'gst.pdf',
            contentType: 'application/pdf',
          },
        },
      }),
    );

    const sectionItem = vendorsRepository.putSection.mock.calls[0][1] as {
      documentId: string;
      fileName: string;
    };
    expect(sectionItem.documentId).toBe('doc-1');
    expect(sectionItem.fileName).toBe('gst.pdf');
    expect(result.sections.DOCUMENTS?.[0].uploadUrl).toBe(
      'https://s3.example/upload',
    );
  });

  it('masks bank account numbers in onboarding responses', async () => {
    vendorsRepository.queryVendorItems.mockResolvedValue([
      vendorItem(),
      {
        PK: 'VENDOR#vendor-1',
        SK: 'BANK',
        vendorId: 'vendor-1',
        accountHolderName: 'Priya',
        accountNumber: '123456789012',
        ifscCode: 'HDFC0001234',
        bankName: 'HDFC',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        entityType: 'VendorBank' as const,
      },
    ]);

    const result = await service.getvendoronboarding(authRequest());

    expect(result.sections.BANK_DETAILS?.accountNumberLast4).toBe('9012');
    expect(result.sections.BANK_DETAILS).not.toHaveProperty('accountNumber');
  });

  it('persists PENDING_REVIEW and applicationId when the last required section is saved', async () => {
    vendorsRepository.getVendorById.mockResolvedValue(
      vendorItem({
        vendorType: 'BUSINESS',
        businessName: 'ABC Car Wash',
        contactName: 'Priya',
        phoneNumber: '+919876543210',
        email: 'priya@example.com',
      }),
    );
    vendorsRepository.queryVendorItems.mockResolvedValue([
      vendorItem({
        vendorType: 'BUSINESS',
        businessName: 'ABC Car Wash',
        contactName: 'Priya',
        phoneNumber: '+919876543210',
        email: 'priya@example.com',
      }),
      ownerItem(),
      addressItem(),
      {
        PK: 'VENDOR#vendor-1',
        SK: 'BRANCH#branch-1',
        branchId: 'branch-1',
        vendorId: 'vendor-1',
        name: 'Main',
        isPrimary: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        entityType: 'VendorBranch',
      },
      {
        PK: 'VENDOR#vendor-1',
        SK: 'DOCUMENT#gst',
        documentId: 'gst',
        vendorId: 'vendor-1',
        documentType: 'GST_REGISTRATION',
        fileName: 'gst.pdf',
        contentType: 'application/pdf',
        bucket: 'docs',
        objectKey: 'gst',
        status: 'UPLOADED',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        entityType: 'VendorDocument',
      },
      {
        PK: 'VENDOR#vendor-1',
        SK: 'DOCUMENT#biz',
        documentId: 'biz',
        vendorId: 'vendor-1',
        documentType: 'BUSINESS_REGISTRATION',
        fileName: 'biz.pdf',
        contentType: 'application/pdf',
        bucket: 'docs',
        objectKey: 'biz',
        status: 'UPLOADED',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        entityType: 'VendorDocument',
      },
      {
        PK: 'VENDOR#vendor-1',
        SK: 'DOCUMENT#ins',
        documentId: 'ins',
        vendorId: 'vendor-1',
        documentType: 'COMMERCIAL_INSURANCE',
        fileName: 'ins.pdf',
        contentType: 'application/pdf',
        bucket: 'docs',
        objectKey: 'ins',
        status: 'UPLOADED',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        entityType: 'VendorDocument',
      },
    ]);

    const result = await service.updatevendoronboarding(
      authRequest({
        context: {
          userContext: { userId: 'user-1' },
          correlationId: 'corr-onboarding-1',
        },
        body: {
          section: 'BANK_DETAILS',
          data: {
            accountHolderName: 'Priya',
            accountNumber: '123456789012',
            ifscCode: 'HDFC0001234',
            bankName: 'HDFC',
          },
        },
      }),
    );

    const savedProfile = vendorsRepository.putSection.mock.calls[0][0];
    expect(result.status).toBe('PENDING_REVIEW');
    expect(result.applicationId).toEqual(expect.any(String));
    expect(savedProfile.onboardingStatus).toBe('PENDING_REVIEW');
    expect(savedProfile.applicationId).toBe(result.applicationId);
    expect(savedProfile.email).toBe('priya@example.com');
  });
});
