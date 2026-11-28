import { ValidationError } from '@api-hub/utils';

import type { PartnerActor, PartnerInternalClient, ManagerWorkPage, VendorManagerData } from '../../clients/partner-internal.client';
import { requireManagerDate, todayInOperationsTimeZone } from '../../shared/time';
import {
  crewMap,
  isActiveBlocker,
  labelMap,
  members,
  pointOfContactView,
  visitView,
  type SectionAvailability,
} from '../manager-shared';

export type WorkView = 'all' | 'active' | 'completed';
export interface ManagerWorkQuery {
  date: string;
  communityId?: string;
  visitWindowId?: string;
  view: WorkView;
  pageSize: number;
  cursor?: string;
}

export interface ManagerWorkResponse {
  schemaVersion: '1.0';
  asOf: string;
  timezone: string;
  timezoneSource?: 'SCHEDULE' | 'DEFAULT';
  appliedFilters: ManagerWorkQuery;
  freshness: { booking: string; vendor?: string };
  sections: Record<string, SectionAvailability>;
  data: {
    summary: ManagerWorkPage['summary'];
    groups: Array<Record<string, unknown>>;
    unassigned: Array<Record<string, unknown>>;
  };
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    /** Whole-day count for the requested view; null when Booking does not supply it. */
    total: number | null;
    totalAvailability: 'available' | 'unavailable';
  };
}

export class ManagerWorkService {
  constructor(
    private readonly client: PartnerInternalClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(actor: PartnerActor, query: ManagerWorkQuery): Promise<ManagerWorkResponse> {
    const [workResult, vendorResult] = await Promise.allSettled([
      this.client.readBooking(actor, 'work', query),
      this.client.readVendor(actor, { includeCrews: true }),
    ]);
    if (workResult.status === 'rejected') throw workResult.reason;
    const work = workResult.value as ManagerWorkPage;
    const vendor = vendorResult.status === 'fulfilled' ? vendorResult.value as VendorManagerData : undefined;
    const ids = [...new Set(work.items.map((visit) => visit.communityId).filter(Boolean) as string[])];
    let labels: VendorManagerData | undefined;
    try {
      if (ids.length) labels = await this.client.readVendor(actor, { communityIds: ids });
    } catch {
      // Community labels are optional enrichment; IDs remain useful to the client.
    }
    const crews = crewMap(vendor?.crews);
    const communityLabels = labelMap(labels?.communities);
    const dayProgress = new Map((work.crewSummaries ?? []).map((summary) => [summary.crewId, summary.progress]));
    const assigned = new Map<string, typeof work.items>();
    const unassigned = [] as typeof work.items;
    for (const visit of work.items) {
      if (!visit.crewId) {
        unassigned.push(visit);
      } else {
        assigned.set(visit.crewId, [...(assigned.get(visit.crewId) ?? []), visit]);
      }
    }
    // Prefer Booking's resolved service date when the client omitted `date`.
    const appliedFilters: ManagerWorkQuery = { ...query, date: work.date };
    return {
      schemaVersion: '1.0',
      asOf: this.now().toISOString(),
      timezone: work.timezone,
      ...(work.timezoneSource ? { timezoneSource: work.timezoneSource } : {}),
      appliedFilters,
      freshness: { booking: work.sourceAsOf, ...(vendor?.sourceAsOf ? { vendor: vendor.sourceAsOf } : {}) },
      sections: {
        work: { available: true, sourceAsOf: work.sourceAsOf },
        blockers: work.issuesAvailable
          ? { available: true, sourceAsOf: work.sourceAsOf }
          : { available: false, reason: 'DEPENDENCY_UNAVAILABLE' },
        crews: vendor ? { available: true, sourceAsOf: vendor.sourceAsOf } : { available: false, reason: 'DEPENDENCY_UNAVAILABLE' },
        communityLabels: labels || ids.length === 0
          ? { available: true, ...(labels?.sourceAsOf ? { sourceAsOf: labels.sourceAsOf } : {}) }
          : { available: false, reason: 'DEPENDENCY_UNAVAILABLE' },
      },
      data: {
        summary: work.summary,
        groups: [...assigned.entries()].map(([crewId, visits]) => {
          const crew = crews.get(crewId);
          return {
            crew: {
              crewId,
              ...(crew?.name ? { displayName: crew.name } : {}),
              ...(crew?.vanLabel ? { vanLabel: crew.vanLabel } : {}),
              pointOfContact: pointOfContactView(crew),
              members: members(crew),
            },
            // Page-scoped for existing clients; dayProgress covers the whole filtered day.
            progress: progressFor(visits),
            ...(dayProgress.has(crewId) ? { dayProgress: dayProgress.get(crewId) } : {}),
            visits: visits.map((visit) => visitWithBlockers(visit, work, communityLabels, crews)),
          };
        }),
        unassigned: unassigned.map((visit) => visitWithBlockers(visit, work, communityLabels, crews)),
      },
      pagination: {
        nextCursor: work.nextCursor,
        hasMore: work.hasMore,
        ...(typeof work.total === 'number'
          ? { total: work.total, totalAvailability: 'available' as const }
          : { total: null, totalAvailability: 'unavailable' as const }),
      },
    };
  }
}

export function parseManagerWorkQuery(raw: Record<string, string | undefined>, now: Date): ManagerWorkQuery {
  // When date is omitted, Booking resolves today in the vendor timezone.
  const date = raw.date?.trim()
    ? requireManagerDate(raw.date, 'date', now)
    : todayInOperationsTimeZone(now);
  const view = raw.view?.trim() || 'all';
  if (view !== 'all' && view !== 'active' && view !== 'completed') {
    throw new ValidationError('view must be all, active, or completed');
  }
  const pageSize = raw.pageSize === undefined || raw.pageSize === '' ? 20 : Number(raw.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new ValidationError('pageSize must be an integer from 1 to 50');
  }
  return {
    date,
    ...(optionalId(raw.communityId, 'communityId') ? { communityId: optionalId(raw.communityId, 'communityId') } : {}),
    ...(optionalId(raw.visitWindowId, 'visitWindowId') ? { visitWindowId: optionalId(raw.visitWindowId, 'visitWindowId') } : {}),
    view,
    pageSize,
    ...(raw.cursor?.trim() ? { cursor: boundedCursor(raw.cursor) } : {}),
  };
}

function optionalId(value: string | undefined, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)) throw new ValidationError(`${field} is invalid`);
  return id;
}

function boundedCursor(value: string): string {
  const cursor = value.trim();
  if (cursor.length > 4096) throw new ValidationError('cursor is too long');
  return cursor;
}

function progressFor(visits: ManagerWorkPage['items']) {
  return {
    completed: visits.filter((visit) => visit.status === 'COMPLETED').length,
    inProgress: visits.filter((visit) => visit.status === 'IN_PROGRESS').length,
    notStarted: visits.filter((visit) => visit.status === 'SCHEDULED').length,
    missed: visits.filter((visit) => visit.status === 'MISSED').length,
    cancelled: visits.filter((visit) => visit.status === 'CANCELLED').length,
  };
}

function visitWithBlockers(
  visit: ManagerWorkPage['items'][number],
  work: ManagerWorkPage,
  labels: ReturnType<typeof labelMap>,
  crews: ReturnType<typeof crewMap>,
) {
  const view = visitView(visit, labels, crews);
  const blockers = work.issues
    .filter((issue) => issue.visitId === visit.visitId && isActiveBlocker(issue))
    .map((issue) => ({
      issueId: issue.issueId,
      type: issue.type,
      status: issue.status,
      ...(issue.blockingStartedAt ? { blockingStartedAt: issue.blockingStartedAt } : {}),
    }));
  return {
    ...view,
    // Null means issue data was unavailable; never invent an empty blocker list.
    blockers: work.issuesAvailable ? blockers : null,
  };
}
