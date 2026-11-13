import { LambdaRequest } from '@api-hub/utils';

import { validateCreateCustomerPlan } from './customer-plans.schema';

const body = {
  offeringId: 'pkg_weekly_wash',
  vehicleId: 'veh_1',
  location: { fulfilmentType: 'community', communityId: 'comm_1' },
  visitWindowId: 'morning',
  autoRenew: false,
  expectedPrice: { totalMinor: 1499, currency: 'INR' },
};

function parse(location: Record<string, unknown>) {
  return validateCreateCustomerPlan({ body: { ...body, location: { ...body.location, ...location } } } as unknown as LambdaRequest);
}

describe('CreateCustomerPlanSchema parkingBay', () => {
  it('accepts and trims an optional bay label', () => {
    expect(parse({ parkingBay: '  B2-14  ' }).location.parkingBay).toBe('B2-14');
  });

  it('leaves the bay absent when not supplied', () => {
    expect(parse({}).location).not.toHaveProperty('parkingBay');
  });

  it('rejects free-form address text and over-long labels', () => {
    expect(() => parse({ parkingBay: 'Flat 4, Tower B\nnear gate' })).toThrow();
    expect(() => parse({ parkingBay: 'B'.repeat(33) })).toThrow();
    expect(() => parse({ parkingBay: '' })).toThrow();
  });
});
