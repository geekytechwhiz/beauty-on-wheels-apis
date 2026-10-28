import { LambdaRequest } from '@api-hub/utils';

import { validateCreateOffering, validatePatchOffering } from './offerings.schema';

function request(body: unknown): LambdaRequest {
  return { body } as LambdaRequest;
}

const validCreate = {
  offeringType: 'PACKAGE',
  name: 'Premium monthly wash',
  billingPeriod: 'monthly',
  currency: 'INR',
  vehiclePricing: [
    { vehicleType: 'HATCHBACK', price: 149900, durationMinutes: 45 },
    { vehicleType: 'SUV', price: 199900, durationMinutes: 60 },
  ],
  includedServices: [
    {
      name: 'Exterior wash',
      categoryId: 'cat_wash',
      visitsPerPeriod: 4,
      durationMinutes: 30,
    },
  ],
  status: 'published',
};

describe('offerings schema', () => {
  it('accepts a PACKAGE create body with minor-unit prices', () => {
    const result = validateCreateOffering(request(validCreate));
    expect(result.offeringType).toBe('PACKAGE');
    expect(result.vehiclePricing[0].price).toBe(149900);
    expect(result.includedServices[0].categoryId).toBe('cat_wash');
  });

  it('rejects fractional prices', () => {
    expect(() =>
      validateCreateOffering(
        request({
          ...validCreate,
          vehiclePricing: [{ vehicleType: 'SUV', price: 1999.5, durationMinutes: 60 }],
        }),
      ),
    ).toThrow();
  });

  it('requires at least one patch field', () => {
    expect(() => validatePatchOffering(request({}))).toThrow();
  });
});
