jest.mock('../integrations/vendor-self', () => ({
  resolveCallerVendor: jest.fn(),
}));

import { ConflictError, ForbiddenError, LambdaRequest, NotFoundError } from '@api-hub/utils';

import { ADDON_SUGGESTION_STATUS } from '../domain/addon-suggestion';
import { resolveCallerVendor } from '../integrations/vendor-self';
import { AddonSuggestionsService } from './addon-suggestions.service';

const resolveCaller = resolveCallerVendor as jest.MockedFunction<typeof resolveCallerVendor>;

const submitBody = {
  vendorId: 'vend-1',
  categoryId: 'cat-1',
  serviceId: 'svc-1',
  name: 'Clay bar',
  durationMinutes: 30,
  proposedCustomerPriceMinor: 49900,
  packageCompatibilityNotes: 'Fits premium wash packages',
};

function vendorRequest(body: unknown, headers: Record<string, string> = {}): LambdaRequest {
  return {
    body,
    params: { vendorId: 'vend-1' },
    event: {
      headers: {
        Authorization: 'Bearer token',
        'Idempotency-Key': 'idem-1',
        ...headers,
      },
    },
    context: { userContext: { userId: 'user-1' } },
  } as unknown as LambdaRequest;
}

function adminRequest(body: unknown): LambdaRequest {
  return {
    body,
    params: { suggestionId: 'sug-1' },
    event: {
      headers: {
        Authorization: 'Bearer admin',
        'Idempotency-Key': 'review-1',
      },
    },
    context: {
      userContext: {
        userId: 'admin-1',
        roles: ['catalog_admin'],
      },
    },
  } as unknown as LambdaRequest;
}

describe('AddonSuggestionsService', () => {
  const repository = {
    getCreateIdempotency: jest.fn(),
    createSuggestion: jest.fn(),
    listByVendor: jest.fn(),
    getByVendor: jest.fn(),
    getBySuggestionId: jest.fn(),
    getReviewIdempotency: jest.fn(),
    updateSuggestion: jest.fn(),
    listByStatus: jest.fn(),
  };
  const categories = { findById: jest.fn() };
  const services = { findById: jest.fn() };

  const service = new AddonSuggestionsService(
    repository as never,
    categories as never,
    services as never,
    () => new Date('2026-03-01T12:00:00.000Z'),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    resolveCaller.mockResolvedValue({ vendorId: 'vend-1', role: 'owner' });
    categories.findById.mockResolvedValue({ categoryId: 'cat-1', active: true });
    services.findById.mockResolvedValue({ serviceId: 'svc-1', vendorId: 'vend-1', active: true });
    repository.getCreateIdempotency.mockResolvedValue(null);
    repository.createSuggestion.mockResolvedValue(undefined);
  });

  it('creates a pendingReview suggestion for the vendor manager', async () => {
    const created = await service.submit(vendorRequest(submitBody));

    expect(created.status).toBe(ADDON_SUGGESTION_STATUS.PENDING_REVIEW);
    expect(created.proposedCustomerPriceMinor).toBe(49900);
    expect(repository.createSuggestion).toHaveBeenCalled();
  });

  it('rejects staff callers', async () => {
    resolveCaller.mockResolvedValue({ vendorId: 'vend-1', role: 'staff' });

    await expect(service.submit(vendorRequest(submitBody))).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.createSuggestion).not.toHaveBeenCalled();
  });

  it('approves without creating a catalog add-on row', async () => {
    repository.getReviewIdempotency.mockResolvedValue(null);
    repository.getBySuggestionId.mockResolvedValue({
      PK: 'VENDOR#vend-1',
      SK: 'ADDON_SUGGESTION#sug-1',
      GSI1PK: 'ADDON_SUGGESTION',
      GSI1SK: 'STATUS#pendingReview#2026-03-01T12:00:00.000Z#sug-1',
      entityType: 'AddonSuggestion',
      suggestionId: 'sug-1',
      vendorId: 'vend-1',
      categoryId: 'cat-1',
      serviceId: 'svc-1',
      name: 'Clay bar',
      durationMinutes: 30,
      status: ADDON_SUGGESTION_STATUS.PENDING_REVIEW,
      history: [],
      version: 1,
      createdAt: '2026-03-01T12:00:00.000Z',
      updatedAt: '2026-03-01T12:00:00.000Z',
    });
    repository.updateSuggestion.mockResolvedValue(undefined);

    const reviewed = await service.review(adminRequest({
      action: 'approve',
      note: 'Looks good',
    }));

    expect(reviewed.status).toBe(ADDON_SUGGESTION_STATUS.APPROVED);
    expect(reviewed.publishedAddonId).toBeUndefined();
    expect(repository.updateSuggestion).toHaveBeenCalled();
  });

  it('returns not found when the parent service is missing', async () => {
    services.findById.mockResolvedValue(null);

    await expect(service.submit(vendorRequest(submitBody))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('replays create idempotency conflicts on hash mismatch', async () => {
    repository.getCreateIdempotency.mockResolvedValue({
      PK: 'VENDOR#vend-1',
      SK: 'IDEMPOTENCY#ADDON_SUGGESTION#idem-1',
      entityType: 'AddonSuggestionIdempotency',
      requestHash: 'other-hash',
      suggestionId: 'sug-1',
      vendorId: 'vend-1',
    });

    await expect(service.submit(vendorRequest(submitBody))).rejects.toBeInstanceOf(ConflictError);
  });
});
