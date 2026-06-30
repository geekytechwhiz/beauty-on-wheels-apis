import {
  normalizeAssignedToTypeInput,
  prepareAssignedToTypeInput,
  validateAssignedToTypeInput,
} from './assigned-to-type.validation';

describe('assigned-to-type.validation', () => {
  it('strips staff fields when assignedToType is PATIENT without rewriting the code', () => {
    const result = normalizeAssignedToTypeInput({
      assignedToType: 'PATIENT',
      assignedToStaffId: 'staff-nurse-44721',
      assignedToStaffDisplayName: 'Nurse Patel',
    });

    expect(result).toEqual({ assignedToType: 'PATIENT' });
    expect(result).not.toHaveProperty('assignedToStaffId');
    expect(result).not.toHaveProperty('assignedToStaffDisplayName');
  });

  it('keeps assignee fields and registry code when assignedToType is ORG_STAFF', () => {
    const result = normalizeAssignedToTypeInput({
      assignedToType: 'ORG_STAFF',
      assignedToStaffId: 'staff-nurse-44721',
      assignedToStaffDisplayName: 'Nurse Patel',
    });

    expect(result).toEqual({
      assignedToType: 'ORG_STAFF',
      assignedToStaffId: 'staff-nurse-44721',
      assignedToStaffDisplayName: 'Nurse Patel',
    });
  });

  it('does not rewrite legacy patient wire value', () => {
    const result = normalizeAssignedToTypeInput({
      assignedToType: 'patient',
      assignedToStaffId: 'staff-nurse-44721',
      assignedToStaffDisplayName: 'Nurse Patel',
    });

    expect(result).toEqual({ assignedToType: 'patient' });
  });

  it('requires assignee fields when assignedToType is not patient', () => {
    expect(() =>
      validateAssignedToTypeInput({
        assignedToType: 'ORG_STAFF',
        assignedToStaffId: 'staff-1',
      }),
    ).toThrow(
      'assignedToStaffId and assignedToStaffDisplayName are required when assignedToType is not patient',
    );
  });

  it('accepts CARE_TEAM_ROLE when assignee fields are present', () => {
    expect(() =>
      validateAssignedToTypeInput({
        assignedToType: 'CARE_TEAM_ROLE',
        assignedToStaffId: 'role-1',
        assignedToStaffDisplayName: 'Triage Nurse',
      }),
    ).not.toThrow();
  });

  it('prepareAssignedToTypeInput preserves PATIENT registry code', () => {
    const result = prepareAssignedToTypeInput({
      assignedToType: 'PATIENT',
      assignedToStaffId: 'staff-nurse-44721',
      assignedToStaffDisplayName: 'Nurse Patel',
    });

    expect(result).toEqual({ assignedToType: 'PATIENT' });
  });
});
