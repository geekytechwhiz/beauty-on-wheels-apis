import { CrewDdbItem, StaffDdbItem } from '../types/repository.types';
import { DEFAULT_MAX_VISITS_PER_CREW_PER_DAY } from './capacity-commitment';

export interface SchedulingCrewMemberView {
  staffId: string;
  status: string;
  name?: string;
}

export const POINT_OF_CONTACT_SOURCE = {
  DESIGNATED: 'designated',
  FIRST_ACTIVE_MEMBER: 'firstActiveMember',
} as const;

export type PointOfContactSource = (typeof POINT_OF_CONTACT_SOURCE)[keyof typeof POINT_OF_CONTACT_SOURCE];

export interface SchedulingCrewPointOfContact {
  staffId: string;
  name: string;
  /** Present when the staff record has one. Only returned on the partner manager read. */
  phoneNumber?: string;
  source: PointOfContactSource;
}

export interface SchedulingCrewView {
  crewId: string;
  vendorId: string;
  name: string;
  vanLabel: string;
  status: string;
  /** Whether the current roster passes Booking's assignment eligibility guard. */
  availabilityStatus: 'AVAILABLE' | 'UNAVAILABLE';
  availabilityReason?: 'CREW_INACTIVE' | 'INSUFFICIENT_ACTIVE_STAFF';
  /** Configured daily workload limit in capacity slot-units. */
  capacityPerDay: number;
  staff: SchedulingCrewMemberView[];
  /** Omitted unless requested, and when no active member can be contacted. */
  pointOfContact?: SchedulingCrewPointOfContact;
}

export interface SchedulingCrewOptions {
  includePointOfContact?: boolean;
}

/** Current staff status from the vendor table. Missing staff are not treated as active. */
export function toSchedulingCrew(
  crew: CrewDdbItem,
  staffById: ReadonlyMap<string, StaffDdbItem>,
  options: SchedulingCrewOptions = {},
): SchedulingCrewView {
  const staffIds = Array.isArray(crew.staffIds) ? crew.staffIds : [];
  const staff = staffIds.map((staffId) => {
    const member = staffById.get(staffId);
    return {
      staffId,
      status: member?.status ?? 'INACTIVE',
      ...(member?.name ? { name: member.name } : {}),
    };
  });
  const availabilityReason = crew.status !== 'ACTIVE'
    ? 'CREW_INACTIVE' as const
    : staff.filter((member) => member.status === 'ACTIVE').length < 2
      ? 'INSUFFICIENT_ACTIVE_STAFF' as const
      : undefined;
  const pointOfContact = options.includePointOfContact ? resolvePointOfContact(crew, staffIds, staffById) : undefined;
  return {
    crewId: crew.crewId,
    vendorId: crew.vendorId,
    name: crew.name,
    vanLabel: crew.vanLabel,
    status: crew.status,
    availabilityStatus: availabilityReason ? 'UNAVAILABLE' : 'AVAILABLE',
    ...(availabilityReason ? { availabilityReason } : {}),
    capacityPerDay: DEFAULT_MAX_VISITS_PER_CREW_PER_DAY,
    staff,
    ...(pointOfContact ? { pointOfContact } : {}),
  };
}

/**
 * The designated member wins while they are still on the crew and ACTIVE.
 * Otherwise the first ACTIVE member in roster order is used, so the result is
 * deterministic for crews that predate designation.
 */
export function resolvePointOfContact(
  crew: Pick<CrewDdbItem, 'pointOfContactStaffId'>,
  staffIds: readonly string[],
  staffById: ReadonlyMap<string, StaffDdbItem>,
): SchedulingCrewPointOfContact | undefined {
  const contactable = (staffId: string | undefined) => {
    const member = staffId && staffIds.includes(staffId) ? staffById.get(staffId) : undefined;
    return member?.status === 'ACTIVE' && member.name?.trim() ? member : undefined;
  };
  const designated = contactable(crew.pointOfContactStaffId);
  const member = designated ?? staffIds.map(contactable).find(Boolean);
  if (!member) return undefined;
  const phoneNumber = member.phoneNumber?.trim();
  return {
    staffId: member.staffId,
    name: member.name.trim(),
    ...(phoneNumber ? { phoneNumber } : {}),
    source: designated ? POINT_OF_CONTACT_SOURCE.DESIGNATED : POINT_OF_CONTACT_SOURCE.FIRST_ACTIVE_MEMBER,
  };
}
