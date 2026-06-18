import {
  normalizeAssignedToTypeInput,
  prepareAssignedToTypeInput,
  validateAssignedToTypeInput,
} from './assigned-to-type.validation';

describe('assigned-to-type.validation', () => {
  it('strips staff fields when assignedToType is patient', () => {
    const result = normalizeAssignedToTypeInput({
      assignedToType: 'patient',
      assignedToStaffId: 'staff-nurse-44721',
      assignedToStaffDisplayName: 'Nurse Patel',
    });

    expect(result).toEqual({ assignedToType: 'patient' });
    expect(result).not.toHaveProperty('assignedToStaffId');
    expect(result).not.toHaveProperty('assignedToStaffDisplayName');
  });

  it('keeps assignee fields when assignedToType is orgStaff', () => {
    const result = normalizeAssignedToTypeInput({
      assignedToType: 'orgStaff',
      assignedToStaffId: 'staff-nurse-44721',
      assignedToStaffDisplayName: 'Nurse Patel',
    });

    expect(result).toEqual({
      assignedToType: 'orgStaff',
      assignedToStaffId: 'staff-nurse-44721',
      assignedToStaffDisplayName: 'Nurse Patel',
    });
  });

  it('normalizes legacy staff wire value to orgStaff', () => {
    const result = normalizeAssignedToTypeInput({
      assignedToType: 'staff' as 'orgStaff',
      assignedToStaffId: 'staff-nurse-44721',
      assignedToStaffDisplayName: 'Nurse Patel',
    });

    expect(result.assignedToType).toBe('orgStaff');
  });

  it('requires assignee fields when assignedToType is not patient', () => {
    expect(() =>
      validateAssignedToTypeInput({
        assignedToType: 'orgStaff',
        assignedToStaffId: 'staff-1',
      }),
    ).toThrow(
      'assignedToStaffId and assignedToStaffDisplayName are required when assignedToType is not patient',
    );
  });

  it('prepareAssignedToTypeInput normalizes patient tasks then validates', () => {
    const result = prepareAssignedToTypeInput({
      assignedToType: 'patient',
      assignedToStaffId: 'staff-nurse-44721',
      assignedToStaffDisplayName: 'Nurse Patel',
    });

    expect(result).toEqual({ assignedToType: 'patient' });
  });
});
