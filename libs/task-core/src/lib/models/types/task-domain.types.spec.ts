import {
  ASSIGNED_TO_TYPE,
  normalizeAssignedToTypeForWire,
} from './task-domain.types';

describe('task-domain AssignedToType', () => {
  it('normalizes legacy wire values to camelCase', () => {
    expect(normalizeAssignedToTypeForWire('staff')).toBe(ASSIGNED_TO_TYPE.ORG_STAFF);
    expect(normalizeAssignedToTypeForWire('PATIENT')).toBe(ASSIGNED_TO_TYPE.PATIENT);
    expect(normalizeAssignedToTypeForWire('ORG_STAFF')).toBe(ASSIGNED_TO_TYPE.ORG_STAFF);
    expect(normalizeAssignedToTypeForWire('careTeamRole')).toBe(ASSIGNED_TO_TYPE.CARE_TEAM_ROLE);
    expect(normalizeAssignedToTypeForWire('CARE_TEAM_ROLE')).toBe(ASSIGNED_TO_TYPE.CARE_TEAM_ROLE);
  });
});
