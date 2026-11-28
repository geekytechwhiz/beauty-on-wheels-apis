import { createLogger } from '@api-hub/observability';
import type {
  PartnerActor,
  PartnerInternalClient,
  ManagerOverview,
  VendorManagerData,
} from '../../clients/partner-internal.client';
import {
  addDays,
  minutesUntil,
  remainingWindowMinutes,
  todayInTimeZone,
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

/** Explicit reason when dated attendance confirmation is not a Vendor capability. */
const DATED_CONFIRMATION_UNSUPPORTED = {
  status: 'UNAVAILABLE' as const,
  reason: 'DATED_CONFIRMATION_NOT_SUPPORTED' as const,
};

export interface ManagerHomeResponse {
  schemaVersion: '1.0';
  asOf: string;
  timezone: string;
  /** Present when Booking reports how the zone was chosen. */
  timezoneSource?: 'SCHEDULE' | 'DEFAULT';
  appliedFilters: {
    date: string;
    fromDate: string;
    toDate: string;
  };
  freshness: { booking: string; vendor?: string };
  sections: Record<string, SectionAvailability>;
  data: {
    nextAction: Record<string, unknown> | null;
    upcomingPlan: Record<string, unknown>;
    todayProgress: Record<string, unknown>;
    planAhead: Array<Record<string, unknown>>;
    /** Display names for communities in Home data; empty when none were needed. */
    communityLabels: Array<{ communityId: string; displayName: string }>;
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
    // Booking owns the vendor timezone and default date window; do not precompute
    // Asia/Kolkata dates in the BFF.
    const [overviewResult, vendorResult] = await Promise.allSettled([
      this.client.readBooking(actor, 'overview', {}),
      this.client.readVendor(actor, {
        includeCrews: true,
        includeCommitments: true,
      }),
    ]);
    if (overviewResult.status === 'rejected') throw overviewResult.reason;
    const overview = overviewResult.value as ManagerOverview;
    const vendor =
      vendorResult.status === 'fulfilled'
        ? (vendorResult.value as VendorManagerData)
        : undefined;
    if (vendorResult.status === 'rejected') {
      this.logger.warn({
        event: 'manager_home_vendor_enrichment_unavailable',
        vendorId: actor.vendorId,
        correlationId: actor.correlationId,
      });
    }

    const timezone = overview.timezone;
    const today =
      overview.days[0]?.date ?? todayInTimeZone(now, timezone);
    const planDates = overview.days.map((day) => day.date);
    const toDate = planDates[planDates.length - 1] ?? today;

    const communityIds = [
      ...new Set(
        (overview.days ?? []).flatMap(
          (day) =>
            (day?.visits ?? [])
              .map((visit) => visit.communityId)
              .filter(Boolean) as string[],
        ),
      ),
    ];
    let labelsResult: VendorManagerData | undefined;
    try {
      if (communityIds.length) {
        labelsResult = await this.client.readVendor(actor, { communityIds });
      }
    } catch {
      // Names are optional enrichment. IDs remain authoritative and usable.
    }
    const labels = labelMap(labelsResult?.communities);
    const crews = crewMap(vendor?.crews);
    const days = new Map(overview.days.map((day) => [day.date, day]));
    const todayDay = days.get(today) ?? {
      date: today,
      visits: [],
      progress: emptyProgress(overview.issuesAvailable),
    };
    const tomorrow = addDays(today, 1);
    const tomorrowDay = days.get(tomorrow) ?? {
      date: tomorrow,
      visits: [],
      progress: emptyProgress(overview.issuesAvailable),
    };
    const hasVendor = Boolean(vendor);
    const commitmentsAvailable =
      Boolean(vendor?.commitments) &&
      !vendor?.unavailableSections?.includes('commitments');
    const communityLabelRows = [...labels.entries()].map(
      ([communityId, displayName]) => ({ communityId, displayName }),
    );

    return {
      schemaVersion: '1.0',
      asOf: now.toISOString(),
      timezone,
      ...(overview.timezoneSource
        ? { timezoneSource: overview.timezoneSource }
        : {}),
      appliedFilters: {
        date: today,
        fromDate: today,
        toDate,
      },
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
        capacityCommitments: commitmentsAvailable
          ? { available: true, sourceAsOf: vendor!.sourceAsOf }
          : { available: false, reason: 'DEPENDENCY_UNAVAILABLE' },
      },
      data: {
        nextAction: overview.issuesAvailable
          ? nextAction(overview, todayDay.visits ?? [], labels, crews)
          : null,
        upcomingPlan: upcomingPlan(
          tomorrowDay.visits ?? [],
          tomorrow,
          labels,
          crews,
          hasVendor,
        ),
        todayProgress: {
          scope: 'PACKAGE_VISITS',
          date: today,
          progress: todayDay.progress,
          issueData: overview.issuesAvailable
            ? { available: true, sourceAsOf: overview.sourceAsOf }
            : { available: false, reason: 'DEPENDENCY_UNAVAILABLE' },
          windows: windowProgress(todayDay.visits ?? [], labels, now, timezone),
          currentWindow: currentWindow(todayDay.visits ?? [], now, timezone),
        },
        planAhead: planDates.slice(1).map((date) => {
          const day = days.get(date) ?? {
            date,
            visits: [],
            progress: emptyProgress(overview.issuesAvailable),
          };
          const dayVisits = day.visits ?? [];
          return {
            date,
            scheduled: day.progress.expected,
            assigned: dayVisits.filter((visit) => Boolean(visit.crewId)).length,
            unassigned: day.progress.unassigned,
            /**
             * Accepted community capacity commitments for this civil date, in
             * Vendor commitment quantity units (not THIRTY_MINUTE_SLOT crew units).
             * Null when the commitments section was unavailable — never invented as 0.
             */
            acceptedCommitmentCapacity: commitmentsAvailable
              ? commitmentQuantityForDate(vendor?.commitments, date)
              : null,
            capacityAvailability: commitmentsAvailable
              ? 'AVAILABLE'
              : 'UNAVAILABLE',
            /**
             * Fleet crew capacity for the date in Vendor THIRTY_MINUTE_SLOT units.
             * Independent of acceptedCommitmentCapacity — do not compare the two
             * without converting units.
             */
            crewCapacity: hasVendor
              ? crewDayCapacity(dayVisits, crews)
              : {
                  status: 'UNAVAILABLE',
                  reason: 'DEPENDENCY_UNAVAILABLE',
                  capacityPerDay: null,
                  assignedCapacityUnits: null,
                  availableCapacityUnits: null,
                },
          };
        }),
        communityLabels: communityLabelRows,
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
      ...(actionable.visitId ? { visitId: actionable.visitId } : {}),
      ...(visit?.visitWindowId
        ? { visitWindowId: visit.visitWindowId }
        : {}),
    };
  }
  const unassigned = visits.filter(
    (visit) => visit.status === 'SCHEDULED' && !visit.crewId,
  );
  if (unassigned.length === 0) return null;
  const communityIds = [
    ...new Set(
      unassigned
        .map((visit) => visit.communityId)
        .filter(Boolean) as string[],
    ),
  ];
  const windowIds = [
    ...new Set(
      unassigned
        .map((visit) => visit.visitWindowId)
        .filter(Boolean) as string[],
    ),
  ];
  return {
    kind: 'UNASSIGNED_WORK',
    blocking: false,
    date: visits[0]?.date,
    affectedVisitCount: unassigned.length,
    ...(communityIds.length === 1
      ? {
          community: {
            communityId: communityIds[0]!,
            displayName: labels.get(communityIds[0]!),
          },
        }
      : {}),
    ...(windowIds.length === 1 ? { visitWindowId: windowIds[0] } : {}),
  };
}

function upcomingPlan(
  visits: ManagerOverview['days'][number]['visits'],
  date: string,
  labels: ReadonlyMap<string, string>,
  crews: ReadonlyMap<string, NonNullable<VendorManagerData['crews']>[number]>,
  crewsAvailable: boolean,
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
          crewDayAvailability(crewId, date, visits, crews, crewsAvailable),
        ),
      };
    }),
  };
}

/**
 * Dated operational availability is composed from the Vendor roster and the
 * complete booking-day workload (THIRTY_MINUTE_SLOT units). Dated attendance
 * confirmation is a separate capability and remains explicitly unsupported.
 */
function crewDayAvailability(
  crewId: string,
  date: string,
  visits: ManagerOverview['days'][number]['visits'],
  crews: ReadonlyMap<string, NonNullable<VendorManagerData['crews']>[number]>,
  crewsAvailable: boolean,
) {
  if (!crewsAvailable) {
    return {
      crewId,
      date,
      members: [],
      availabilityConfirmation: DATED_CONFIRMATION_UNSUPPORTED,
      availability: { status: 'UNAVAILABLE', reason: 'DEPENDENCY_UNAVAILABLE' },
      capacity: { status: 'UNAVAILABLE', reason: 'DEPENDENCY_UNAVAILABLE' },
    };
  }
  const crew = crews.get(crewId);
  if (!crew) {
    return {
      crewId,
      date,
      members: [],
      availabilityConfirmation: DATED_CONFIRMATION_UNSUPPORTED,
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
    // Honest: dated confirmation is not a Vendor capability today.
    availabilityConfirmation: DATED_CONFIRMATION_UNSUPPORTED,
    availability: unavailableReason
      ? { status: 'UNAVAILABLE', reason: unavailableReason }
      : { status: 'AVAILABLE' },
    capacity: {
      status: 'AVAILABLE',
      capacityPerDay,
      assignedCapacityUnits,
      availableCapacityUnits,
      capacityUnit: 'THIRTY_MINUTE_SLOT',
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
    status: 'AVAILABLE' as const,
    capacityPerDay,
    assignedCapacityUnits,
    availableCapacityUnits: Math.max(0, capacityPerDay - assignedCapacityUnits),
    capacityUnit: 'THIRTY_MINUTE_SLOT' as const,
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
  timeZone: string,
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
              timeZone,
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
  timeZone: string,
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
    const untilStart = minutesUntil(
      first.date,
      first.window?.startTime,
      asOf,
      timeZone,
    );
    const untilEnd = minutesUntil(
      first.date,
      first.window?.endTime,
      asOf,
      timeZone,
    );
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

function emptyProgress(issuesAvailable: boolean) {
  return {
    expected: 0,
    completed: 0,
    inProgress: 0,
    notStarted: 0,
    blocked: issuesAvailable ? 0 : null,
    unassigned: 0,
    missed: 0,
    cancelled: 0,
  };
}
