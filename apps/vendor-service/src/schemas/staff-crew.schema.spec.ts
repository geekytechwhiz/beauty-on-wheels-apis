import { LambdaRequest } from '@api-hub/utils';

import { validateCreateCrewRequest, validateUpdateCrewRequest } from './crew.schema';
import { validateCreateStaffRequest } from './staff.schema';

describe('staff and crew request schemas', () => {
  it('rejects an invalid Indian mobile number before the staff service runs', () => {
    expect(() => validateCreateStaffRequest({
      body: { name: 'Rahul', phoneNumber: '12345' },
    } as LambdaRequest)).toThrow(/Request validation failed/);
  });

  it('accepts a national mobile number and a crew of two staff ids', () => {
    expect(validateCreateStaffRequest({
      body: { name: 'Rahul', phoneNumber: '9876543210' },
    } as LambdaRequest).phoneNumber).toBe('9876543210');

    expect(validateCreateCrewRequest({
      body: { name: 'Morning Crew A', vanLabel: 'Van KL-07', staffIds: ['staff-1', 'staff-2'] },
    } as LambdaRequest).staffIds).toEqual(['staff-1', 'staff-2']);
  });

  it('accepts an optional status on create staff', () => {
    const request = {
      body: { name: 'Anu', phoneNumber: '+919876543211', status: 'ACTIVE' },
    } as LambdaRequest;

    expect(validateCreateStaffRequest(request)).toEqual({
      name: 'Anu',
      phoneNumber: '+919876543211',
      status: 'ACTIVE',
    });
    expect(request.body).toEqual({
      name: 'Anu',
      phoneNumber: '+919876543211',
      status: 'ACTIVE',
    });
  });

  it('rejects a crew with one member', () => {
    expect(() => validateCreateCrewRequest({
      body: { name: 'Morning Crew A', vanLabel: 'Van KL-07', staffIds: ['staff-1'] },
    } as LambdaRequest)).toThrow(/Request validation failed/);
  });

  it('accepts a non-negative integer planning visit limit and rejects an invalid limit', () => {
    expect(validateUpdateCrewRequest({
      body: { planningVisitLimit: 0 },
    } as LambdaRequest)).toEqual({ planningVisitLimit: 0 });

    expect(() => validateUpdateCrewRequest({
      body: { planningVisitLimit: 1.5 },
    } as LambdaRequest)).toThrow(/Request validation failed/);
    expect(() => validateUpdateCrewRequest({
      body: { planningVisitLimit: -1 },
    } as LambdaRequest)).toThrow(/Request validation failed/);
  });
});
