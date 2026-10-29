import { LambdaRequest } from '@api-hub/utils';

import { validateCreateOffering, validatePatchOffering } from './offerings.schema';

function request(body: unknown): LambdaRequest {
  return { body } as LambdaRequest;
}

const validCreate = {
  vendorId: 'vend_demo_001',
  categoryId: 'cat_wash',
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
  visitWindows: [
    { visitWindowId: 'morning', label: 'Morning', startTime: '08:00', endTime: '12:00' },
  ],
  status: 'published',
};

describe('offerings schema', () => {
  it('accepts a PACKAGE create body with vendorId and categoryId', () => {
    const result = validateCreateOffering(request(validCreate));
    expect(result.offeringType).toBe('PACKAGE');
    expect(result.vendorId).toBe('vend_demo_001');
    expect(result.categoryId).toBe('cat_wash');
    expect(result.vehiclePricing[0].price).toBe(149900);
    expect(result.includedServices[0].categoryId).toBe('cat_wash');
  });

  it('accepts package visitWindows with time bounds or allDay', () => {
    const result = validateCreateOffering(
      request({
        ...validCreate,
        visitWindows: [
          { visitWindowId: 'morning', label: 'Morning', startTime: '08:00', endTime: '12:00' },
          { visitWindowId: 'anytime', label: 'Anytime', allDay: true },
        ],
      }),
    );
    expect(result.visitWindows).toHaveLength(2);
    expect(result.visitWindows?.[1]).toMatchObject({ visitWindowId: 'anytime', allDay: true });
  });

  it('rejects missing vendorId or categoryId', () => {
    expect(() =>
      validateCreateOffering(request({ ...validCreate, vendorId: undefined })),
    ).toThrow();
    expect(() =>
      validateCreateOffering(request({ ...validCreate, categoryId: undefined })),
    ).toThrow();
  });

  it('rejects invalid vendorId or categoryId formats', () => {
    expect(() =>
      validateCreateOffering(request({ ...validCreate, vendorId: 'bad id!' })),
    ).toThrow();
    expect(() =>
      validateCreateOffering(request({ ...validCreate, categoryId: '' })),
    ).toThrow();
    expect(() =>
      validateCreateOffering(request({ ...validCreate, categoryId: '../escape' })),
    ).toThrow();
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

  it('rejects name/description that conflicts with billingPeriod', () => {
    expect(() =>
      validateCreateOffering(
        request({
          ...validCreate,
          name: 'Daily wash club',
          billingPeriod: 'weekly',
        }),
      ),
    ).toThrow(/conflicts with billingPeriod/);
  });

  it('requires at least one patch field', () => {
    expect(() => validatePatchOffering(request({}))).toThrow();
  });

  it('accepts serviceKey and validityDays on create', () => {
    const result = validateCreateOffering(
      request({
        ...validCreate,
        validityDays: 90,
        includedServices: [
          {
            ...validCreate.includedServices[0],
            serviceKey: 'ext_wash',
          },
        ],
      }),
    );
    expect(result.validityDays).toBe(90);
    expect(result.includedServices[0].serviceKey).toBe('ext_wash');
  });

  it('rejects duplicate serviceKey within includedServices', () => {
    expect(() =>
      validateCreateOffering(
        request({
          ...validCreate,
          includedServices: [
            { ...validCreate.includedServices[0], serviceKey: 'same_key' },
            {
              name: 'Interior vacuum',
              categoryId: 'cat_detail',
              visitsPerPeriod: 2,
              durationMinutes: 25,
              serviceKey: 'same_key',
            },
          ],
        }),
      ),
    ).toThrow(/Duplicate serviceKey/);
  });

  it('rejects invalid validityDays', () => {
    expect(() =>
      validateCreateOffering(request({ ...validCreate, validityDays: 0 })),
    ).toThrow();
    expect(() =>
      validateCreateOffering(request({ ...validCreate, validityDays: 800 })),
    ).toThrow();
  });
});
