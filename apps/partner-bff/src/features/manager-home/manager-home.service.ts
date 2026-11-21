import { createLogger } from '@api-hub/observability';
import type {
  PartnerActor,
  PartnerInternalClient,
  ManagerOverview,
  VendorManagerData,
  CapacityCommitment,
} from '../../clients/partner-internal.client';
import {
  addDays,
  minutesUntil,
  remainingWindowMinutes,
  todayInOperationsTimeZone,
} from '../../shared/time';
import {
  commitmentQuantityForDate,
  crewMap,
  isActiveBlocker,
  labelMap,
  members,
  type SectionAvailability,
} from '../manager-shared';

/** Visits still to be worked: not started or in progress. */
const OPEN_STATUSES: ReadonlySet<string> = new Set([
  'SCHEDULED',
  'IN_PROGRESS',
]);

export interface ManagerHomeResponse {
  schemaVersion: '1.0';
  asOf: string;
  timezone: string;
  appliedFilters: Record<string, never>;
  freshness: { booking: string; vendor?: string };
  sections: Record<string, SectionAvailability>;
  data: {
    nextAction: Record<string, unknown> | null;
    upcomingPlan: Record<string, unknown>;
    todayProgress: Record<string, unknown>;
    planAhead: Array<Record<string, unknown>>;
  };
}

export class ManagerHomeService {
  constructor(
    private readonly client: PartnerInternalClient,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private readonly logger = createLogger({ name: 'ManagerHomeService' });
  async get(actor: PartnerActor): Promise<ManagerHomeResponse> {
    const now = this.now();
    const today = todayInOperationsTimeZone(now);
    const dates = [
      today,
      addDays(today, 1),
      addDays(today, 2),
      addDays(today, 3),
    ];
    const [overviewResult, vendorResult, capacityCommitmentsResult] = await Promise.allSettled([
      this.client.readBooking(actor, 'overview', { dates: dates.join(',') }),
      this.client.readVendor(actor, {
        includeCrews: true,
        includeCommitments: true,
      }),
      this.client.readCapacityCommitments(actor),
    ]);
    if (overviewResult.status === 'rejected') throw overviewResult.reason;
    const overview = overviewResult.value as ManagerOverview;
    const vendor = vendorResult.status === 'fulfilled' ? (vendorResult.value as VendorManagerData) : undefined;
    const communityIds = [
      ...new Set(
        overview.days.flatMap(
          (day) =>
            day.visits
              .map((visit) => visit.communityId)
              .filter(Boolean) as string[],
        ),
      ),
    ];
    let labelsResult: VendorManagerData | undefined;
    try {
      if (communityIds.length)
        labelsResult = await this.client.readVendor(actor, { communityIds });
    } catch {
      // Names are optional enrichment. IDs remain authoritative and usable.
    }
    const labels = labelMap(labelsResult?.communities);
    const crews = crewMap(vendor?.crews);
    const capacityCommitments = capacityCommitmentsResult.status === 'fulfilled' ? (capacityCommitmentsResult.value as CapacityCommitment[]) : undefined;
    const capacityCommitmentsByCommunityId = new Map(capacityCommitments?.map((commitment) => [commitment.communityId, commitment]));
    const capacityCommitmentsByDate = new Map(capacityCommitments?.map((commitment) => [commitment.window.startDate, commitment]));
   this.logger.info('Capacity commitments', {
     capacityCommitmentsByCommunityId,
     capacityCommitmentsByDate,
   });
    const days = new Map(overview.days.map((day) => [day.date, day]));
    const todayDay = days.get(today) ?? {
      date: today,
      visits: [],
      progress: emptyProgress(),
    };
    const tomorrow = addDays(today, 1);
    const tomorrowDay = days.get(tomorrow) ?? {
      date: tomorrow,
      visits: [],
      progress: emptyProgress(),
    };
    const hasVendor = Boolean(vendor);

    return {
      schemaVersion: '1.0',
      asOf: now.toISOString(),
      timezone: overview.timezone,
      appliedFilters: {},
      freshness: {
        booking: overview.sourceAsOf,
        ...(vendor?.sourceAsOf ? { vendor: vendor.sourceAsOf } : {}),
      },
      sections: {
        nextAction: overview.issuesAvailable
          ? { available: true, sourceAsOf: overview.sourceAsOf }
          : { available: false, reason: 'DEPENDENCY_UNAVAILABLE' },
        upcomingPlan: { available: true, sourceAsOf: overview.sourceAsOf },
        todayProgress: { available: true, sourceAsOf: overview.sourceAsOf },
        planAhead: { available: true, sourceAsOf: overview.sourceAsOf },
        communityLabels:
          labelsResult || communityIds.length === 0
            ? {
                available: true,
                ...(labelsResult?.sourceAsOf
                  ? { sourceAsOf: labelsResult.sourceAsOf }
                  : {}),
              }
            : { available: false, reason: 'DEPENDENCY_UNAVAILABLE' },
        crews: hasVendor
          ? { available: true, sourceAsOf: vendor!.sourceAsOf }
          : { available: false, reason: 'DEPENDENCY_UNAVAILABLE' },
        capacityCommitments:
          vendor?.commitments &&
          !vendor.unavailableSections?.includes('commitments')
            ? { available: true, sourceAsOf: vendor.sourceAsOf }
            : { available: false, reason: 'DEPENDENCY_UNAVAILABLE' },
      },
      data: {
        nextAction: overview.issuesAvailable
          ? nextAction(overview, todayDay.visits, labels, crews)
          : null,
        upcomingPlan: upcomingPlan(tomorrowDay.visits, tomorrow, labels, crews),
        todayProgress: {
          scope: 'PACKAGE_VISITS',
          date: today,
          progress: todayDay.progress,
          issueData: overview.issuesAvailable
            ? { available: true, sourceAsOf: overview.sourceAsOf }
            : { available: false, reason: 'DEPENDENCY_UNAVAILABLE' },
          windows: windowProgress(todayDay.visits, labels, now),
          currentWindow: currentWindow(todayDay.visits, now),
        },
        planAhead: dates.slice(1).map((date) => {
          const day = days.get(date) ?? {
            date,
            visits: [],
            progress: emptyProgress(),
          };
          const capacity = crewDayCapacity(day.visits, crews);
          return {
            date,
            scheduled: day.progress.expected,
            assigned: day.visits.filter((visit) => Boolean(visit.crewId))
              .length,
            unassigned: day.progress.unassigned,
            acceptedCommitmentCapacity: commitmentQuantityForDate(
              vendor?.commitments,
              date,
            ),
            capacityAvailability:
              vendor?.commitments &&
              !vendor.unavailableSections?.includes('commitments')
                ? 'AVAILABLE'
                : 'UNAVAILABLE',
            crewCapacity: capacity,
          };
        }),
      },
    };
  }
}

function nextAction(
  overview: ManagerOverview,
  visits: ManagerOverview['days'][number]['visits'],
  labels: ReadonlyMap<string, string>,
  crews: ReadonlyMap<string, NonNullable<VendorManagerData['crews']>[number]>,
): Record<string, unknown> | null {
  const actionable = overview.issues
    .filter(
      (issue) => issue.status === 'ACTION_REQUIRED' || isActiveBlocker(issue),
    )
    .sort(
      (left, right) =>
        Number(isActiveBlocker(right)) - Number(isActiveBlocker(left)) ||
        left.createdAt.localeCompare(right.createdAt),
    )[0];
  if (actionable) {
    const blocking = isActiveBlocker(actionable);
    const visit = actionable.visitId
      ? visits.find((item) => item.visitId === actionable.visitId)
      : undefined;
    const communityId = visit?.communityId ?? actionable.communityId;
    const affectedVisitCount = !blocking
      ? undefined
      : actionable.visitId
        ? 1
        : actionable.communityId
          ? visits.filter(
              (item) =>
                item.communityId === actionable.communityId &&
                OPEN_STATUSES.has(item.status),
            ).length
          : undefined;
    return {
      kind: 'ISSUE_ACTION_REQUIRED',
      issue: {
        issueId: actionable.issueId,
        type: actionable.type,
        status: actionable.status,
        createdAt: actionable.createdAt,
      },
      blocking,
      ...(affectedVisitCount !== undefined ? { affectedVisitCount } : {}),
      ...(blocking
        ? {
            blockingStart: actionable.blockingStartedAt
              ? { status: 'AVAILABLE', at: actionable.blockingStartedAt }
              : {
                  status: 'UNAVAILABLE',
                  reason: 'BLOCKING_START_NOT_RECORDED',
                },
          }
        : {}),
      ...(communityId
        ? { community: { communityId, displayName: labels.get(communityId) } }
        : {}),
      ...(visit?.crewId
        ? {
            crew: {
              crewId: visit.crewId,
              displayName: crews.get(visit.crewId)?.name,
            },
          }
        : {}),
      ...(visit?.date ? { date: visit.date } : {}),
    };
  }
  const unassigned = visits.filter(
    (visit) => visit.status === 'SCHEDULED' && !visit.crewId,
  );
  return unassigned.length > 0
    ? {
        kind: 'UNASSIGNED_WORK',
        date: visits[0]?.date,
        affectedVisitCount: unassigned.length,
      }
    : null;
}

function upcomingPlan(
  visits: ManagerOverview['days'][number]['visits'],
  date: string,
  labels: ReadonlyMap<string, string>,
  crews: ReadonlyMap<string, NonNullable<VendorManagerData['crews']>[number]>,
) {
  const groups = new Map<string, typeof visits>();
  for (const visit of visits) {
    const key = `${visit.communityId ?? ''}\u0000${visit.visitWindowId ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), visit]);
  }
  return {
    date,
    groups: [...groups.values()].map((items) => {
      const first = items[0]!;
      const crewIds = [
        ...new Set(
          items.map((visit) => visit.crewId).filter(Boolean) as string[],
        ),
      ];
      return {
        community: first.communityId
          ? {
              communityId: first.communityId,
              displayName: labels.get(first.communityId),
            }
          : undefined,
        visitWindow: first.visitWindowId
          ? {
              visitWindowId: first.visitWindowId,
              displayName: first.visitWindowName,
              ...windowTimes(first),
            }
          : undefined,
        scheduled: items.filter((visit) => visit.status !== 'CANCELLED').length,
        unassigned: items.filter(
          (visit) => visit.status === 'SCHEDULED' && !visit.crewId,
        ).length,
        crews: crewIds.map((crewId) =>
          crewDayAvailability(crewId, date, visits, crews),
        ),
      };
    }),
  };
}

/**
 * A dated availability result is composed from the authoritative crew roster
 * and the complete booking-day workload. Capacity is measured in the same
 * 30-minute slot-unit supplied by Vendor Service, never as a guessed visit
 * count. A crew must be active and have at least two active members to be
 * assignable, matching Booking's assignment guard.
 */
function crewDayAvailability(
  crewId: string,
  date: string,
  visits: ManagerOverview['days'][number]['visits'],
  crews: ReadonlyMap<string, NonNullable<VendorManagerData['crews']>[number]>,
) {
  const crew = crews.get(crewId);
  if (!crew) {
    return {
      crewId,
      date,
      members: [],
      availability: { status: 'UNAVAILABLE', reason: 'CREW_NOT_FOUND' },
      capacity: { status: 'UNAVAILABLE', reason: 'CREW_NOT_FOUND' },
    };
  }
  const capacityPerDay = crew.capacityPerDay;
  const assignedCapacityUnits = visits
    .filter((visit) => visit.crewId === crewId && visit.status !== 'CANCELLED')
    .reduce((total, visit) => total + workloadUnits(visit), 0);
  const availableCapacityUnits = Math.max(
    0,
    capacityPerDay - assignedCapacityUnits,
  );
  const unavailableReason =
    crew.availabilityStatus === 'UNAVAILABLE'
      ? crew.availabilityReason
      : assignedCapacityUnits >= capacityPerDay
        ? 'DAILY_CAPACITY_EXHAUSTED'
        : undefined;
  return {
    crewId,
    displayName: crew.name,
    vanLabel: crew.vanLabel,
    members: members(crew),
    date,
    availability: unavailableReason
      ? { status: 'UNAVAILABLE', reason: unavailableReason }
      : { status: 'AVAILABLE' },
    capacity: {
      status: 'AVAILABLE',
      capacityPerDay,
      assignedCapacityUnits,
      availableCapacityUnits,
    },
  };
}

function crewDayCapacity(
  visits: ManagerOverview['days'][number]['visits'],
  crews: ReadonlyMap<string, NonNullable<VendorManagerData['crews']>[number]>,
) {
  const availableCrews = [...crews.values()].filter(
    (crew) => crew.availabilityStatus === 'AVAILABLE',
  );
  const capacityPerDay = availableCrews.reduce(
    (total, crew) => total + crew.capacityPerDay,
    0,
  );
  const assignedCapacityUnits = visits
    .filter((visit) => Boolean(visit.crewId) && visit.status !== 'CANCELLED')
    .reduce((total, visit) => total + workloadUnits(visit), 0);
  return {
    status: 'AVAILABLE',
    capacityPerDay,
    assignedCapacityUnits,
    availableCapacityUnits: Math.max(0, capacityPerDay - assignedCapacityUnits),
  };
}

function workloadUnits(
  visit: ManagerOverview['days'][number]['visits'][number],
): number {
  return Math.max(1, Math.ceil(visit.service.estimatedMinutes / 30));
}

function windowProgress(
  visits: ManagerOverview['days'][number]['visits'],
  labels: ReadonlyMap<string, string>,
  asOf: Date,
) {
  const groups = new Map<string, typeof visits>();
  for (const visit of visits) {
    const key = `${visit.communityId ?? ''}\u0000${visit.visitWindowId ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), visit]);
  }
  return [...groups.values()].map((items) => {
    const first = items[0]!;
    return {
      community: first.communityId
        ? {
            communityId: first.communityId,
            displayName: labels.get(first.communityId),
          }
        : undefined,
      visitWindow: first.visitWindowId
        ? {
            visitWindowId: first.visitWindowId,
            displayName: first.visitWindowName,
            ...windowTimes(first),
            remainingMinutes: remainingWindowMinutes(
              first.date,
              first.window?.endTime,
              asOf,
            ),
          }
        : undefined,
      scheduled: items.filter((visit) => visit.status === 'SCHEDULED').length,
      completed: items.filter((visit) => visit.status === 'COMPLETED').length,
      inProgress: items.filter((visit) => visit.status === 'IN_PROGRESS')
        .length,
      unassigned: items.filter(
        (visit) => visit.status === 'SCHEDULED' && !visit.crewId,
      ).length,
      remaining: items.filter((visit) => OPEN_STATUSES.has(visit.status))
        .length,
    };
  });
}

/**
 * The window in progress (earliest end first), otherwise the next one to start today.
 * Aggregates every community sharing the window. Null when no window has valid times.
 */
function currentWindow(
  visits: ManagerOverview['days'][number]['visits'],
  asOf: Date,
) {
  const groups = new Map<string, typeof visits>();
  for (const visit of visits) {
    if (!visit.visitWindowId || visit.window?.allDay) continue;
    groups.set(visit.visitWindowId, [
      ...(groups.get(visit.visitWindowId) ?? []),
      visit,
    ]);
  }
  const timed = [...groups.values()].flatMap((items) => {
    const first = items[0]!;
    const untilStart = minutesUntil(first.date, first.window?.startTime, asOf);
    const untilEnd = minutesUntil(first.date, first.window?.endTime, asOf);
    return untilStart === null || untilEnd === null || untilEnd <= 0
      ? []
      : [{ items, untilStart, untilEnd }];
  });
  const active = timed
    .filter((item) => item.untilStart <= 0)
    .sort((a, b) => a.untilEnd - b.untilEnd)[0];
  const next = active ?? timed.sort((a, b) => a.untilStart - b.untilStart)[0];
  if (!next) return null;
  const first = next.items[0]!;
  return {
    visitWindowId: first.visitWindowId!,
    displayName: first.visitWindowName,
    startTime: first.window!.startTime!,
    endTime: first.window!.endTime!,
    state: active ? 'ACTIVE' : 'UPCOMING',
    remainingVisits: next.items.filter((visit) =>
      OPEN_STATUSES.has(visit.status),
    ).length,
    ...(active
      ? { remainingMinutes: next.untilEnd }
      : { minutesUntilStart: next.untilStart }),
  };
}

function windowTimes(visit: ManagerOverview['days'][number]['visits'][number]) {
  return {
    ...(visit.window?.startTime ? { startTime: visit.window.startTime } : {}),
    ...(visit.window?.endTime ? { endTime: visit.window.endTime } : {}),
    ...(visit.window?.allDay ? { allDay: true } : {}),
  };
}

function emptyProgress() {
  return {
    expected: 0,
    completed: 0,
    inProgress: 0,
    notStarted: 0,
    blocked: 0,
    unassigned: 0,
    missed: 0,
    cancelled: 0,
  };
}
