import { LambdaRequest } from '@api-hub/utils';

import { BankDetailsService } from './bank-details.service';
import { VendorsRepository } from '../repositories/vendors.repository';
import { VendorBankDdbItem, VendorDdbItem } from '../types/repository.types';

function authRequest(body?: unknown): LambdaRequest {
  return {
    pathParameters: { vendorId: 'vendor-1' },
    params: { vendorId: 'vendor-1' },
    body,
    context: { userContext: { userId: 'user-1' } },
  } as unknown as LambdaRequest;
}

function vendorItem(overrides: Partial<VendorDdbItem> = {}): VendorDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'PROFILE',
    vendorId: 'vendor-1',
    ownerUserId: 'user-1',
    businessType: 'BUSINESS',
    businessName: 'Glow',
    contactName: 'Priya',
    phoneNumber: '+919876543210',
    status: 'PENDING_VERIFICATION',
    operationalStatus: 'OFFLINE',
    onboardingStatus: 'IN_PROGRESS',
    currentSection: 'BANK_DETAILS',
    completedSections: ['BUSINESS_INFO'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    GSI1PK: 'VENDOR',
    GSI1SK: 'STATUS#PENDING_VERIFICATION#OPERATIONAL#OFFLINE#2026-01-01T00:00:00.000Z#vendor-1',
    entityType: 'Vendor',
    ...overrides,
  };
}

const bankBody = {
  accountHolderName: 'Priya Sharma',
  accountNumber: '123456789012',
  ifscCode: 'HDFC0001234',
  bankName: 'HDFC Bank',
  accountType: 'CURRENT' as const,
};

describe('BankDetailsService', () => {
  let repository: jest.Mocked<VendorsRepository>;
  let service: BankDetailsService;

  beforeEach(() => {
    repository = {
      getVendorById: jest.fn().mockResolvedValue(vendorItem()),
      getBank: jest.fn().mockResolvedValue(null),
      queryVendorItems: jest.fn().mockResolvedValue([vendorItem()]),
      transactVendorProfile: jest.fn().mockResolvedValue(undefined),
      replaceVendorChild: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VendorsRepository>;
    service = new BankDetailsService(repository);
  });

  it('stores one bank item and returns a masked account', async () => {
    const result = await service.updatevendorbankdetails(authRequest(bankBody));

    expect(result).not.toHaveProperty('accountNumber');
    expect(result.accountNumberLast4).toBe('9012');
    expect(result.accountNumberMasked).toBe('XXXXXXXX9012');
    const write = repository.transactVendorProfile.mock.calls[0][0];
    expect(write.profile.vendorId).toBe('vendor-1');
    expect(write.puts?.[0].item).toEqual(
      expect.objectContaining({
        SK: 'BANK',
        entityType: 'VendorBank',
        accountNumber: '123456789012',
      }),
    );
    expect(repository.replaceVendorChild).not.toHaveBeenCalled();
  });

  it('does not write again when the same bank details are retried', async () => {
    const existing: VendorBankDdbItem = {
      PK: 'VENDOR#vendor-1',
      SK: 'BANK',
      vendorId: 'vendor-1',
      ...bankBody,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      entityType: 'VendorBank',
    };
    repository.getBank.mockResolvedValue(existing);

    const result = await service.updatevendorbankdetails(authRequest(bankBody));

    expect(result.accountNumberMasked).toBe('XXXXXXXX9012');
    expect(result).not.toHaveProperty('accountNumber');
    expect(repository.transactVendorProfile).not.toHaveBeenCalled();
    expect(repository.replaceVendorChild).not.toHaveBeenCalled();
  });

  it('does not reset onboarding status when the application is already submitted', async () => {
    repository.getVendorById.mockResolvedValue(
      vendorItem({ onboardingStatus: 'PENDING_REVIEW' }),
    );

    await service.updatevendorbankdetails(authRequest(bankBody));

    expect(repository.transactVendorProfile).not.toHaveBeenCalled();
    const item = repository.replaceVendorChild.mock.calls[0][1];
    expect(item).toEqual(expect.objectContaining({ SK: 'BANK', entityType: 'VendorBank' }));
  });
});
