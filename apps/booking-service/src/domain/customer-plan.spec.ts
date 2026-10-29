import {
  assertPackageSellable,
  assertPlanExpectedPrice,
  billingPeriodEndIso,
  billingPeriodToCadence,
  buildPlanPricingSnapshot,
  deriveEntitlements,
  resolvePlanEntitlements,
  resolveVehiclePrice,
  resolveVisitWindow,
  totalVisits,
} from './customer-plan';
import { CatalogPackage } from '../integrations/catalog.client';

const pkg: CatalogPackage = {
  id: 'pkg_1',
  vendorId: 'vendor_1',
  name: 'Wash',
  active: true,
  billingPeriod: 'weekly',
  discountedPrice: 1999,
  currency: 'INR',
  vehiclePricing: [
    { vehicleType: 'SEDAN', price: 1999, durationMinutes: 170 },
    { vehicleType: 'SUV', price: 2499, durationMinutes: 200 },
  ],
  vehicleTypes: ['SEDAN', 'SUV'],
  includedServices: [
    { name: 'svc_a', categoryId: 'cat', visitsPerPeriod: 2, durationMinutes: 30 },
    { name: 'svc_b', categoryId: 'cat', visitsPerPeriod: 3, durationMinutes: 25 },
  ],
  visitWindows: [
    { visitWindowId: 'morning', label: 'Morning', startTime: '08:00', endTime: '12:00' },
    { visitWindowId: 'anytime', label: 'Anytime', allDay: true },
  ],
  items: [
    { refId: 'svc_a', itemType: 'SERVICE', quantity: 2 },
    { refId: 'svc_b', itemType: 'SERVICE', quantity: 3 },
    { refId: 'addon_1', itemType: 'ADDON' },
  ],
};

describe('customer plan domain', () => {
  it('derives one entitlement per service with occurrence counts and ignores add-ons', () => {
    const entitlements = deriveEntitlements(pkg.items);
    expect(entitlements).toEqual([{ serviceId: 'svc_a', quantity: 2 }, { serviceId: 'svc_b', quantity: 3 }]);
    expect(totalVisits(entitlements)).toBe(5);
  });

  it('prefers catalog entitlements or includedServices serviceKey over raw items', () => {
    expect(resolvePlanEntitlements({
      ...pkg,
      entitlements: [{ serviceId: 'exterior-wash', quantity: 8 }],
      includedServices: [
        { name: 'Exterior wash', serviceKey: 'exterior-wash', categoryId: 'cat', visitsPerPeriod: 8, durationMinutes: 30 },
      ],
      validityDays: 30,
    })).toEqual([{ serviceId: 'exterior-wash', quantity: 8 }]);
    expect(resolvePlanEntitlements({
      ...pkg,
      entitlements: undefined,
      includedServices: [
        { name: 'Exterior wash', serviceKey: 'exterior-wash', categoryId: 'cat', visitsPerPeriod: 8, durationMinutes: 30 },
      ],
    })).toEqual([{ serviceId: 'exterior-wash', quantity: 8 }]);
  });

  it('snapshots the vehicle-matched catalog integer price without rescaling', () => {
    expect(buildPlanPricingSnapshot(pkg, 'SUV')).toMatchObject({
      totalAmount: 2499,
      totalMinor: 2499,
      currency: 'INR',
      packageId: 'pkg_1',
      offeringId: 'pkg_1',
      vehicleType: 'SUV',
      durationMinutes: 200,
    });
    expect(() => assertPlanExpectedPrice({ totalMinor: 2499, currency: 'inr' }, buildPlanPricingSnapshot(pkg, 'SUV'))).not.toThrow();
    expect(() => assertPlanExpectedPrice({ totalMinor: 249900, currency: 'INR' }, buildPlanPricingSnapshot(pkg, 'SUV'))).toThrow();
  });

  it('rejects unsupported vehicle types, ambiguous prices, and missing visit windows', () => {
    expect(() => resolveVehiclePrice(pkg, 'BIKE')).toThrow(/not supported/);
    expect(() => resolveVehiclePrice(
      {
        ...pkg,
        vehiclePricing: [
          { vehicleType: 'SEDAN', price: 1999, durationMinutes: 170 },
          { vehicleType: 'SEDAN', price: 2099, durationMinutes: 170 },
        ],
      },
      'SEDAN',
    )).toThrow(/more than one offering price/);
    expect(resolveVisitWindow(pkg, 'morning')).toMatchObject({ visitWindowId: 'morning', startTime: '08:00' });
    expect(() => resolveVisitWindow(pkg, 'evening')).toThrow(/not offered/);
  });

  it('maps billing period to cadence and computes period end from first-job start', () => {
    expect(billingPeriodToCadence('weekly')).toBe('WEEKLY');
    expect(billingPeriodEndIso('2026-10-28T10:00:00.000Z', 'weekly')).toBe('2026-11-04T10:00:00.000Z');
  });

  it('rejects packages with no service entitlements', () => {
    expect(() => assertPackageSellable(
      {
        ...pkg,
        items: [{ refId: 'addon_1', itemType: 'ADDON' }],
        includedServices: [],
        entitlements: [],
      },
      { vendorId: 'vendor_1', packageId: 'pkg_1', offeringId: 'pkg_1' },
    )).toThrow('no service entitlements');
  });
});
