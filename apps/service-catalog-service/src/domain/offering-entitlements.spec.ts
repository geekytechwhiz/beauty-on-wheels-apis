import { deriveOfferingEntitlements, slugifyIncludedServiceName } from './offering-entitlements';

describe('offering entitlements', () => {
  it('slugifies service names for serviceId when serviceKey is absent', () => {
    expect(slugifyIncludedServiceName('Exterior Wash')).toBe('exterior-wash');
    expect(slugifyIncludedServiceName('  Interior & Vacuum! ')).toBe('interior-vacuum');
  });

  it('uses serviceKey when set and deduplicates slug collisions', () => {
    const entitlements = deriveOfferingEntitlements([
      {
        name: 'Exterior wash',
        categoryId: 'cat_wash',
        visitsPerPeriod: 4,
        durationMinutes: 30,
        serviceKey: 'ext_wash',
      },
      {
        name: 'Exterior wash (duplicate name)',
        categoryId: 'cat_wash',
        visitsPerPeriod: 2,
        durationMinutes: 20,
      },
      {
        name: 'Another Exterior wash',
        categoryId: 'cat_wash',
        visitsPerPeriod: 1,
        durationMinutes: 15,
      },
    ]);
    expect(entitlements.map((entry) => entry.serviceId)).toEqual([
      'ext_wash',
      'exterior-wash',
      'exterior-wash-2',
    ]);
    expect(entitlements[0]).toMatchObject({
      quantity: 4,
      name: 'Exterior wash',
      durationMinutes: 30,
      categoryId: 'cat_wash',
    });
  });
});
