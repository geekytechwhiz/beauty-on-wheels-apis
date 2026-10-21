/* eslint-disable mvrx/enforce-platform-logger */
/* eslint-disable no-console */
import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import {
  INITIAL_CATALOG_VERSION,
  isAuthoritativeCatalogVersion,
  isConditionalWriteFailure,
} from '../domain/catalog-version';
import {
  normalizeServiceEntity,
  serviceMatchesListFilters,
  servicePageKey,
} from '../domain/vehicle-pricing';
import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';
import { vendorCatalogQuery } from './vendor-index-query';
import {
  ServiceEntity,
  ServiceLookupEntity,
  ServiceVehicleEntity,
} from '../utils/types/catalog-domain.types';

import {
  DISCOVERY_FRESHNESS_CONDITION,
  discoveryFreshnessValues,
  discoveryWriteBlocked,
  sameDiscoveryProjection,
} from '../domain/discovery-projection';
import {
  DiscoveryBranchState,
  DiscoveryPointerEntity,
  DiscoveryPriceState,
  DiscoveryVendorState,
  DiscoveryWritePlan,
  ServiceDiscoveryEntity,
  ServiceDiscoveryQuery,
  ServiceDiscoveryResult,
  ServiceDiscoveryPage,
} from '../types/service-discovery.types';
import { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';
import {
  calculateRelevance,
  compareDiscoveryResults,
  decodeDiscoveryCursor,
  discoveryId,
  encodeDiscoveryCursor,
  haversineKm,
  normalizeSearch,
} from '../utils/helpers/catalog-admin';

const TABLE = () => env.DYNAMODB_TABLE_NAME;

const DISCOVERY_INDEX = 'GSI2';
const TRANSACT_ITEM_LIMIT = 25;
const MAX_DISCOVERY_CANDIDATES = 5000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const GSI1_INDEX = 'GSI1';
const LSI1_INDEX = 'LSI1';
const LSI5_INDEX = 'LSI5';

export class ServicesRepository extends BaseRepository {
  constructor() {
    super();
  }

  public getTableName() {
    return TABLE();
  }

  async searchDiscovery(
    params: ServiceDiscoveryQuery,
  ): Promise<ServiceDiscoveryPage> {
    const startedAt = Date.now();

    const {
      search,
      categoryId,
      latitude,
      longitude,
      radiusKm = 10,
      vehicleType,
      minPrice,
      maxPrice,
      minRating,
      sortBy = 'RELEVANCE',
      limit = DEFAULT_PAGE_SIZE,
      nextToken,
    } = params;

    console.info('service_discovery.search.started', {
      search: search?.trim() || undefined,
      categoryId,
      hasLocation: latitude !== undefined && longitude !== undefined,
      latitude,
      longitude,
      radiusKm,
      vehicleType,
      minPrice,
      maxPrice,
      minRating,
      sortBy,
      limit,
      hasNextToken: Boolean(nextToken),
    });

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      console.warn('service_discovery.validation.invalid_page_size', {
        limit,
        minAllowed: 1,
        maxAllowed: MAX_PAGE_SIZE,
      });

      throw new Error('Invalid discovery page size');
    }

    const hasLocation = latitude !== undefined && longitude !== undefined;

    if ((latitude === undefined) !== (longitude === undefined)) {
      console.warn('service_discovery.validation.incomplete_coordinates', {
        hasLatitude: latitude !== undefined,
        hasLongitude: longitude !== undefined,
      });

      throw new Error('Both coordinates are required');
    }

    if (sortBy === 'DISTANCE_ASC' && !hasLocation) {
      console.warn(
        'service_discovery.validation.location_required_for_distance_sort',
        {
          sortBy,
          hasLocation,
        },
      );

      throw new Error('Location required for distance sort');
    }

    if (
      hasLocation &&
      (!Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude! < -90 ||
        latitude! > 90 ||
        longitude! < -180 ||
        longitude! > 180)
    ) {
      console.warn('service_discovery.validation.invalid_coordinates', {
        latitude,
        longitude,
      });

      throw new Error('Invalid coordinates');
    }

    if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 100) {
      console.warn('service_discovery.validation.invalid_radius', {
        radiusKm,
        minAllowedExclusive: 0,
        maxAllowed: 100,
      });

      throw new Error('Invalid radius');
    }

    if (
      minPrice !== undefined &&
      maxPrice !== undefined &&
      minPrice > maxPrice
    ) {
      console.warn('service_discovery.validation.invalid_price_range', {
        minPrice,
        maxPrice,
      });

      throw new Error('Invalid price range');
    }

    console.debug('service_discovery.validation.completed', {
      hasLocation,
      durationMs: Date.now() - startedAt,
    });

    const normalizedSearch = normalizeSearch(search);

    const terms = normalizedSearch.split(/\s+/).filter(Boolean);

    console.debug('service_discovery.search.normalized', {
      originalSearch: search?.trim() || undefined,
      normalizedSearch: normalizedSearch || undefined,
      termCount: terms.length,
      terms,
    });

    const queryIdentity = JSON.stringify({
      search: normalizedSearch,
      categoryId,
      latitude,
      longitude,
      radiusKm,
      vehicleType,
      minPrice,
      maxPrice,
      minRating,
      sortBy,
    });

    const fingerprint = createHash('sha256')
      .update(queryIdentity)
      .digest('hex');

    console.debug('service_discovery.fingerprint.created', {
      fingerprint: fingerprint.substring(0, 12),
    });

    const cursor = decodeDiscoveryCursor(nextToken);

    console.debug('service_discovery.cursor.decoded', {
      hasCursor: Boolean(cursor),
      cursorLastId: cursor?.lastId,
      cursorFingerprint: cursor?.fingerprint?.substring(0, 12),
      expectedFingerprint: fingerprint.substring(0, 12),
    });

    if (cursor && cursor.fingerprint !== fingerprint) {
      console.warn('service_discovery.cursor.fingerprint_mismatch', {
        cursorFingerprint: cursor.fingerprint.substring(0, 12),
        expectedFingerprint: fingerprint.substring(0, 12),
        cursorLastId: cursor.lastId,
      });

      throw new Error('Cursor does not match filters');
    }

    // GSI2 already indexes vendor catalog rows on VENDOR#<vendorId>.
    // Discovery uses separate items whose GSI2PK is DISCOVERY#ALL or
    // DISCOVERY#CATEGORY#<categoryId>. Those partitions do not overlap.
    const partitionKey = categoryId
      ? CatalogKeyBuilder.discoveryCategoryPk(categoryId)
      : CatalogKeyBuilder.discoveryAllPk();

    console.debug('service_discovery.query.prepared', {
      tableName: TABLE(),
      indexName: DISCOVERY_INDEX,
      partitionKey,
      categoryId,
      maxCandidates: MAX_DISCOVERY_CANDIDATES,
    });

    const candidates: ServiceDiscoveryEntity[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    let queryPageCount = 0;

    const queryStartedAt = Date.now();

    do {
      queryPageCount += 1;

      const remaining = MAX_DISCOVERY_CANDIDATES + 1 - candidates.length;

      const pageLimit = Math.min(500, remaining);

      console.debug('service_discovery.query.page.started', {
        pageNumber: queryPageCount,
        pageLimit,
        remainingCandidateCapacity: remaining,
        currentCandidateCount: candidates.length,
        hasExclusiveStartKey: Boolean(lastEvaluatedKey),
      });

      const pageStartedAt = Date.now();

      const page = await this.queryPage<ServiceDiscoveryEntity>({
        TableName: TABLE(),
        IndexName: DISCOVERY_INDEX,
        KeyConditionExpression: '#gpk = :gpk',
        ExpressionAttributeNames: {
          '#gpk': 'GSI2PK',
        },
        ExpressionAttributeValues: {
          ':gpk': partitionKey,
        },
        Limit: pageLimit,
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const pageItemCount = page.items.length;

      candidates.push(...page.items);
      lastEvaluatedKey = page.lastEvaluatedKey;

      console.debug('service_discovery.query.page.completed', {
        pageNumber: queryPageCount,
        pageItemCount,
        totalCandidateCount: candidates.length,
        hasLastEvaluatedKey: Boolean(lastEvaluatedKey),
        durationMs: Date.now() - pageStartedAt,
      });
    } while (lastEvaluatedKey && candidates.length <= MAX_DISCOVERY_CANDIDATES);

    console.info('service_discovery.query.completed', {
      partitionKey,
      queryPageCount,
      candidateCount: candidates.length,
      hasLastEvaluatedKey: Boolean(lastEvaluatedKey),
      durationMs: Date.now() - queryStartedAt,
    });

    if (candidates.length > MAX_DISCOVERY_CANDIDATES || lastEvaluatedKey) {
      console.error('service_discovery.candidate_limit_exceeded', {
        partitionKey,
        candidateCount: candidates.length,
        maxCandidates: MAX_DISCOVERY_CANDIDATES,
        queryPageCount,
        hasLastEvaluatedKey: Boolean(lastEvaluatedKey),
        durationMs: Date.now() - startedAt,
      });

      throw new Error(
        'Discovery candidate limit exceeded; use a scalable search index',
      );
    }

    const filtered: ServiceDiscoveryResult[] = [];

    const rejectionStats = {
      invalidEntityType: 0,
      inactive: 0,
      vendorNotApproved: 0,
      branchNotOperational: 0,
      vehicleTypeMismatch: 0,
      missingOrInvalidPrice: 0,
      belowMinPrice: 0,
      aboveMaxPrice: 0,
      belowMinRating: 0,
      noSearchMatch: 0,
      invalidLocationData: 0,
      outsideRequestedRadius: 0,
      outsideVendorServiceRadius: 0,
    };

    const filterStartedAt = Date.now();

    console.debug('service_discovery.filter.started', {
      candidateCount: candidates.length,
      hasLocation,
      radiusKm,
      vehicleType,
      minPrice,
      maxPrice,
      minRating,
      termCount: terms.length,
    });

    for (const entity of candidates) {
      if (entity.entityType !== 'SERVICE_DISCOVERY') {
        rejectionStats.invalidEntityType += 1;
        continue;
      }

      if (!entity.active) {
        rejectionStats.inactive += 1;
        continue;
      }

      if (!entity.vendorApproved) {
        rejectionStats.vendorNotApproved += 1;
        continue;
      }

      if (!entity.branchOperational) {
        rejectionStats.branchNotOperational += 1;
        continue;
      }

      if (vehicleType && !(entity.vehicleTypes ?? []).includes(vehicleType)) {
        rejectionStats.vehicleTypeMismatch += 1;
        continue;
      }

      const prices = entity.displayPricesByVehicleType ?? {};

      const displayPrice = vehicleType
        ? prices[vehicleType]
        : Object.keys(prices).length === 0
          ? undefined
          : entity.basePrice;

      if (displayPrice === undefined || !Number.isFinite(displayPrice)) {
        rejectionStats.missingOrInvalidPrice += 1;
        continue;
      }

      if (minPrice !== undefined && displayPrice < minPrice) {
        rejectionStats.belowMinPrice += 1;
        continue;
      }

      if (maxPrice !== undefined && displayPrice > maxPrice) {
        rejectionStats.aboveMaxPrice += 1;
        continue;
      }

      if (minRating !== undefined && (entity.rating ?? 0) < minRating) {
        rejectionStats.belowMinRating += 1;
        continue;
      }

      const relevanceScore = calculateRelevance(entity, terms);

      if (terms.length && relevanceScore === 0) {
        rejectionStats.noSearchMatch += 1;
        continue;
      }

      let distanceKm: number | undefined;

      if (hasLocation) {
        if (
          !Number.isFinite(entity.latitude) ||
          !Number.isFinite(entity.longitude) ||
          !Number.isFinite(entity.serviceRadiusKm)
        ) {
          rejectionStats.invalidLocationData += 1;
          continue;
        }

        distanceKm = haversineKm(
          latitude!,
          longitude!,
          entity.latitude!,
          entity.longitude!,
        );

        if (distanceKm > radiusKm) {
          rejectionStats.outsideRequestedRadius += 1;
          continue;
        }

        if (distanceKm > entity.serviceRadiusKm!) {
          rejectionStats.outsideVendorServiceRadius += 1;
          continue;
        }
      }

      const durationForType = vehicleType
        ? entity.durationMinutesByVehicleType?.[vehicleType]
        : undefined;

      filtered.push({
        ...entity,
        displayPrice,
        ...(durationForType === undefined ? {} : { durationMinutes: durationForType }),
        distanceKm,
        relevanceScore,
      });
    }

    const rejectedCount = candidates.length - filtered.length;

    console.info('service_discovery.filter.completed', {
      candidateCount: candidates.length,
      acceptedCount: filtered.length,
      rejectedCount,
      rejectionStats,
      durationMs: Date.now() - filterStartedAt,
    });

    if (candidates.length > 0 && filtered.length === 0) {
      console.warn('service_discovery.filter.no_results', {
        candidateCount: candidates.length,
        rejectionStats,
        filters: {
          normalizedSearch: normalizedSearch || undefined,
          categoryId,
          hasLocation,
          radiusKm,
          vehicleType,
          minPrice,
          maxPrice,
          minRating,
        },
      });
    }

    const sortStartedAt = Date.now();

    filtered.sort((a, b) => compareDiscoveryResults(a, b, sortBy));

    console.debug('service_discovery.sort.completed', {
      sortBy,
      resultCount: filtered.length,
      durationMs: Date.now() - sortStartedAt,
    });

    // Keyset pagination over the globally sorted
    // bounded candidate set.
    const startIndex = cursor
      ? filtered.findIndex((item) => discoveryId(item) === cursor.lastId) + 1
      : 0;

    console.debug('service_discovery.pagination.resolved', {
      hasCursor: Boolean(cursor),
      cursorLastId: cursor?.lastId,
      startIndex,
      filteredCount: filtered.length,
      requestedLimit: limit,
    });

    if (cursor && startIndex === 0) {
      console.warn('service_discovery.cursor.not_found', {
        cursorLastId: cursor.lastId,
        filteredCount: filtered.length,
        fingerprint: fingerprint.substring(0, 12),
      });

      throw new Error('Discovery cursor is no longer valid');
    }

    const items = filtered.slice(startIndex, startIndex + limit);

    const hasMore = startIndex + limit < filtered.length;

    const lastItem = items[items.length - 1];

    const responseNextToken =
      hasMore && lastItem
        ? encodeDiscoveryCursor({
            fingerprint,
            lastId: discoveryId(lastItem),
          })
        : undefined;

    console.info('service_discovery.search.completed', {
      candidateCount: candidates.length,
      filteredCount: filtered.length,
      returnedCount: items.length,
      rejectedCount,
      startIndex,
      limit,
      hasMore,
      hasNextToken: Boolean(responseNextToken),
      firstResultId: items.length > 0 ? discoveryId(items[0]) : undefined,
      lastResultId: lastItem ? discoveryId(lastItem) : undefined,
      queryPageCount,
      rejectionStats,
      durationMs: Date.now() - startedAt,
    });

    return {
      items,
      hasMore,
      nextToken: responseNextToken,
    };
  }

  // ── Read operations ──────────────────────────────────────────────────────

  async findById(
    categoryId: string,
    serviceId: string,
  ): Promise<ServiceEntity | null> {
    const entity = await this.get<ServiceEntity>(TABLE(), {
      PK: CatalogKeyBuilder.categoryPk(categoryId),
      SK: CatalogKeyBuilder.serviceSk(serviceId),
    });
    return entity?.entityType === 'SERVICE' ? normalizeServiceEntity(entity) : null;
  }

  async findByServiceId(serviceId: string): Promise<ServiceEntity | null> {
    const lookup = await this.get<ServiceLookupEntity>(TABLE(), {
      PK: CatalogKeyBuilder.serviceLookupPk(serviceId),
      SK: CatalogKeyBuilder.serviceLookupSk(),
    });
    if (!lookup?.categoryId) {
      return null;
    }
    const service = await this.findById(lookup.categoryId, serviceId);
    return service?.entityType === 'SERVICE' ? service : null;
  }

  /**
   * Every service owned by one vendor. Category narrows the GSI2 sort key.
   * Vehicle type and duration are applied after the query. DynamoDB applies
   * Limit before a filter, so matching continues until the page is full.
   */
  async listByVendor(
    vendorId: string,
    params?: {
      categoryId?: string;
      activeOnly?: boolean;
      active?: boolean;
      vehicleType?: string;
      durationMinutes?: number;
      limit?: number;
      lastEvaluatedKey?: Record<string, unknown>;
    },
  ): Promise<{
    items: ServiceEntity[];
    lastEvaluatedKey?: Record<string, unknown>;
  }> {
    const activeOnly = params?.activeOnly === true || params?.active === true;
    const inactiveOnly = params?.active === false;
    const extraFilters: string[] = [];
    const extraNames: Record<string, string> = {};
    const extraValues: Record<string, unknown> = {};
    if (inactiveOnly) {
      extraNames['#active'] = 'active';
      extraValues[':active'] = false;
      extraFilters.push('#active = :active');
    }

    const pageLimit = params?.limit;
    const filters = {
      vehicleType: params?.vehicleType,
      durationMinutes: params?.durationMinutes,
    };
    const needsFill = Boolean(params?.vehicleType)
      || params?.durationMinutes !== undefined
      || activeOnly
      || inactiveOnly;

    const queryInput = (startKey: Record<string, unknown> | undefined, limit?: number) =>
      vendorCatalogQuery({
        tableName: TABLE(),
        vendorId,
        sortKeyPrefix: params?.categoryId
          ? CatalogKeyBuilder.vendorServiceCategoryPrefix(params.categoryId)
          : CatalogKeyBuilder.vendorServicePrefix(),
        entityType: 'SERVICE',
        activeOnly,
        extraFilters,
        extraNames,
        extraValues,
        limit,
        lastEvaluatedKey: startKey,
      });

    if (!needsFill) {
      const page = await this.queryPage<ServiceEntity>(
        queryInput(params?.lastEvaluatedKey, pageLimit),
      );
      return {
        items: page.items.map((item) => normalizeServiceEntity(item)),
        lastEvaluatedKey: page.lastEvaluatedKey,
      };
    }

    const matches: ServiceEntity[] = [];
    let startKey = params?.lastEvaluatedKey;
    const batch = Math.max(pageLimit ?? 25, 25);

    while (pageLimit === undefined || matches.length < pageLimit) {
      const page = await this.queryPage<ServiceEntity>(queryInput(startKey, batch));
      if (page.items.length === 0 && !page.lastEvaluatedKey) {
        break;
      }
      for (let index = 0; index < page.items.length; index += 1) {
        const raw = page.items[index];
        const entity = normalizeServiceEntity(raw);
        if (!serviceMatchesListFilters(entity, filters)) {
          continue;
        }
        matches.push(entity);
        if (pageLimit !== undefined && matches.length === pageLimit) {
          const moreInPage = page.items.slice(index + 1).some((item) =>
            serviceMatchesListFilters(normalizeServiceEntity(item), filters),
          );
          return {
            items: matches,
            lastEvaluatedKey: moreInPage || page.lastEvaluatedKey
              ? servicePageKey(raw)
              : undefined,
          };
        }
      }
      if (!page.lastEvaluatedKey) {
        break;
      }
      if (JSON.stringify(page.lastEvaluatedKey) === JSON.stringify(startKey)) {
        break;
      }
      startKey = page.lastEvaluatedKey;
    }

    return { items: matches, lastEvaluatedKey: undefined };
  }

  /**
   * List all services under a specific category (parent-scoped query).
   */
  async listByCategory(
    categoryId: string,
    params?: {
      activeOnly?: boolean;
      limit?: number;
      lastEvaluatedKey?: Record<string, unknown>;
    },
  ): Promise<{
    items: ServiceEntity[];
    lastEvaluatedKey?: Record<string, unknown>;
  }> {
    const queryParams: any = {
      TableName: TABLE(),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      FilterExpression: 'entityType = :et',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pk': CatalogKeyBuilder.categoryPk(categoryId),
        ':skPrefix': CatalogKeyBuilder.serviceSkPrefix(),
        ':et': 'SERVICE',
      },
      Limit: params?.limit,
      ExclusiveStartKey: params?.lastEvaluatedKey as any,
    };

    if (params?.activeOnly) {
      queryParams.FilterExpression += ' AND #active = :active';
      queryParams.ExpressionAttributeNames['#active'] = 'active';
      queryParams.ExpressionAttributeValues[':active'] = true;
    }

    return this.queryPage<ServiceEntity>(queryParams).then((page) => ({
      items: page.items.map((item) => normalizeServiceEntity(item)),
      lastEvaluatedKey: page.lastEvaluatedKey,
    }));
  }

  /**
   * List all services under a category ordered by displayOrder (LSI1).
   */
  async listByCategoryOrdered(categoryId: string): Promise<ServiceEntity[]> {
    return this.queryAll<ServiceEntity>({
      TableName: TABLE(),
      IndexName: LSI1_INDEX,
      KeyConditionExpression: '#pk = :pk AND begins_with(#lsi1sk, :prefix)',
      FilterExpression: 'entityType = :et',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#lsi1sk': 'LSI1SK',
      },
      ExpressionAttributeValues: {
        ':pk': CatalogKeyBuilder.categoryPk(categoryId),
        ':prefix': 'DISPLAY_ORDER#',
        ':et': 'SERVICE',
      },
    }).then((items) =>
      items
        .map((item) => normalizeServiceEntity(item))
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)),
    );
  }

  /**
   * Services in a category that apply to one vehicle type.
   * Applicability rows are one item per type, queried on the base table.
   */
  async listByVehicleType(
    categoryId: string,
    vehicleType: string,
  ): Promise<ServiceEntity[]> {
    const links = await this.queryAll<ServiceVehicleEntity>({
      TableName: TABLE(),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pk': CatalogKeyBuilder.categoryPk(categoryId),
        ':prefix': CatalogKeyBuilder.vehicleApplicabilityPrefix(vehicleType),
      },
    });

    const services = await Promise.all(
      links.map((link) => this.findById(categoryId, link.serviceId)),
    );
    return services.filter(
      (service): service is ServiceEntity => service?.entityType === 'SERVICE',
    );
  }

  /**
   * List all services under a category filtered by duration (LSI5).
   */
  async listByDuration(
    categoryId: string,
    durationMinutes: number,
  ): Promise<ServiceEntity[]> {
    return this.queryAll<ServiceEntity>({
      TableName: TABLE(),
      IndexName: LSI5_INDEX,
      KeyConditionExpression: '#pk = :pk AND #lsi5sk = :lsi5sk',
      FilterExpression: 'entityType = :et',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#lsi5sk': 'LSI5SK',
      },
      ExpressionAttributeValues: {
        ':pk': CatalogKeyBuilder.categoryPk(categoryId),
        ':lsi5sk': CatalogKeyBuilder.lsi5sk(durationMinutes),
        ':et': 'SERVICE',
      },
    }).then((items) => items.map((item) => normalizeServiceEntity(item)));
  }

  /**
   * Search by name within a category (GSI1 — global name search).
   */
  async findByName(
    name: string,
    categoryId: string,
    vendorId: string,
  ): Promise<ServiceEntity | null> {
    const found = await this.queryOne<ServiceEntity>({
      TableName: TABLE(),
      IndexName: GSI1_INDEX,
      KeyConditionExpression: '#gsi1pk = :gsi1pk AND #gsi1sk = :gsi1sk',
      ExpressionAttributeNames: {
        '#gsi1pk': 'GSI1PK',
        '#gsi1sk': 'GSI1SK',
      },
      ExpressionAttributeValues: {
        ':gsi1pk': CatalogKeyBuilder.gsi1pk(name),
        ':gsi1sk': CatalogKeyBuilder.gsi1VendorCategorySk(
          'SERVICE',
          vendorId,
          categoryId,
        ),
      },
    });
    return found ? normalizeServiceEntity(found) : null;
  }

  /**
   * Count addons under a service (delete constraint check).
   */
  async countAddons(categoryId: string, serviceId: string): Promise<number> {
    const items = await this.queryAll<any>({
      TableName: TABLE(),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pk': CatalogKeyBuilder.categoryPk(categoryId),
        ':skPrefix': CatalogKeyBuilder.addonSkPrefix(serviceId),
      },
    });
    return items.length;
  }

  // ── Write operations ─────────────────────────────────────────────────────

  async createService(
    entity: ServiceEntity,
    discovery?: DiscoveryWritePlan,
  ): Promise<void> {
    const now = entity.updatedAt;
    await this.writeTransactChunks([
      putNew(entity),
      putNew(buildServiceLookup(entity, now)),
      ...entity.vehicleTypes.map((vehicleType) =>
        putNew(buildVehicleLink(entity, vehicleType, now)),
      ),
      ...discoveryTransactItems(discovery),
    ]);
  }

  async updateService(
    entity: ServiceEntity,
    previousVehicleTypes: readonly string[],
    discovery?: DiscoveryWritePlan,
  ): Promise<void> {
    const now = entity.updatedAt;
    const next = new Set(entity.vehicleTypes);
    const previous = new Set(previousVehicleTypes);
    const removed = [...previous].filter(
      (vehicleType) => !next.has(vehicleType),
    );
    const added = [...next].filter((vehicleType) => !previous.has(vehicleType));
    const kept = [...next].filter((vehicleType) => previous.has(vehicleType));

    await this.writeTransactChunks([
      putExisting(entity),
      putUpsert(buildServiceLookup(entity, now)),
      ...removed.map((vehicleType) =>
        deleteKey(
          CatalogKeyBuilder.categoryPk(entity.categoryId),
          CatalogKeyBuilder.vehicleApplicabilitySk(
            vehicleType,
            entity.serviceId,
          ),
        ),
      ),
      ...[...added, ...kept].map((vehicleType) =>
        putUpsert(buildVehicleLink(entity, vehicleType, now)),
      ),
      ...discoveryTransactItems(discovery),
    ]);
  }

  async deleteService(
    entity: ServiceEntity,
    discoveryKeys: ReadonlyArray<{ PK: string; SK: string }> = [],
  ): Promise<void> {
    await this.writeTransactChunks([
      {
        Delete: {
          TableName: TABLE(),
          Key: {
            PK: entity.PK,
            SK: entity.SK,
          },
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
        },
      },
      deleteKey(
        CatalogKeyBuilder.serviceLookupPk(entity.serviceId),
        CatalogKeyBuilder.serviceLookupSk(),
      ),
      ...entity.vehicleTypes.map((vehicleType) =>
        deleteKey(
          CatalogKeyBuilder.categoryPk(entity.categoryId),
          CatalogKeyBuilder.vehicleApplicabilitySk(
            vehicleType,
            entity.serviceId,
          ),
        ),
      ),
      ...discoveryKeys.map((key) => deleteKey(key.PK, key.SK)),
    ]);
  }

  async getDiscoveryItem(
    pk: string,
    sk: string,
  ): Promise<ServiceDiscoveryEntity | null> {
    const item = await this.get<ServiceDiscoveryEntity>(TABLE(), {
      PK: pk,
      SK: sk,
    });
    return item?.entityType === 'SERVICE_DISCOVERY' ? item : null;
  }

  async listDiscoveryPointers(
    serviceId: string,
  ): Promise<DiscoveryPointerEntity[]> {
    const items = await this.query<DiscoveryPointerEntity>({
      TableName: TABLE(),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pk': CatalogKeyBuilder.discoveryServicePk(serviceId),
        ':prefix': 'BRANCH#',
      },
    });
    return items.filter((item) => item.entityType === 'DISCOVERY_POINTER');
  }

  async getVendorDiscoveryState(
    vendorId: string,
  ): Promise<DiscoveryVendorState | null> {
    const item = await this.get<DiscoveryVendorState>(TABLE(), {
      PK: CatalogKeyBuilder.discoveryVendorPk(vendorId),
      SK: CatalogKeyBuilder.discoveryVendorSk(),
    });
    return item?.entityType === 'DISCOVERY_VENDOR_STATE' ? item : null;
  }

  async saveVendorDiscoveryState(
    state: DiscoveryVendorState,
  ): Promise<'saved' | 'skipped'> {
    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: TABLE(),
              Item: state,
              ConditionExpression:
                'attribute_not_exists(PK) OR reviewedAt <= :reviewedAt',
              ExpressionAttributeValues: { ':reviewedAt': state.reviewedAt },
            },
          },
        ],
      });
      return 'saved';
    } catch (error) {
      if (isConditionalWriteFailure(error)) {
        return 'skipped';
      }
      throw error;
    }
  }

  async listBranchDiscoveryStates(
    vendorId: string,
  ): Promise<DiscoveryBranchState[]> {
    const items = await this.query<DiscoveryBranchState>({
      TableName: TABLE(),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pk': CatalogKeyBuilder.discoveryBranchPk(vendorId),
        ':prefix': 'BRANCH#',
      },
    });
    return items.filter((item) => item.entityType === 'DISCOVERY_BRANCH_STATE');
  }

  async listPriceDiscoveryStates(
    vendorId: string,
  ): Promise<DiscoveryPriceState[]> {
    const items = await this.query<DiscoveryPriceState>({
      TableName: TABLE(),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pk': CatalogKeyBuilder.discoveryPricePk(vendorId),
        ':prefix': 'SERVICE#',
      },
    });
    return items.filter((item) => item.entityType === 'DISCOVERY_PRICE_STATE');
  }

  async saveBranchDiscoveryState(
    state: DiscoveryBranchState,
  ): Promise<'saved' | 'skipped'> {
    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: TABLE(),
              Item: state,
              ConditionExpression:
                'attribute_not_exists(PK) OR updatedAt <= :updatedAt',
              ExpressionAttributeValues: { ':updatedAt': state.updatedAt },
            },
          },
        ],
      });
      return 'saved';
    } catch (error) {
      if (isConditionalWriteFailure(error)) {
        return 'skipped';
      }
      throw error;
    }
  }

  async getPriceDiscoveryState(
    vendorId: string,
    serviceId: string,
  ): Promise<DiscoveryPriceState | null> {
    const item = await this.get<DiscoveryPriceState>(TABLE(), {
      PK: CatalogKeyBuilder.discoveryPricePk(vendorId),
      SK: CatalogKeyBuilder.discoveryPriceSk(serviceId),
    });
    return item?.entityType === 'DISCOVERY_PRICE_STATE' ? item : null;
  }

  async savePriceDiscoveryState(
    state: DiscoveryPriceState,
  ): Promise<'saved' | 'skipped'> {
    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: TABLE(),
              Item: state,
              ConditionExpression:
                'attribute_not_exists(PK) OR updatedAt <= :updatedAt',
              ExpressionAttributeValues: { ':updatedAt': state.updatedAt },
            },
          },
        ],
      });
      return 'saved';
    } catch (error) {
      if (isConditionalWriteFailure(error)) {
        return 'skipped';
      }
      throw error;
    }
  }

  async putDiscoveryPointer(pointer: DiscoveryPointerEntity): Promise<void> {
    await this.transactWrite({
      TransactItems: [putUpsert(pointer)],
    });
  }

  async deleteCatalogKey(pk: string, sk: string): Promise<void> {
    await this.transactWrite({
      TransactItems: [deleteKey(pk, sk)],
    });
  }

  /**
   * Writes one discovery item unless a newer source timestamp is already stored.
   * Does not modify the canonical SERVICE item.
   */
  async saveDiscoveryIfCurrent(
    item: ServiceDiscoveryEntity,
  ): Promise<'created' | 'updated' | 'skipped'> {
    const existing = await this.getDiscoveryItem(item.PK, item.SK);
    if (
      existing &&
      (discoveryWriteBlocked(existing, item) ||
        sameDiscoveryProjection(existing, item))
    ) {
      return 'skipped';
    }
    try {
      await this.transactWrite({
        TransactItems: [putDiscoveryFresh(item)],
      });
      return existing ? 'updated' : 'created';
    } catch (error) {
      if (isConditionalWriteFailure(error)) {
        return 'skipped';
      }
      throw error;
    }
  }

  /** Replaces discovery rows for one service. Does not modify the canonical SERVICE item. */
  async replaceDiscovery(plan: DiscoveryWritePlan): Promise<void> {
    await this.writeTransactChunks(discoveryTransactItems(plan));
  }

  /**
   * DynamoDB allows 25 items per TransactWrite. Discovery rows for several
   * branches are written after the canonical service items.
   */
  private async writeTransactChunks(
    items: NonNullable<TransactWriteCommandInput['TransactItems']>,
  ): Promise<void> {
    for (let index = 0; index < items.length; index += TRANSACT_ITEM_LIMIT) {
      await this.transactWrite({
        TransactItems: items.slice(index, index + TRANSACT_ITEM_LIMIT),
      });
    }
  }

  async ensureServiceVersion(entity: ServiceEntity): Promise<ServiceEntity> {
    if (isAuthoritativeCatalogVersion(entity.version)) {
      return entity;
    }
    try {
      await this.update({
        TableName: TABLE(),
        Key: { PK: entity.PK, SK: entity.SK },
        UpdateExpression: 'SET version = :initialVersion',
        ConditionExpression: 'attribute_not_exists(version)',
        ExpressionAttributeValues: {
          ':initialVersion': INITIAL_CATALOG_VERSION,
        },
      });
    } catch (error) {
      if (!isConditionalWriteFailure(error)) {
        throw error;
      }
    }
    const refreshed = await this.findById(entity.categoryId, entity.serviceId);
    return refreshed ?? entity;
  }
}

function putNew(item: object) {
  return {
    Put: {
      TableName: TABLE(),
      Item: item,
      ConditionExpression:
        'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    },
  };
}

function putExisting(item: object) {
  return {
    Put: {
      TableName: TABLE(),
      Item: item,
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    },
  };
}

function putUpsert(item: object) {
  return {
    Put: {
      TableName: TABLE(),
      Item: item,
    },
  };
}

function putDiscoveryFresh(item: ServiceDiscoveryEntity) {
  return {
    Put: {
      TableName: TABLE(),
      Item: item,
      ConditionExpression: DISCOVERY_FRESHNESS_CONDITION,
      ExpressionAttributeValues: discoveryFreshnessValues(item),
    },
  };
}

function discoveryTransactItems(plan: DiscoveryWritePlan | undefined) {
  if (!plan) {
    return [];
  }
  return [
    ...plan.deletes.map((key) => deleteKey(key.PK, key.SK)),
    ...plan.items.map((item) => putDiscoveryFresh(item)),
    ...plan.pointers.map((pointer) => putUpsert(pointer)),
  ];
}

function deleteKey(pk: string, sk: string) {
  return {
    Delete: {
      TableName: TABLE(),
      Key: { PK: pk, SK: sk },
    },
  };
}

function buildServiceLookup(
  entity: ServiceEntity,
  now: string,
): ServiceLookupEntity {
  return {
    PK: CatalogKeyBuilder.serviceLookupPk(entity.serviceId),
    SK: CatalogKeyBuilder.serviceLookupSk(),
    entityType: 'SERVICE_LOOKUP',
    vendorId: entity.vendorId,
    categoryId: entity.categoryId,
    serviceId: entity.serviceId,
    active: entity.active,
    createdAt: entity.createdAt,
    updatedAt: now,
  };
}

function buildVehicleLink(
  entity: ServiceEntity,
  vehicleType: string,
  now: string,
): ServiceVehicleEntity {
  return {
    PK: CatalogKeyBuilder.categoryPk(entity.categoryId),
    SK: CatalogKeyBuilder.vehicleApplicabilitySk(vehicleType, entity.serviceId),
    entityType: 'SERVICE_VEHICLE',
    categoryId: entity.categoryId,
    serviceId: entity.serviceId,
    vehicleType,
    active: entity.active,
    LSI4SK: CatalogKeyBuilder.lsi4sk(vehicleType),
    createdAt: entity.createdAt,
    updatedAt: now,
  };
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let repository: ServicesRepository;

export function getServicesRepository() {
  if (!repository) {
    repository = new ServicesRepository();
  }

  return repository;
}
