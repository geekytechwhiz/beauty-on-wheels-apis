import { isVehicleTypeSupported, VEHICLE_TYPE } from '@api-hub/utils';

import { calculatePriceBreakdown } from './pricing';

describe('isVehicleTypeSupported', () => {
  const service = { vehicleTypes: [VEHICLE_TYPE.HATCHBACK, VEHICLE_TYPE.SUV, VEHICLE_TYPE.MUV] };

  it('matches every configured type and rejects the others', () => {
    expect(isVehicleTypeSupported(service, VEHICLE_TYPE.HATCHBACK)).toBe(true);
    expect(isVehicleTypeSupported(service, VEHICLE_TYPE.SUV)).toBe(true);
    expect(isVehicleTypeSupported(service, VEHICLE_TYPE.MUV)).toBe(true);
    expect(isVehicleTypeSupported(service, VEHICLE_TYPE.BIKE)).toBe(false);
    expect(isVehicleTypeSupported(service, 'OTHER')).toBe(false);
  });
});

describe('calculatePriceBreakdown', () => {
  it('adds integer paise and keeps discount at zero without coupons', () => {
    const result = calculatePriceBreakdown([
      { type: 'SERVICE', id: 'svc-1', name: 'Premium Wash', catalogPrice: 750, providerPrice: 650 },
      { type: 'ADD_ON', id: 'addon-1', name: 'Wax', catalogPrice: 200.5 },
    ]);

    expect(result).toMatchObject({
      currency: 'INR',
      subtotal: 650,
      discount: 0,
      addOnTotal: 200.5,
      total: 850.5,
      pricingVersion: 'catalog-mvp-1',
    });
    expect(result.subtotal + result.addOnTotal - result.discount).toBe(result.total);
    expect(result.items[0].providerUnitPrice).toBe(650);
    expect(result.items[0].catalogUnitPrice).toBe(750);
  });

  it('rejects a negative provider price', () => {
    expect(() =>
      calculatePriceBreakdown([
        { type: 'SERVICE', id: 'svc-1', name: 'Wash', catalogPrice: 100, providerPrice: -1 },
      ]),
    ).toThrow(expect.objectContaining({ code: 'INVALID_PRICE' }));
  });
});
