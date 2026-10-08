import { BaseError, LambdaRequest } from '@api-hub/utils';

import { validateService } from './services.schema';

function request(body: unknown): LambdaRequest {
  return { body, params: {}, context: {} } as unknown as LambdaRequest;
}

describe('service validation', () => {
  const valid = {
    categoryId: 'cat-1',
    name: 'Premium Wash',
    durationMinutes: 45,
    vehicleTypes: ['HATCHBACK', 'SUV', 'MUV'],
    basePrice: 750,
  };

  it('accepts the canonical vehicle types', () => {
    expect(validateService(request(valid)).vehicleTypes).toEqual([
      'HATCHBACK',
      'SUV',
      'MUV',
    ]);
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
  });
});
