import { createHash } from 'crypto';
import { LambdaRequest, ValidationError } from '@api-hub/utils';
import { EmailVerificationService } from './email-verification.service';
import { VendorsRepository } from '../repositories/vendors.repository';
import { VendorDdbItem } from '../types/repository.types';

const token = 'vendor-1.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_12';
function profile(overrides: Partial<VendorDdbItem> = {}): VendorDdbItem {
  return {
    PK: 'VENDOR#vendor-1', SK: 'PROFILE', vendorId: 'vendor-1', ownerUserId: 'user-1',
    email: 'owner@example.com', contactName: 'Priya Sharma', status: 'PENDING_VERIFICATION',
    operationalStatus: 'OFFLINE', onboardingStatus: 'IN_PROGRESS', currentSection: 'BANK_DETAILS',
    completedSections: ['BUSINESS_INFO', 'OWNER_DETAILS', 'ADDRESS', 'BRANCH', 'BANK_DETAILS'],
    emailVerificationRequestId: 'request-1', emailVerificationOtp: token,
    emailVerificationTokenHash: createHash('sha256').update(token).digest('hex'),
    emailVerificationEmail: 'owner@example.com', emailVerificationRequestedAt: '2026-01-01T00:00:00.000Z',
    emailVerificationExpiresAt: '2026-01-02T00:00:00.000Z', emailVerificationExpiryMinutes: 1440,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    GSI1PK: 'VENDOR', GSI1SK: 'STATUS#PENDING_VERIFICATION', entityType: 'Vendor', ...overrides,
  };
}

describe('EmailVerificationService', () => {
  let repository: jest.Mocked<VendorsRepository>;
  beforeEach(() => {
    repository = {
      getVendorById: jest.fn().mockResolvedValue(profile()),
      transactVendorProfile: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VendorsRepository>;
  });

  it('consumes a valid token once and transitions to PENDING_REVIEW', async () => {
    const service = new EmailVerificationService(repository, jest.fn(), () => new Date('2026-01-01T12:00:00.000Z'));
    await expect(service.verify({ body: { token } } as LambdaRequest)).resolves.toEqual({
      vendorId: 'vendor-1', emailVerified: true, onboardingStatus: 'PENDING_REVIEW',
    });
    expect(repository.transactVendorProfile).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({ emailVerifiedAt: '2026-01-01T12:00:00.000Z', emailVerificationConsumedAt: '2026-01-01T12:00:00.000Z', onboardingStatus: 'PENDING_REVIEW' }),
    }));
  });

  it('rejects expired or incomplete requests', async () => {
    repository.getVendorById.mockResolvedValue(profile({ emailVerificationExpiresAt: '2025-12-31T00:00:00.000Z' }));
    const service = new EmailVerificationService(repository, jest.fn(), () => new Date('2026-01-01T12:00:00.000Z'));
    await expect(service.verify({ body: { token } } as LambdaRequest)).rejects.toThrow(ValidationError);
    expect(repository.transactVendorProfile).not.toHaveBeenCalled();
  });

  it('reuses a pending resend request after publication failure', async () => {
    const publish = jest.fn().mockRejectedValue(new Error('EventBridge unavailable'));
    const pending = profile({ emailVerificationDispatchPending: true });
    repository.getVendorById.mockResolvedValue(pending);
    const service = new EmailVerificationService(repository, publish, () => new Date('2026-01-01T12:00:00.000Z'));
    const request = { pathParameters: { vendorId: 'vendor-1' }, params: { vendorId: 'vendor-1' }, context: { userContext: { userId: 'user-1' } } } as unknown as LambdaRequest;
    await expect(service.resend(request)).rejects.toThrow('EventBridge unavailable');
    expect(repository.transactVendorProfile).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ verificationRequestId: 'request-1' }), expect.any(String));
  });
});
