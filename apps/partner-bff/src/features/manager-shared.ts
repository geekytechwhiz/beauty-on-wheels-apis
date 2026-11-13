import type {
  CapacityCommitment,
  CommunityLabel,
  ManagerIssue,
  ManagerVisit,
  SchedulingCrew,
} from '../clients/partner-internal.client';

/**
 * Same rule Booking applies to its blocked counts. Re-checked here so a
 * Booking deployment that still projects resolved blockers cannot block a visit.
 */
export function isActiveBlocker(issue: Pick<ManagerIssue, 'blocksVisit' | 'status'>): boolean {
  return issue.blocksVisit === true && issue.status !== 'RESOLVED';
}

export type SectionAvailability = {
  available: boolean;
  reason?: 'DEPENDENCY_UNAVAILABLE' | 'NOT_SUPPORTED';
  sourceAsOf?: string;
};

export function labelMap(communities: readonly CommunityLabel[] | undefined): Map<string, string> {
  return new Map((communities ?? []).map((community) => [community.communityId, community.name]));
}

export function crewMap(crews: readonly SchedulingCrew[] | undefined): Map<string, SchedulingCrew> {
  return new Map((crews ?? []).map((crew) => [crew.crewId, crew]));
}

export function visitView(
  visit: ManagerVisit,
  communities: ReadonlyMap<string, string>,
  crews: ReadonlyMap<string, SchedulingCrew>,
) {
  const crew = visit.crewId ? crews.get(visit.crewId) : undefined;
  return {
    visitId: visit.visitId,
    planId: visit.planId,
    date: visit.date,
    status: visit.status,
    ...(visit.statusAt ? { statusAt: visit.statusAt } : {}),
    ...(visit.reviewStatus ? { reviewStatus: visit.reviewStatus } : {}),
    ...(visit.parkingBay ? { parkingBay: visit.parkingBay } : {}),
    assignmentStatus: visit.crewId ? 'ASSIGNED' as const : 'UNASSIGNED' as const,
    ...(visit.communityId ? {
      community: {
        communityId: visit.communityId,
        ...(communities.get(visit.communityId) ? { displayName: communities.get(visit.communityId) } : {}),
      },
    } : {}),
    ...(visit.visitWindowId ? {
      visitWindow: {
        visitWindowId: visit.visitWindowId,
        ...(visit.visitWindowName ? { displayName: visit.visitWindowName } : {}),
        ...(visit.window?.startTime ? { startTime: visit.window.startTime } : {}),
        ...(visit.window?.endTime ? { endTime: visit.window.endTime } : {}),
      },
    } : {}),
    ...(visit.crewId ? {
      crew: {
        crewId: visit.crewId,
        ...(crew?.name ? { displayName: crew.name } : {}),
        ...(crew?.vanLabel ? { vanLabel: crew.vanLabel } : {}),
      },
    } : {}),
    vehicle: visit.vehicle ?? {},
    service: visit.service,
  };
}

export function commitmentQuantityForDate(
  commitments: readonly CapacityCommitment[] | undefined,
  date: string,
  communityId?: string,
  visitWindow?: { startTime?: string; endTime?: string },
): number | null {
  if (!commitments) return null;
  return commitments
    .filter((commitment) => commitment.status !== 'CANCELLED')
    .filter((commitment) => date >= commitment.window.startDate && date <= commitment.window.endDate)
    .filter((commitment) => !communityId || commitment.communityId === communityId)
    .filter((commitment) => !visitWindow?.startTime || commitment.window.dailyWindow.startTime === visitWindow.startTime)
    .reduce((total, commitment) => total + commitment.quantity, 0);
}

/** The unavailable shape is unchanged from before Vendor supplied contacts. */
export function pointOfContactView(crew: SchedulingCrew | undefined) {
  const contact = crew?.pointOfContact;
  if (!contact?.staffId || !contact.name) return { status: 'UNAVAILABLE' as const, reason: 'NOT_SUPPORTED' as const };
  return {
    status: 'AVAILABLE' as const,
    staffId: contact.staffId,
    displayName: contact.name,
    ...(contact.phoneNumber ? { phoneNumber: contact.phoneNumber } : {}),
    source: contact.source,
  };
}

export function members(crew: SchedulingCrew | undefined) {
  return (crew?.staff ?? []).map((member) => ({
    staffId: member.staffId,
    ...(member.name ? { displayName: member.name } : {}),
    status: member.status,
  }));
}
