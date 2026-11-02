import { PlatformPackagesService } from './platform-packages.service';

const actorRequest = (body: unknown, params: Record<string, string> = {}) => ({
  body, params,
  context: { userContext: { userId: 'admin-1', roles: ['platform_admin'] }, authContext: { identityId: 'admin-1', roles: ['platform_admin'] } },
}) as any;

const categoryId = 'fdd72eb1-2647-4b0a-b9df-347f96317e5d';

const packageBody = {
  name: 'Interior Care',
  description: 'Routine cabin cleaning for a tidy, comfortable interior.',
  categoryId,
  billingPeriod: 'monthly',
  currency: 'INR',
  displayOrder: 0,
  status: 'draft',
  includedServices: [{
    name: 'Cabin Vacuum and Surface Wipe',
    serviceKey: 'interior_clean',
    categoryId,
    description: 'Vacuum accessible interior surfaces and wipe dashboard and console areas.',
    visitsPerPeriod: 4,
    durationMinutes: 30,
  }],
  vehiclePricing: [
    { vehicleType: 'HATCHBACK', price: 64900, durationMinutes: 120 },
    { vehicleType: 'SEDAN', price: 74900, durationMinutes: 140 },
    { vehicleType: 'SUV', price: 84900, durationMinutes: 160 },
    { vehicleType: 'MUV', price: 89900, durationMinutes: 160 },
    { vehicleType: 'LUXURY', price: 119900, durationMinutes: 180 },
  ],
  visitWindows: [{
    visitWindowId: 'win-weekday-morn',
    label: 'Weekday Morning (06:30 - 09:30)',
    allDay: false,
    startTime: '06:30',
    endTime: '09:30',
  }],
};

describe('PlatformPackagesService', () => {
  const categories = { findById: jest.fn() };
  const repository = { create: jest.fn(), save: jest.fn(), getPackage: jest.fn(), listRevisions: jest.fn(), listSalesControls: jest.fn(), getSalesControl: jest.fn(), saveSalesControl: jest.fn(), listEnabledForCommunity: jest.fn(), getRevision: jest.fn(), list: jest.fn() };
  const directory = { activeCommunityIds: jest.fn() };
  const coverage = { activeCommunityIds: jest.fn() };
  const service = new PlatformPackagesService(repository as any, categories as any, directory as any, coverage as any, () => '2026-01-01T00:00:00.000Z');

  beforeEach(() => { jest.clearAllMocks(); categories.findById.mockResolvedValue({ active: true }); });

  it('creates a draft from the platform package body and returns the same shape', async () => {
    const created = await service.create(actorRequest(packageBody));
    expect(created).toMatchObject({
      status: 'draft',
      version: 1,
      currency: 'INR',
      billingPeriod: 'monthly',
      displayOrder: 0,
      includedServices: [expect.objectContaining({ serviceKey: 'interior_clean', visitsPerPeriod: 4, durationMinutes: 30 })],
      vehiclePricing: expect.arrayContaining([
        { vehicleType: 'HATCHBACK', price: 64900, durationMinutes: 120 },
        { vehicleType: 'LUXURY', price: 119900, durationMinutes: 180 },
      ]),
      visitWindows: packageBody.visitWindows,
    });
    expect(created).not.toHaveProperty('vendorId');
    expect(created).not.toHaveProperty('billingCadence');
    expect(created).not.toHaveProperty('retailPricing');
    expect(created).not.toHaveProperty('validityDays');
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      billingPeriod: 'monthly',
      vehiclePricing: packageBody.vehiclePricing,
      includedServices: packageBody.includedServices,
    }));
  });

  it('returns the stored package shape on get', async () => {
    repository.getPackage.mockResolvedValue({
      PK: 'PLATFORM_PACKAGE#pkg_1', SK: 'META', entityType: 'PlatformPackage', packageId: 'pkg_1',
      ...packageBody, version: 1, createdAt: 'x', updatedAt: 'x', createdBy: 'admin-1', updatedBy: 'admin-1',
    });
    repository.listRevisions.mockResolvedValue([]);
    repository.listSalesControls.mockResolvedValue([]);
    const result = await service.get(actorRequest({}, { packageId: 'pkg_1' }));
    expect(result).toMatchObject({
      billingPeriod: 'monthly',
      vehiclePricing: packageBody.vehiclePricing,
      includedServices: packageBody.includedServices,
      visitWindows: packageBody.visitWindows,
      status: 'draft',
    });
    expect(result).not.toHaveProperty('retailPricing');
  });

  it('updates package fields and keeps the same response shape', async () => {
    const current = { PK: 'PLATFORM_PACKAGE#pkg_1', SK: 'META', entityType: 'PlatformPackage', packageId: 'pkg_1', ...packageBody, status: 'published', version: 2, publishedVersion: 2, createdAt: 'x', updatedAt: 'x', createdBy: 'admin-1', updatedBy: 'admin-1' };
    repository.getPackage.mockResolvedValue(current);
    const result = await service.patch(actorRequest({
      expectedVersion: 2,
      description: 'Updated copy',
      billingPeriod: 'weekly',
      vehiclePricing: [{ vehicleType: 'SEDAN', price: 75900, durationMinutes: 140 }],
    }, { packageId: 'pkg_1' }));
    expect(result).toMatchObject({
      status: 'draft',
      version: 3,
      publishedVersion: 2,
      billingPeriod: 'weekly',
      description: 'Updated copy',
      vehiclePricing: [{ vehicleType: 'SEDAN', price: 75900, durationMinutes: 140 }],
    });
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft', publishedVersion: 2, billingPeriod: 'weekly' }), 2);
  });

  it('keeps a published revision sellable while edits open a new draft', async () => {
    const current = { PK: 'PLATFORM_PACKAGE#pkg_1', SK: 'META', entityType: 'PlatformPackage', packageId: 'pkg_1', ...packageBody, status: 'published', version: 2, publishedVersion: 2, createdAt: 'x', updatedAt: 'x', createdBy: 'admin-1', updatedBy: 'admin-1' };
    repository.getPackage.mockResolvedValue(current);
    const result = await service.patch(actorRequest({ expectedVersion: 2, description: 'Updated copy' }, { packageId: 'pkg_1' }));
    expect(result).toMatchObject({ status: 'draft', version: 3, publishedVersion: 2 });
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft', publishedVersion: 2 }), 2);
  });

  it('refuses sales enablement without active community coverage', async () => {
    repository.getPackage.mockResolvedValue({ PK: 'PLATFORM_PACKAGE#pkg_1', SK: 'META', entityType: 'PlatformPackage', packageId: 'pkg_1', ...packageBody, status: 'published', version: 1, publishedVersion: 1, createdAt: 'x', updatedAt: 'x', createdBy: 'admin-1', updatedBy: 'admin-1' });
    repository.getSalesControl.mockResolvedValue(null); directory.activeCommunityIds.mockResolvedValue(['community-1']); coverage.activeCommunityIds.mockResolvedValue([]);
    await expect(service.updateSalesControl(actorRequest({ enabled: true, reason: 'Initial launch', fulfilmentVendorIds: ['vendor-1'], capacityCommitmentIds: ['capacity-1'] }, { packageId: 'pkg_1', communityId: 'community-1' }))).rejects.toThrow('approved community coverage');
  });
});
