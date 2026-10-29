import { LambdaRequest } from '@api-hub/utils';

import { validateCreateCrewRequest } from './crew.schema';
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

  it('rejects a crew with one member', () => {
    expect(() => validateCreateCrewRequest({
      body: { name: 'Morning Crew A', vanLabel: 'Van KL-07', staffIds: ['staff-1'] },
    } as LambdaRequest)).toThrow(/Request validation failed/);
  });
});
