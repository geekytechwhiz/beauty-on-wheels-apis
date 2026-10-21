import { BaseError, LambdaRequest } from '@api-hub/utils';

import { validateService } from './services.schema';

function request(body: unknown): LambdaRequest {
  return { body, params: {}, context: {} } as unknown as LambdaRequest;
}

describe('service validation', () => {
  const valid = {
    vendorId: 'vendor-1',
    categoryId: 'cat-1',
    name: 'Premium Wash',
    durationMinutes: 45,
    vehicleTypes: ['HATCHBACK', 'SUV', 'MUV'],
    basePrice: 750,
  };

  it('accepts the canonical vehicle types and stores one price for each', () => {
    expect(validateService(request(valid)).vehiclePricing).toEqual([
      { vehicleType: 'HATCHBACK', price: 750, durationMinutes: 45 },
      { vehicleType: 'SUV', price: 750, durationMinutes: 45 },
      { vehicleType: 'MUV', price: 750, durationMinutes: 45 },
    ]);
  });

  it('accepts a different price and duration for each vehicle type', () => {
    const pricing = [
      { vehicleType: 'HATCHBACK', price: 399, durationMinutes: 30 },
      { vehicleType: 'SEDAN', price: 499.5, durationMinutes: 45 },
      { vehicleType: 'SUV', price: 699, durationMinutes: 60 },
    ];
    expect(validateService(request({
      vendorId: 'vendor-1',
      categoryId: 'cat-1',
      name: 'Premium Wash',
      vehiclePricing: pricing,
    })).vehiclePricing).toEqual(pricing);
  });

  it('rejects an unknown vehicle type, duplicates, a negative price, and a non-positive duration', () => {
    expect(() =>
      validateService(request({ ...valid, vehicleTypes: ['OTHER'] })),
    ).toThrow(expect.objectContaining({ code: 'INVALID_VEHICLE_TYPE' }));
    expect(() =>
      validateService(request({ ...valid, vehicleTypes: ['SUV', 'SUV'] })),
    ).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() =>
      validateService(request({ ...valid, basePrice: -1 })),
    ).toThrow(expect.objectContaining({ code: 'INVALID_PRICE' }));
    expect(() =>
      validateService(request({ ...valid, durationMinutes: 0 })),
    ).toThrow(BaseError);
    expect(() =>
      validateService(request({
        vendorId: 'vendor-1',
        categoryId: 'cat-1',
        name: 'Premium Wash',
        vehiclePricing: [
          { vehicleType: 'SUV', price: 10, durationMinutes: 30 },
          { vehicleType: 'SUV', price: 20, durationMinutes: 40 },
        ],
      })),
    ).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() =>
      validateService(request({
        vendorId: 'vendor-1',
        categoryId: 'cat-1',
        name: 'Premium Wash',
      })),
    ).toThrow(expect.objectContaining({ message: 'vehiclePricing is required' }));
  });
});
