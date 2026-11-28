import { ValidationError } from '@api-hub/utils';

import type {
  ManagerPlanningPage,
  PartnerActor,
  PartnerInternalClient,
  VendorManagerData,
} from '../../clients/partner-internal.client';
import {
  requireManagerDate,
  todayInOperationsTimeZone,
} from '../../shared/time';
import {
  commitmentQuantityForDate,
  commitmentsForDate,
  configuredCrewCapacity,
  crewMap,
  effectiveCrewCapacity,
  labelMap,
  members,
  pointOfContactView,
  visitView,
  type SectionAvailability,
} from '../manager-shared';

export type PlanningTab = 'unassigned' | 'assigned' | 'availability';
export interface ManagerPlanningQuery {
  date: string;
  visitWindowId?: string;
  communityId?: string;
  tab: PlanningTab;
  pageSize: number;
  cursor?: string;
}

export interface ManagerPlanningResponse {
  schemaVersion: '1.0';
  asOf: string;
  timezone: string;
  timezoneSource?: 'SCHEDULE' | 'DEFAULT';
  appliedFilters: ManagerPlanningQuery;
  freshness: { booking: string; vendor?: string };
  sections: Record<string, SectionAvailability>;
  data: {
    counts: ManagerPlanningPage['counts'];
    tab: PlanningTab;
    items: Array<Record<string, unknown>>;
    capacity: Record<string, unknown>;
  };
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    total: null;
    totalAvailability: 'unavailable';
  };
}

export class ManagerPlanningService {
  constructor(
    private readonly client: PartnerInternalClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(
    actor: PartnerActor,
    query: ManagerPlanningQuery,
  ): Promise<ManagerPlanningResponse> {
    const [planningResult, vendorResult] = await Promise.allSettled([
      this.client.readBooking(actor, 'planning', query),
      this.client.readVendor(actor, {
        includeCrews: true,
        includeCommitments: true,
      }),
    ]);
    if (planningResult.status === 'rejected') throw planningResult.reason;
    const planning = planningResult.value as ManagerPlanningPage;
    const vendor =
      vendorResult.status === 'fulfilled'
        ? (vendorResult.value as VendorManagerData)
        : undefined;
    const communityIds = [
      ...new Set(
        planning.items
          .map((item) => item.communityId)
          .filter(Boolean) as string[],
      ),
    ];
    let labels: VendorManagerData | undefined;
    try {
      if (communityIds.length)
        labels = await this.client.readVendor(actor, { communityIds });
    } catch {
      // Label lookup is enrichment only.
    }
    const crews = crewMap(vendor?.crews);
    const communityLabels = labelMap(labels?.communities);
    const configuredCapacity = configuredCrewCapacity(vendor?.crews);
    const effectiveOperationalCapacity = effectiveCrewCapacity(
      configuredCapacity,
      planning.capacityWorkload?.assignedCapacityUnits,
    );
    const commitmentsAvailable =
      Boolean(vendor?.commitments) &&
      !vendor?.unavailableSections?.includes('commitments');
    const items =
      query.tab === 'availability'
        ? (vendor?.crews ?? []).map((crew) => ({
            crewId: crew.crewId,
            displayName: crew.name,
            vanLabel: crew.vanLabel,
            members: members(crew),
            // Dated attendance confirmation is not a Vendor capability.
            datedAvailabilityConfirmation: {
              status: 'UNAVAILABLE',
              reason: 'DATED_CONFIRMATION_NOT_SUPPORTED',
            },
            // Roster eligibility from Vendor (not dated confirmation).
            availabilityStatus: crew.availabilityStatus,
            pointOfContact: pointOfContactView(crew),
          }))
        : planning.items.map((visit) =>
            visitView(visit, communityLabels, crews),
          );
    const applicableCommitments = commitmentsAvailable
      ? commitmentsForDate(vendor?.commitments, planning.date, query.communityId)
      : null;
    const capacity = {
      acceptedCommitmentCapacity: applicableCommitments
        ? commitmentQuantityForDate(applicableCommitments, planning.date)
        : null,
      commitments: applicableCommitments,
      configuredCapacity,
      effectiveOperationalCapacity,
    };
    const appliedFilters: ManagerPlanningQuery = { ...query, date: planning.date };
    return {
      schemaVersion: '1.0',
      asOf: this.now().toISOString(),
      timezone: planning.timezone,
      ...(planning.timezoneSource
        ? { timezoneSource: planning.timezoneSource }
        : {}),
      appliedFilters,
      freshness: {
        booking: planning.sourceAsOf,
        ...(vendor?.sourceAsOf ? { vendor: vendor.sourceAsOf } : {}),
      },
      sections: {
        planning: { available: true, sourceAsOf: planning.sourceAsOf },
        crews: vendor?.crews
          ? { available: true, sourceAsOf: vendor.sourceAsOf }
          : { available: false, reason: 'DEPENDENCY_UNAVAILABLE' },
        capacity:
          configuredCapacity.status === 'AVAILABLE' &&
          effectiveOperationalCapacity.status === 'AVAILABLE'
            ? { available: true, sourceAsOf: planning.sourceAsOf }
            : {
                available: false,
                reason:
                  configuredCapacity.status === 'UNAVAILABLE'
                    ? 'DEPENDENCY_UNAVAILABLE'
                    : 'NOT_SUPPORTED',
              },
        capacityCommitments: commitmentsAvailable
          ? { available: true, sourceAsOf: vendor!.sourceAsOf }
          : { available: false, reason: 'DEPENDENCY_UNAVAILABLE' },
        communityLabels:
          labels || communityIds.length === 0
            ? {
                available: true,
                ...(labels?.sourceAsOf
                  ? { sourceAsOf: labels.sourceAsOf }
                  : {}),
              }
            : { available: false, reason: 'DEPENDENCY_UNAVAILABLE' },
      },
      data: { counts: planning.counts, tab: query.tab, items, capacity },
      pagination: {
        nextCursor: planning.nextCursor,
        hasMore: planning.hasMore,
        total: null,
        totalAvailability: 'unavailable',
      },
    };
  }
}

export function parseManagerPlanningQuery(
  raw: Record<string, string | undefined>,
  now: Date,
): ManagerPlanningQuery {
  const date = raw.date?.trim()
    ? requireManagerDate(raw.date, 'date', now)
    : todayInOperationsTimeZone(now);
  const tab = raw.tab?.trim() || 'unassigned';
  if (tab !== 'unassigned' && tab !== 'assigned' && tab !== 'availability') {
    throw new ValidationError(
      'tab must be unassigned, assigned, or availability',
    );
  }
  const pageSize =
    raw.pageSize === undefined || raw.pageSize === ''
      ? 20
      : Number(raw.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50)
    throw new ValidationError('pageSize must be an integer from 1 to 50');
  return {
    date,
    ...(optionalId(raw.visitWindowId, 'visitWindowId')
      ? { visitWindowId: optionalId(raw.visitWindowId, 'visitWindowId') }
      : {}),
    ...(optionalId(raw.communityId, 'communityId')
      ? { communityId: optionalId(raw.communityId, 'communityId') }
      : {}),
    tab,
    pageSize,
    ...(raw.cursor?.trim() ? { cursor: boundedCursor(raw.cursor) } : {}),
  };
}

function optionalId(
  value: string | undefined,
  field: string,
): string | undefined {
  if (value === undefined || value === '') return undefined;
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id))
    throw new ValidationError(`${field} is invalid`);
  return id;
}

function boundedCursor(value: string): string {
  const cursor = value.trim();
  if (cursor.length > 4096) throw new ValidationError('cursor is too long');
  return cursor;
}
