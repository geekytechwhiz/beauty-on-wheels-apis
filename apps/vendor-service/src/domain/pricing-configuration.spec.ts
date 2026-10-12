import { assignPricingConfiguration } from './pricing-configuration';

describe('assignPricingConfiguration', () => {
  it('initializes a new configuration at version 1', () => {
    const result = assignPricingConfiguration({
      hasExisting: false,
      existingServices: [],
      existingPackages: [],
      services: [{ serviceId: 'svc-1', categoryId: 'cat-1', enabled: true, priceOverride: 500 }],
      packages: [{ packageId: 'pkg-1', enabled: true }],
    });

    expect(result.configurationVersion).toBe(1);
    expect(result.services[0].version).toBe(1);
    expect(result.packages[0].version).toBe(1);
  });

  it('keeps versions when the override and enabled flag are unchanged', () => {
    const result = assignPricingConfiguration({
      hasExisting: true,
      configurationVersion: 4,
      existingServices: [{ serviceId: 'svc-1', enabled: true, priceOverride: 500, version: 3 }],
      existingPackages: [],
      services: [{ serviceId: 'svc-1', categoryId: 'cat-1', enabled: true, priceOverride: 500 }],
      packages: [],
    });

    expect(result.configurationVersion).toBe(4);
    expect(result.services[0].version).toBe(3);
  });

  it('increments when a price override changes and preserves an unchanged service', () => {
    const result = assignPricingConfiguration({
      hasExisting: true,
      configurationVersion: 2,
      existingServices: [
        { serviceId: 'svc-1', enabled: true, priceOverride: 500, version: 2 },
        { serviceId: 'svc-2', enabled: true, version: 1 },
      ],
      existingPackages: [],
      services: [
        { serviceId: 'svc-1', categoryId: 'cat-1', enabled: true, priceOverride: 650 },
        { serviceId: 'svc-2', categoryId: 'cat-1', enabled: true },
      ],
      packages: [],
    });

    expect(result.configurationVersion).toBe(3);
    expect(result.services[0].version).toBe(3);
    expect(result.services[1].version).toBe(1);
  });

  it('initializes a legacy row without treating the missing version as a client value', () => {
    const unchanged = assignPricingConfiguration({
      hasExisting: true,
      existingServices: [{ serviceId: 'svc-1', enabled: true, priceOverride: 500 }],
      existingPackages: [],
      services: [{ serviceId: 'svc-1', categoryId: 'cat-1', enabled: true, priceOverride: 500 }],
      packages: [],
    });
    const changed = assignPricingConfiguration({
      hasExisting: true,
      existingServices: [{ serviceId: 'svc-1', enabled: true }],
      existingPackages: [],
      services: [{ serviceId: 'svc-1', categoryId: 'cat-1', enabled: false }],
      packages: [],
    });

    expect(unchanged.configurationVersion).toBe(1);
    expect(unchanged.services[0].version).toBe(1);
    expect(changed.services[0].version).toBe(2);
    expect(changed.configurationVersion).toBe(2);
  });
});
