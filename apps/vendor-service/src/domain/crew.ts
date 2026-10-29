import { ValidationError } from '@api-hub/utils';

import { CrewStatus, StaffStatus } from '../types/api-types';

export interface CrewMemberLookup {
  staffId: string;
  status: StaffStatus;
}

/**
 * Final crew state. Active crews may contain only active staff of this vendor.
 * Inactive crews keep historical staff ids, including staff deactivated later.
 */
export function assertCrewComposition(input: {
  name: string;
  vanLabel: string;
  staffIds: string[];
  members: Array<CrewMemberLookup | undefined>;
  status: CrewStatus;
}): { name: string; vanLabel: string; staffIds: string[] } {
  const name = input.name.trim();
  const vanLabel = input.vanLabel.trim();
  if (name.length < 2) {
    throw new ValidationError('Enter a crew name');
  }
  if (!vanLabel) {
    throw new ValidationError('Enter a van label');
  }

  const staffIds = input.staffIds.map((id) => id.trim());
  if (staffIds.some((id) => !id) || staffIds.length < 2) {
    throw new ValidationError('A crew needs at least two staff members');
  }
  if (new Set(staffIds).size !== staffIds.length) {
    throw new ValidationError('A crew cannot list the same staff member more than once');
  }

  staffIds.forEach((staffId, index) => {
    const member = input.members[index];
    if (!member || member.staffId !== staffId) {
      throw new ValidationError('Every crew member must belong to this vendor');
    }
    if (input.status === 'ACTIVE' && member.status !== 'ACTIVE') {
      throw new ValidationError('Inactive staff cannot be added to a crew');
    }
  });

  return { name, vanLabel, staffIds };
}
