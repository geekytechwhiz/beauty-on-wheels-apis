import { UpdateVendorCapabilitiesRequestSchema } from './capabilities.schema';

const selection = {
  vehicleTypes: ['SUV'],
  washMethods: ['wash:FOAM'],
  serviceTypes: ['service:CAR_WASH'],
  services: [{ serviceId: 'svc-1', categoryId: 'cat-1', enabled: true }],
  packages: [{ packageId: 'pkg-1', enabled: true }],
};

describe('UpdateVendorCapabilitiesRequestSchema catalog ids', () => {
  it('requires the full capability selection', () => {
    expect(UpdateVendorCapabilitiesRequestSchema.safeParse(selection).success).toBe(true);
    expect(
      UpdateVendorCapabilitiesRequestSchema.safeParse({ vehicleTypes: ['SEDAN'] }).success,
    ).toBe(false);
  });

  it('accepts known wash method and service type ids', () => {
    const result = UpdateVendorCapabilitiesRequestSchema.safeParse({
      ...selection,
      washMethods: ['wash:FOAM', 'wash:FULL'],
      serviceTypes: ['service:CAR_WASH'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects guessed or cross-category ids', () => {
    for (const body of [
      { ...selection, washMethods: ['wash:TURBO'] },
      { ...selection, washMethods: ['FOAM'] },
      { ...selection, washMethods: ['service:CAR_WASH'] },
      { ...selection, serviceTypes: ['service:UNKNOWN'] },
      { ...selection, vehicleTypes: ['TRUCK'] },
      { ...selection, serviceIds: ['svc-1'] },
    ]) {
      expect(UpdateVendorCapabilitiesRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});
