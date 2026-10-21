import { ConditionalWriteConflictError, LambdaRequest } from '@api-hub/utils';

import { PricingService } from './pricing.service';
import { ServicesRepository } from '../repositories/services.repository';
import { PackagesRepository } from '../repositories/packages.repository';
import { AddOnsRepository } from '../repositories/add-ons.repository';
import { VendorPricingProvider, VendorPricingSnapshot } from '../integrations/vendor-pricing-provider';
import { OfferingRevision, OfferingRevisionStore } from '../domain/offering-revision';
import {
  AddonEntity,
  PackageEntity,
  ServiceEntity,
} from '../utils/types/catalog-domain.types';

const NOW = new Date('2026-10-08T03:30:00.000Z');

function request(body: unknown): LambdaRequest {
  return {
    body,
    params: {},
    context: { authHeader: 'Bearer test' },
  } as unknown as LambdaRequest;
}

function service(partial: Partial<ServiceEntity> = {}): ServiceEntity {
  return {
    PK: 'CAT#cat-1',
    SK: 'SERVICE#svc-1',
    entityType: 'SERVICE',
    vendorId: 'vendor-1',
    categoryId: 'cat-1',
    serviceId: 'svc-1',
    name: 'Premium Wash',
    durationMinutes: 45,
    vehicleTypes: ['HATCHBACK', 'SUV', 'MUV'],
    basePrice: 750,
    displayOrder: 0,
    active: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...partial,
  };
}

function addon(partial: Partial<AddonEntity> = {}): AddonEntity {
  return {
    PK: 'CAT#cat-1',
    SK: 'SERVICE#svc-1#ADDON#addon-1',
    entityType: 'ADDON',
    vendorId: 'vendor-1',
    categoryId: 'cat-1',
    serviceId: 'svc-1',
    addonId: 'addon-1',
    name: 'Wax',
    price: 200,
    durationMinutes: 15,
    displayOrder: 0,
    active: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...partial,
  };
}

function packageEntity(partial: Partial<PackageEntity> = {}): PackageEntity {
  return {
    PK: 'PACKAGE#pkg-1',
    SK: 'META',
    entityType: 'PACKAGE',
    vendorId: 'vendor-1',
    packageId: 'pkg-1',
    name: 'Premium Complete',
    discountedPrice: 800,
    displayOrder: 0,
    active: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...partial,
  };
}

class MemoryRevisions implements OfferingRevisionStore {
  rows = new Map<string, OfferingRevision>();
  failSaves = 0;

  async findRevision(offeringId: string, vendorId: string): Promise<OfferingRevision | null> {
    return this.rows.get(`${offeringId}#${vendorId}`) ?? null;
  }

  async putRevision(revision: OfferingRevision, expectedOfferingVersion?: number): Promise<void> {
    const key = `${revision.offeringId}#${revision.vendorId}`;
    const current = this.rows.get(key) ?? null;
    if (this.failSaves > 0) {
      this.failSaves -= 1;
      throw new ConditionalWriteConflictError('conflict');
    }
    if (expectedOfferingVersion === undefined) {
      if (current) {
        throw new ConditionalWriteConflictError('exists');
      }
    } else if (!current || current.offeringVersion !== expectedOfferingVersion) {
      throw new ConditionalWriteConflictError('version');
    }
    this.rows.set(key, revision);
  }
}

function vendorSnapshot(
  services: Array<[string, { enabled: boolean; priceOverride?: number; version: number }]>,
  packages: Array<[string, { enabled: boolean; priceOverride?: number; version: number }]> = [],
  configurationVersion = 1,
): VendorPricingSnapshot {
  return {
    configurationVersion,
    services: new Map(services),
    packages: new Map(packages),
  };
}

describe('PricingService', () => {
  const services = {
    findById: jest.fn(),
    findByServiceId: jest.fn(),
    ensureServiceVersion: jest.fn(async (entity: ServiceEntity) => ({
      ...entity,
      version: entity.version ?? 1,
    })),
  };
  const packages = {
    findById: jest.fn(),
    listPackageServiceItems: jest.fn(),
    ensurePackageVersion: jest.fn(async (entity: PackageEntity) => ({
      ...entity,
      version: entity.version ?? 1,
    })),
  };
  const addOns = {
    findByAddonId: jest.fn(),
    ensureAddonVersion: jest.fn(async (entity: AddonEntity) => ({
      ...entity,
      version: entity.version ?? 1,
    })),
  };
  const vendorPricing: jest.Mocked<VendorPricingProvider> = {
    getPricing: jest.fn(),
  };
  const serviceRevisions = new MemoryRevisions();
  const packageRevisions = new MemoryRevisions();

  const pricing = new PricingService(
    services as unknown as ServicesRepository,
    packages as unknown as PackagesRepository,
    addOns as unknown as AddOnsRepository,
    vendorPricing,
    () => NOW,
    serviceRevisions,
    packageRevisions,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    serviceRevisions.rows.clear();
    serviceRevisions.failSaves = 0;
    packageRevisions.rows.clear();
    packageRevisions.failSaves = 0;
    services.ensureServiceVersion.mockImplementation(async (entity: ServiceEntity) => ({
      ...entity,
      version: entity.version ?? 1,
    }));
    packages.ensurePackageVersion.mockImplementation(async (entity: PackageEntity) => ({
      ...entity,
      version: entity.version ?? 1,
    }));
    addOns.ensureAddonVersion.mockImplementation(async (entity: AddonEntity) => ({
      ...entity,
      version: entity.version ?? 1,
    }));
  });

  it('prices one service, an add-on, and a provider override', async () => {
    services.findByServiceId.mockResolvedValue(service());
    addOns.findByAddonId.mockResolvedValue(addon());
    vendorPricing.getPricing.mockResolvedValue(vendorSnapshot([
      ['svc-1', { enabled: true, priceOverride: 650, version: 2 }],
    ]));

    const result = await pricing.calculate(
      request({
        vehicleType: 'SUV',
        vendorId: 'vendor-1',
        serviceIds: ['svc-1'],
        addOnIds: ['addon-1'],
        couponCode: 'SAVE100',
      }),
    );

    expect(vendorPricing.getPricing).toHaveBeenCalledWith('vendor-1');
    expect(result).toMatchObject({
      offeringVersion: 1,
      version: 1,
      catalogVersion: 1,
      vendorPricingVersion: 2,
      currency: 'INR',
      vehicleType: 'SUV',
      vendorId: 'vendor-1',
      subtotal: 650,
      discount: 0,
      addOnTotal: 200,
      total: 850,
      couponsApplied: false,
      pricingVersion: 'catalog-mvp-1',
      calculatedAt: NOW.toISOString(),
    });
    expect(result.subtotal + result.addOnTotal - result.discount).toBe(result.total);
  });

  it('prices a package from discountedPrice and checks every contained service', async () => {
    packages.findById.mockResolvedValue(packageEntity());
    packages.listPackageServiceItems.mockResolvedValue([
      { refId: 'wash', itemType: 'SERVICE' },
      { refId: 'interior', itemType: 'SERVICE' },
    ]);
    services.findByServiceId.mockImplementation(async (id: string) =>
      service({
        serviceId: id,
        name: id,
        basePrice: id === 'wash' ? 500 : 400,
        vehicleTypes: ['SUV', 'MUV'],
      }),
    );

    const result = await pricing.calculate(
      request({
        vehicleType: 'MUV',
        items: [{ type: 'PACKAGE', packageId: 'pkg-1' }],
      }),
    );

    expect(vendorPricing.getPricing).not.toHaveBeenCalled();
    expect(result.total).toBe(800);
    expect(result.items[0]).toMatchObject({
      type: 'PACKAGE',
      id: 'pkg-1',
      unitPrice: 800,
      catalogUnitPrice: 800,
    });
    expect(result.items[0].providerUnitPrice).toBeUndefined();
  });

  it('prices several services without a vendor override', async () => {
    services.findByServiceId.mockImplementation(async (id: string) =>
      service({
        serviceId: id,
        name: id,
        basePrice: id === 'svc-1' ? 100 : 250,
      }),
    );

    const result = await pricing.calculate(
      request({
        vehicleType: 'HATCHBACK',
        items: [
          { type: 'SERVICE', serviceId: 'svc-1' },
          { type: 'SERVICE', serviceId: 'svc-2' },
        ],
      }),
    );

    expect(result.total).toBe(350);
    expect(result.discount).toBe(0);
  });

  it('rejects an incompatible vehicle before returning a price', async () => {
    services.findByServiceId.mockResolvedValue(service({ vehicleTypes: ['SUV'] }));

    await expect(
      pricing.calculate(
        request({ vehicleType: 'BIKE', serviceIds: ['svc-1'] }),
      ),
    ).rejects.toMatchObject({ code: 'VEHICLE_TYPE_NOT_SUPPORTED', statusCode: 400 });
  });

  it('rejects an unknown vehicle type and missing catalog entities', async () => {
    await expect(
      pricing.calculate(request({ vehicleType: 'OTHER', serviceIds: ['svc-1'] })),
    ).rejects.toMatchObject({ code: 'INVALID_VEHICLE_TYPE' });

    services.findByServiceId.mockResolvedValue(null);
    await expect(
      pricing.calculate(request({ vehicleType: 'SUV', serviceIds: ['missing'] })),
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_FOUND', statusCode: 404 });

    packages.findById.mockResolvedValue(null);
    await expect(
      pricing.calculate(
        request({ vehicleType: 'SUV', packageIds: ['missing-package'] }),
      ),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_FOUND', statusCode: 404 });

    services.findByServiceId.mockResolvedValue(service());
    addOns.findByAddonId.mockResolvedValue(null);
    await expect(
      pricing.calculate(
        request({
          vehicleType: 'SUV',
          serviceIds: ['svc-1'],
          addOnIds: ['missing-addon'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'ADDON_NOT_FOUND', statusCode: 404 });
  });

  it('does not apply another service override to the selected service', async () => {
    services.findByServiceId.mockResolvedValue(service({ basePrice: 750 }));
    vendorPricing.getPricing.mockResolvedValue(vendorSnapshot([
      ['other-service', { enabled: true, priceOverride: 1, version: 4 }],
    ]));

    const result = await pricing.calculate(
      request({ vehicleType: 'SUV', vendorId: 'vendor-1', serviceIds: ['svc-1'] }),
    );

    expect(result.total).toBe(750);
    expect(result.items[0].providerUnitPrice).toBeUndefined();
  });

  it('uses a package provider override when the vendor offers that package', async () => {
    packages.findById.mockResolvedValue(packageEntity({ discountedPrice: 800 }));
    packages.listPackageServiceItems.mockResolvedValue([{ refId: 'wash', itemType: 'SERVICE' }]);
    services.findByServiceId.mockResolvedValue(service({ serviceId: 'wash', vehicleTypes: ['SUV'] }));
    vendorPricing.getPricing.mockResolvedValue(vendorSnapshot(
      [],
      [['pkg-1', { enabled: true, priceOverride: 700, version: 3 }]],
    ));

    const result = await pricing.calculate(
      request({ vehicleType: 'SUV', vendorId: 'vendor-1', packageIds: ['pkg-1'] }),
    );

    expect(result.total).toBe(700);
    expect(result.items[0].providerUnitPrice).toBe(700);
    expect(result.items[0].catalogUnitPrice).toBe(800);
    expect(result.offeringVersion).toBe(1);
    expect(result.vendorPricingVersion).toBe(3);
  });

  it('issues a new offering version when the catalog price version changes', async () => {
    services.findByServiceId.mockResolvedValue(service({ version: 2, basePrice: 750 }));
    vendorPricing.getPricing.mockResolvedValue(vendorSnapshot([
      ['svc-1', { enabled: true, version: 1 }],
    ]));
    const first = await pricing.calculate(
      request({ vehicleType: 'SUV', vendorId: 'vendor-1', serviceIds: ['svc-1'] }),
    );

    services.findByServiceId.mockResolvedValue(service({ version: 3, basePrice: 900 }));
    const second = await pricing.calculate(
      request({ vehicleType: 'SUV', vendorId: 'vendor-1', serviceIds: ['svc-1'] }),
    );

    expect(first.offeringVersion).toBe(1);
    expect(first.total).toBe(750);
    expect(second.offeringVersion).toBe(2);
    expect(second.total).toBe(900);
    expect(second.catalogVersion).toBe(3);
  });

  it('issues a new offering version when the vendor override version changes', async () => {
    services.findByServiceId.mockResolvedValue(service({ version: 2, basePrice: 750 }));
    vendorPricing.getPricing.mockResolvedValue(vendorSnapshot([
      ['svc-1', { enabled: true, priceOverride: 500, version: 1 }],
    ]));
    const first = await pricing.calculate(
      request({ vehicleType: 'SUV', vendorId: 'vendor-1', serviceIds: ['svc-1'] }),
    );

    vendorPricing.getPricing.mockResolvedValue(vendorSnapshot([
      ['svc-1', { enabled: true, priceOverride: 640, version: 2 }],
    ], [], 5));
    const second = await pricing.calculate(
      request({ vehicleType: 'SUV', vendorId: 'vendor-1', serviceIds: ['svc-1'] }),
    );

    expect(first.total).toBe(500);
    expect(first.vendorPricingVersion).toBe(1);
    expect(second.total).toBe(640);
    expect(second.offeringVersion).toBe((first.offeringVersion ?? 0) + 1);
    expect(second.vendorPricingVersion).toBe(2);
    expect(second.catalogVersion).toBe(2);
  });

  it('keeps the offering version when the same input versions are priced again', async () => {
    services.findByServiceId.mockResolvedValue(service({ version: 4, basePrice: 750 }));
    vendorPricing.getPricing.mockResolvedValue(vendorSnapshot([
      ['svc-1', { enabled: true, priceOverride: 610, version: 2 }],
    ]));

    const first = await pricing.calculate(
      request({ vehicleType: 'SUV', vendorId: 'vendor-1', serviceIds: ['svc-1'] }),
    );
    const second = await pricing.calculate(
      request({ vehicleType: 'SUV', vendorId: 'vendor-1', serviceIds: ['svc-1'] }),
    );

    expect(second.offeringVersion).toBe(first.offeringVersion);
    expect(second.total).toBe(first.total);
  });

  it('retries a concurrent revision write and returns the price from the successful snapshot', async () => {
    let reads = 0;
    services.findByServiceId.mockImplementation(async () => {
      reads += 1;
      return service({ version: reads === 1 ? 1 : 2, basePrice: reads === 1 ? 100 : 180 });
    });
    vendorPricing.getPricing.mockResolvedValue(vendorSnapshot([
      ['svc-1', { enabled: true, version: 1 }],
    ]));
    serviceRevisions.failSaves = 1;
    serviceRevisions.rows.set('svc-1#vendor-1', {
      offeringId: 'svc-1',
      vendorId: 'vendor-1',
      offeringVersion: 7,
      catalogVersion: 2,
      vendorPricingVersion: 1,
      dependencyVersions: [],
    });

    const result = await pricing.calculate(
      request({ vehicleType: 'SUV', vendorId: 'vendor-1', serviceIds: ['svc-1'] }),
    );

    expect(reads).toBeGreaterThan(1);
    expect(result.total).toBe(180);
    expect(result.offeringVersion).toBe(7);
    expect(result.catalogVersion).toBe(2);
  });

  it('fails when the catalog version cannot be initialized', async () => {
    services.findByServiceId.mockResolvedValue(service());
    services.ensureServiceVersion.mockResolvedValue(service({ version: undefined }));
    vendorPricing.getPricing.mockResolvedValue(vendorSnapshot([
      ['svc-1', { enabled: true, version: 1 }],
    ]));

    await expect(pricing.calculate(
      request({ vehicleType: 'SUV', vendorId: 'vendor-1', serviceIds: ['svc-1'] }),
    )).rejects.toMatchObject({ code: 'CATALOG_PRICING_UNAVAILABLE', statusCode: 502 });
  });

  it('fails closed when vendor pricing cannot be read', async () => {
    services.findByServiceId.mockResolvedValue(service({ version: 1 }));
    vendorPricing.getPricing.mockRejectedValue({
      code: 'VENDOR_PRICING_UNAVAILABLE',
      statusCode: 502,
    });

    await expect(pricing.calculate(
      request({ vehicleType: 'SUV', vendorId: 'vendor-1', serviceIds: ['svc-1'] }),
    )).rejects.toMatchObject({ code: 'VENDOR_PRICING_UNAVAILABLE' });
    expect(serviceRevisions.rows.size).toBe(0);
  });

  it('prices the selected vehicle before applying a provider override', async () => {
    services.findByServiceId.mockResolvedValue(service({
      basePrice: 399,
      durationMinutes: 30,
      vehicleTypes: ['HATCHBACK', 'SUV'],
      vehiclePricing: [
        { vehicleType: 'HATCHBACK', price: 399, durationMinutes: 30 },
        { vehicleType: 'SUV', price: 699, durationMinutes: 60 },
      ],
    }));

    const catalogPrice = await pricing.calculate(
      request({ vehicleType: 'SUV', serviceIds: ['svc-1'] }),
    );
    expect(catalogPrice.total).toBe(699);
    expect(catalogPrice.items[0].catalogUnitPrice).toBe(699);

    vendorPricing.getPricing.mockResolvedValue(vendorSnapshot([
      ['svc-1', { enabled: true, priceOverride: 650, version: 2 }],
    ]));
    const overridden = await pricing.calculate(
      request({ vehicleType: 'SUV', vendorId: 'vendor-1', serviceIds: ['svc-1'] }),
    );
    expect(overridden.items[0].catalogUnitPrice).toBe(699);
    expect(overridden.total).toBe(650);
  });

  it('rejects a service owned by another vendor', async () => {
    services.findByServiceId.mockResolvedValue(service({ vendorId: 'vendor-2', version: 1 }));

    await expect(pricing.calculate(
      request({ vehicleType: 'SUV', vendorId: 'vendor-1', serviceIds: ['svc-1'] }),
    )).rejects.toMatchObject({ code: 'SERVICE_NOT_FOUND', statusCode: 404 });
    expect(vendorPricing.getPricing).not.toHaveBeenCalled();
  });
});
