import { CrewDdbItem, StaffDdbItem } from '../types/repository.types';

export interface SchedulingCrewMemberView {
  staffId: string;
  status: string;
  name?: string;
}

export interface SchedulingCrewView {
  crewId: string;
  vendorId: string;
  name: string;
  vanLabel: string;
  status: string;
  staff: SchedulingCrewMemberView[];
}

/** Current staff status from the vendor table. Missing staff are not treated as active. */
export function toSchedulingCrew(
  crew: CrewDdbItem,
  staffById: ReadonlyMap<string, StaffDdbItem>,
): SchedulingCrewView {
  return {
    crewId: crew.crewId,
    vendorId: crew.vendorId,
    name: crew.name,
    vanLabel: crew.vanLabel,
    status: crew.status,
    staff: crew.staffIds.map((staffId) => {
      const member = staffById.get(staffId);
      return {
        staffId,
        status: member?.status ?? 'INACTIVE',
        ...(member?.name ? { name: member.name } : {}),
      };
    }),
  };
}
