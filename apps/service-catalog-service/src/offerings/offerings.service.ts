import { BaseError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { pageOfferings } from './cursor';
import {
  CatalogCommunityOfferingSource,
  categoryIdFromClauses,
  CommunityOfferingSource,
  decodeCommunityCursor,
  encodeCommunityCursor,
  selectDiscoveryBranch,
} from './community-offerings';
import { communityOfferingEnforcementEnabled } from '../domain/offering-community';
import { applyCatalogFilters } from './filter-registry';
import {
  getOfferingAvailabilitySource,
} from './availability-bookable.client';
import {
  getOfferingsRepository,
  OfferingsRepository,
} from './offerings.repository';
import { parseOfferingsQuery } from './parse-offerings-query';
import { selectDiscoveryPartition } from './query-planner';
import { compareOfferings } from './sort-registry';
import {
  BookableOfferingCheck,
  MAX_AVAILABILITY_BRANCHES,
  MAX_AVAILABILITY_OFFERINGS,
  OFFERING_STATUS,
  OfferingAvailabilitySource,
  OfferingCandidate,
  OfferingsPage,
  OfferingView,
} from './types';

const logger = createChildLogger(
  createLogger({ service: 'service-catalog-service', redactPII: true }),
  { component: 'OfferingsService' },
);

export class OfferingsService {
  constructor(
    private readonly repository: Pick<OfferingsRepository, 'listDiscoveryPartition'> = getOfferingsRepository(),
    private readonly availability: OfferingAvailabilitySource = getOfferingAvailabilitySource(),
    private readonly communities: CommunityOfferingSource | null = null,
    private readonly enforceCommunity = communityOfferingEnforcementEnabled(),
  ) {}

  async listOfferings(input: unknown): Promise<OfferingsPage> {
    const parsed = parseOfferingsQuery(input);
    if (this.enforceCommunity && parsed.communityId) {
      return this.listCommunityOfferings(parsed, parsed.communityId);
    }
    const partitionKey = selectDiscoveryPartition(parsed.clauses);
    logger.info({
      event: 'offerings_list_start',
      partitionKey,
      limit: parsed.limit,
      filterCount: parsed.clauses.length,
      hasSearch: Boolean(parsed.search),
      hasLocation: Boolean(parsed.location),
      hasAvailability: Boolean(parsed.availableOn),
      sort: parsed.sorts.map((sort) => `${sort.field}:${sort.direction}`),
    });

    const loaded = await this.repository.listDiscoveryPartition(partitionKey);
    if (loaded.truncated) {
      throw new BaseError(
        'Offering candidate limit exceeded',
        503,
        'OFFERING_CANDIDATE_LIMIT',
      );
    }

    let matched = applyCatalogFilters(loaded.items, parsed);
    if (parsed.availableOn) {
      matched = await this.keepBookable(matched, parsed.availableOn, parsed.startTime);
    }
    matched.sort((left, right) => compareOfferings(left, right, parsed.sorts));
    const page = pageOfferings(matched, parsed);
    const items = page.items.map(toOfferingView);

    logger.info({
      event: 'offerings_list_success',
      count: items.length,
      matched: matched.length,
      hasMore: page.hasMore,
    });

    return {
      items,
      hasMore: page.hasMore,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  private async keepBookable(
    items: OfferingCandidate[],
    date: string,
    startTime: string | undefined,
  ): Promise<OfferingCandidate[]> {
    const branches = new Set(items.map((item) => `${item.entity.vendorId}#${item.entity.branchId}`));
    const checks = bookableChecks(items);
    if (
      branches.size > MAX_AVAILABILITY_BRANCHES
      || items.length > MAX_AVAILABILITY_OFFERINGS
    ) {
      throw new BaseError(
        'Narrow the offering filters before requesting availability',
        400,
        'AVAILABILITY_FILTER_TOO_BROAD',
      );
    }
    if (checks.length === 0) {
      return [];
    }

    const keys = await this.availability.findBookable({
      date,
      ...(startTime ? { startTime } : {}),
      offerings: checks,
    });
    return items.filter((item) => keys.has(item.offeringKey));
  }

  /**
   * Active offerings for one community. Pages follow GSI3. Each row still
   * carries branchId from the current discovery projection.
   */
  private async listCommunityOfferings(
    parsed: ReturnType<typeof parseOfferingsQuery>,
    communityId: string,
  ): Promise<OfferingsPage> {
    if (!this.communities) {
      throw new BaseError(
        'Community offering discovery is not configured',
        503,
        'COMMUNITY_OFFERING_UNAVAILABLE',
      );
    }
    const collected: OfferingCandidate[] = [];
    let exclusiveStartKey = decodeCommunityCursor(parsed.cursor, parsed, communityId);
    let resumeKey: Record<string, unknown> | undefined;
    let hasMore = false;
    const categoryId = categoryIdFromClauses(parsed.clauses);

    while (collected.length < parsed.limit) {
      const page = await this.communities.queryActivePage({
        communityId,
        categoryId,
        limit: 25,
        exclusiveStartKey,
      });
      if (page.items.length === 0) {
        hasMore = false;
        break;
      }
      for (let index = 0; index < page.items.length; index += 1) {
        const mapping = page.items[index];
        resumeKey = {
          PK: mapping.PK,
          SK: mapping.SK,
          ...(mapping.GSI3PK ? { GSI3PK: mapping.GSI3PK } : {}),
          ...(mapping.GSI3SK ? { GSI3SK: mapping.GSI3SK } : {}),
        };
        const discovery = await this.communities.listDiscoveryRows(mapping.serviceId);
        const selected = selectDiscoveryBranch(discovery, parsed.clauses);
        let matched = selected ? applyCatalogFilters([selected], parsed) : [];
        if (parsed.availableOn && matched.length > 0) {
          matched = await this.keepBookable(matched, parsed.availableOn, parsed.startTime);
        }
        if (matched[0]) {
          collected.push(matched[0]);
        }
        if (collected.length === parsed.limit) {
          hasMore = index < page.items.length - 1 || Boolean(page.lastEvaluatedKey);
          break;
        }
      }
      if (collected.length === parsed.limit) {
        break;
      }
      if (!page.lastEvaluatedKey) {
        hasMore = false;
        resumeKey = undefined;
        break;
      }
      exclusiveStartKey = page.lastEvaluatedKey;
      resumeKey = page.lastEvaluatedKey;
    }

    collected.sort((left, right) => compareOfferings(left, right, parsed.sorts));
    return {
      items: collected.map(toOfferingView),
      hasMore,
      ...(hasMore && resumeKey
        ? { nextCursor: encodeCommunityCursor(parsed, communityId, resumeKey) }
        : {}),
    };
  }
}

function bookableChecks(items: readonly OfferingCandidate[]): BookableOfferingCheck[] {
  const checks: BookableOfferingCheck[] = [];
  for (const item of items) {
    const vehicles = item.vehicleTypes.flatMap((vehicleType) => {
      const durationMinutes = item.entity.durationMinutesByVehicleType?.[vehicleType]
        ?? item.durationMinutes;
      if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
        return [];
      }
      return [{ vehicleType, durationMinutes }];
    });
    if (vehicles.length === 0) {
      continue;
    }
    checks.push({
      vendorId: item.entity.vendorId,
      branchId: item.entity.branchId,
      offeringId: item.entity.serviceId,
      vehicles,
    });
  }
  return checks;
}

 
export function toOfferingView(candidate: OfferingCandidate): OfferingView {
  const entity = candidate.entity;
  const imageUrl ={
    url: entity.image?.url,
    alt: entity.image?.alt 
  }

  return {
    offeringId: entity.serviceId,
    serviceId: entity.serviceId,
    name: entity.name,
    ...(entity.description ? { description: entity.description } : {}),
    categoryId: entity.categoryId,
    vendorId: entity.vendorId,
    branchId: entity.branchId,
    vehicleTypes: candidate.vehicleTypes,
    displayPrice: candidate.displayPrice,
    currency: entity.currency,
    durationMinutes: candidate.durationMinutes,
    ...(candidate.distanceKm === undefined
      ? {}
      : { distanceKm: Number(candidate.distanceKm.toFixed(2)) }),
    ...(entity.rating === undefined ? {} : { rating: entity.rating }),
    ...(entity.reviewCount === undefined
      ? {}
      : { reviewCount: entity.reviewCount }),
    status: OFFERING_STATUS.ACTIVE,
    imageUrl: {
      ...imageUrl,
    },
  };
}

let service: OfferingsService | undefined;

export function getOfferingsService(): OfferingsService {
  if (!service) {
    service = new OfferingsService(
      getOfferingsRepository(),
      getOfferingAvailabilitySource(),
      new CatalogCommunityOfferingSource(),
      communityOfferingEnforcementEnabled(),
    );
  }
  return service;
}
