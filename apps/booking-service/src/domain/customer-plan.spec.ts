import { assertPackageSellable, assertPlanExpectedPrice, buildPlanPricingSnapshot, deriveEntitlements, totalVisits } from './customer-plan';
import { CatalogPackage } from '../integrations/catalog.client';

const pkg: CatalogPackage = {
  id: 'pkg_1', vendorId: 'vendor_1', name: 'Wash', active: true, discountedPrice: 1999, currency: 'INR',
  items: [{ refId: 'svc_a', itemType: 'SERVICE' }, { refId: 'svc_a', itemType: 'SERVICE' }, { refId: 'svc_b', itemType: 'SERVICE', quantity: 3 }, { refId: 'addon_1', itemType: 'ADDON' }],
};

describe('customer plan domain', () => {
  it('derives one entitlement per service with occurrence counts and ignores add-ons', () => {
    const entitlements = deriveEntitlements(pkg.items);
    expect(entitlements).toEqual([{ serviceId: 'svc_a', quantity: 2 }, { serviceId: 'svc_b', quantity: 3 }]);
    expect(totalVisits(entitlements)).toBe(5);
  });

  it('snapshots the catalog integer price without rescaling', () => {
    expect(buildPlanPricingSnapshot(pkg)).toMatchObject({ totalAmount: 1999, totalMinor: 1999, currency: 'INR', packageId: 'pkg_1' });
    expect(() => assertPlanExpectedPrice({ totalMinor: 1999, currency: 'inr' }, buildPlanPricingSnapshot(pkg))).not.toThrow();
    expect(() => assertPlanExpectedPrice({ totalMinor: 199900, currency: 'INR' }, buildPlanPricingSnapshot(pkg))).toThrow();
  });

  it('rejects packages with no service entitlements', () => {
    expect(() => assertPackageSellable({ ...pkg, items: [{ refId: 'addon_1', itemType: 'ADDON' }] }, { vendorId: 'vendor_1', packageId: 'pkg_1' }))
      .toThrow('no service entitlements');
  });
});
