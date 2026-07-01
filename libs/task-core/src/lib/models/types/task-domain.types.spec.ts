import {
  ASSIGNED_TO_TYPE,
  isKnownAssignedToType,
  isOrgStaffAssignedToType,
  isPatientAssignedToType,
} from './task-domain.types';

describe('task-domain AssignedToType', () => {
  it('uses metadata registry value codes as canonical constants', () => {
    expect(ASSIGNED_TO_TYPE.PATIENT).toBe('PATIENT');
    expect(ASSIGNED_TO_TYPE.ORG_STAFF).toBe('ORG_STAFF');
  });

  it('isPatientAssignedToType accepts registry and legacy patient values', () => {
    expect(isPatientAssignedToType('PATIENT')).toBe(true);
    expect(isPatientAssignedToType('patient')).toBe(true);
    expect(isPatientAssignedToType('ORG_STAFF')).toBe(false);
  });

  it('isOrgStaffAssignedToType accepts registry and legacy staff values', () => {
    expect(isOrgStaffAssignedToType('ORG_STAFF')).toBe(true);
    expect(isOrgStaffAssignedToType('orgStaff')).toBe(true);
    expect(isOrgStaffAssignedToType('staff')).toBe(true);
  });

  it('isKnownAssignedToType accepts registry and legacy wire values', () => {
    expect(isKnownAssignedToType('PATIENT')).toBe(true);
    expect(isKnownAssignedToType('patient')).toBe(true);
    expect(isKnownAssignedToType('CARE_TEAM_ROLE')).toBe(true);
    expect(isKnownAssignedToType('careTeamRole')).toBe(true);
    expect(isKnownAssignedToType('unknown')).toBe(false);
  });
});
