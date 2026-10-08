import { LambdaRequest } from '@api-hub/utils';

import { PricingService } from './pricing.service';
import { ServicesRepository } from '../repositories/services.repository';
import { PackagesRepository } from '../repositories/packages.repository';
import { AddOnsRepository } from '../repositories/add-ons.repository';
import { VendorPricingProvider } from '../integrations/vendor-pricing-provider';
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

describe('PricingService', () => {
  const services = {
    findById: jest.fn(),
    findByServiceId: jest.fn(),
  };
  const packages = {
    findById: jest.fn(),
    listPackageServiceItems: jest.fn(),
  };
  const addOns = { findByAddonId: jest.fn() };
  const vendorPricing: jest.Mocked<VendorPricingProvider> = {
    getPricing: jest.fn(),
  };

  const pricing = new PricingService(
    services as unknown as ServicesRepository,
    packages as unknown as PackagesRepository,
    addOns as unknown as AddOnsRepository,
    vendorPricing,
    () => NOW,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prices one service, an add-on, and a provider override', async () => {
    services.findByServiceId.mockResolvedValue(service());
    addOns.findByAddonId.mockResolvedValue(addon());
    vendorPricing.getPricing.mockResolvedValue({
      services: new Map([['svc-1', { enabled: true, priceOverride: 650 }]]),
      packages: new Map(),
    });

    const result = await pricing.calculate(
      request({
        vehicleType: 'SUV',
        vendorId: 'vendor-1',
        serviceIds: ['svc-1'],
        addOnIds: ['addon-1'],
        couponCode: 'SAVE100',
      }),
    );

    expect(vendorPricing.getPricing).toHaveBeenCalledWith('vendor-1', 'Bearer test');
    expect(result).toMatchObject({
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
    vendorPricing.getPricing.mockResolvedValue({
      services: new Map([['other-service', { enabled: true, priceOverride: 1 }]]),
      packages: new Map(),
    });

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
    vendorPricing.getPricing.mockResolvedValue({
      services: new Map(),
      packages: new Map([['pkg-1', { enabled: true, priceOverride: 700 }]]),
    });

    const result = await pricing.calculate(
      request({ vehicleType: 'SUV', vendorId: 'vendor-1', packageIds: ['pkg-1'] }),
    );

    expect(result.total).toBe(700);
    expect(result.items[0].providerUnitPrice).toBe(700);
    expect(result.items[0].catalogUnitPrice).toBe(800);
  });
});
