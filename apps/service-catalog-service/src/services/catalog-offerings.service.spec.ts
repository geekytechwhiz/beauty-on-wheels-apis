jest.mock('../configs/env.config', () => ({
  env: {
    VENDOR_BASE_URL: 'https://vendors.example',
  },
}));

jest.mock('../integrations/vendor-self', () => ({
  resolveCallerVendor: jest.fn(),
}));

import { ConflictError, ForbiddenError, LambdaRequest, NotFoundError } from '@api-hub/utils';

import { resolveCallerVendor } from '../integrations/vendor-self';
import { CatalogOfferingsService } from './catalog-offerings.service';

const resolveCaller = resolveCallerVendor as jest.MockedFunction<typeof resolveCallerVendor>;

const createBody = {
  vendorId: 'vend_demo_001',
  categoryId: 'cat_wash',
  offeringType: 'PACKAGE',
  name: 'Premium monthly wash',
  billingPeriod: 'monthly',
  currency: 'INR',
  vehiclePricing: [
    { vehicleType: 'HATCHBACK', price: 149900, durationMinutes: 45 },
  ],
  includedServices: [
    {
      name: 'Exterior wash',
      categoryId: 'cat_wash',
      visitsPerPeriod: 4,
      durationMinutes: 30,
    },
  ],
  visitWindows: [
    { visitWindowId: 'morning', label: 'Morning', startTime: '08:00', endTime: '12:00' },
  ],
  status: 'draft',
};

function request(body: unknown): LambdaRequest {
  return {
    body,
    event: { headers: { Authorization: 'Bearer token' } },
    context: { correlationId: 'corr-1' },
  } as unknown as LambdaRequest;
}

describe('CatalogOfferingsService.create', () => {
  const offerings = {
    createOffering: jest.fn(),
    findByName: jest.fn(),
  };
  const categories = {
    findById: jest.fn(),
  };
  const services = {
    getVendorDiscoveryState: jest.fn(),
    listBranchDiscoveryStates: jest.fn(),
    getPriceDiscoveryState: jest.fn(),
    listDiscoveryPointers: jest.fn(),
    replaceDiscovery: jest.fn(),
  };
  const packages = {};
  const communities = {
    addCommunities: jest.fn(),
  };

  const service = new CatalogOfferingsService(
    offerings as never,
    categories as never,
    services as never,
    packages as never,
    null,
    communities as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    resolveCaller.mockResolvedValue({ vendorId: 'vend_demo_001', role: 'owner' });
    categories.findById.mockResolvedValue({ categoryId: 'cat_wash', active: true });
    offerings.findByName.mockResolvedValue(null);
    offerings.createOffering.mockResolvedValue(undefined);
    services.getVendorDiscoveryState.mockResolvedValue(null);
    services.listBranchDiscoveryStates.mockResolvedValue([]);
    services.getPriceDiscoveryState.mockResolvedValue(null);
    services.listDiscoveryPointers.mockResolvedValue([]);
    services.replaceDiscovery.mockResolvedValue(undefined);
  });

  it('persists submitted vendorId and categoryId when the caller is authorized', async () => {
    const created = await service.create(request(createBody));

    expect(created.vendorId).toBe('vend_demo_001');
    expect(created.categoryId).toBe('cat_wash');
    expect(offerings.createOffering).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: 'vend_demo_001',
        categoryId: 'cat_wash',
        name: 'Premium monthly wash',
      }),
    );
    expect(created.entitlements).toEqual([
      {
        serviceId: 'exterior-wash',
        quantity: 4,
        name: 'Exterior wash',
        durationMinutes: 30,
        categoryId: 'cat_wash',
      },
    ]);
  });

  it('rejects unauthorized vendor access', async () => {
    resolveCaller.mockResolvedValue({ vendorId: 'vend_other', role: 'owner' });

    await expect(service.create(request(createBody))).rejects.toBeInstanceOf(ForbiddenError);
    expect(offerings.createOffering).not.toHaveBeenCalled();
  });

  it('rejects when the top-level categoryId does not exist', async () => {
    categories.findById.mockResolvedValue(null);

    await expect(service.create(request(createBody))).rejects.toBeInstanceOf(NotFoundError);
    expect(offerings.createOffering).not.toHaveBeenCalled();
  });

  it('rejects when the top-level categoryId is inactive', async () => {
    categories.findById.mockResolvedValue({ categoryId: 'cat_wash', active: false });

    await expect(service.create(request(createBody))).rejects.toBeInstanceOf(ConflictError);
    expect(offerings.createOffering).not.toHaveBeenCalled();
  });
});
