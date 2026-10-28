import {
  ConditionalWriteConflictError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';

import {
  assertActiveDirectoryCommunities,
  buildOfferingCommunity,
  buildServiceCreatePuts,
  buildServiceIdempotency,
  CatalogPut,
  effectiveApprovalStatus,
  initialApprovalStatus,
  legacyApprovalPut,
  legacyPendingMapping,
  nextApproval,
  nextMappingStatus,
  nextServiceActive,
  normalizeCommunityIds,
  OfferingCommunityView,
  toCommunityView,
  versionedPut,
} from '../domain/offering-community';
import {
  CommunityDirectorySource,
  getCommunityDirectorySource,
} from '../integrations/community-directory';
import {
  getVendorCoverageSource,
  VendorCoverageSource,
} from '../integrations/vendor-coverage';
import {
  getOfferingCommunitiesRepository,
  OfferingCommunitiesRepository,
} from '../repositories/offering-communities.repository';
import {
  buildServiceLookup,
  buildVehicleLink,
  getServicesRepository,
  ServicesRepository,
} from '../repositories/services.repository';
import {
  getCatalogOfferingsRepository,
  CatalogOfferingsRepository,
} from '../repositories/catalog-offerings.repository';
import { paiseToRupees } from '../domain/catalog-validation';
import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';
import {
  OFFERING_COMMUNITY_APPROVAL,
  OFFERING_COMMUNITY_STATUS,
  OfferingCommunityApprovalStatus,
  OfferingCommunityEntity,
  OfferingCommunityStatus,
  ServiceEntity,
} from '../utils/types/catalog-domain.types';

const STATUS_RETRIES = 3;

export interface PreparedServiceCreate {
  replay?: { serviceId: string; categoryId: string };
  puts: CatalogPut[];
}

export interface BackfillReport {
  vendorId: string;
  dryRun: boolean;
  legacyApproval: 'preserve' | 'pending';
  activeServices: number;
  inactiveServices: number;
  mappingsCreated: number;
  mappingsSkipped: number;
  activeMappings: number;
  inactiveMappings: number;
  /** Existing rows that have no approvalStatus. */
  legacyMissingApproval: number;
  /** Rows this run marked pending. Zero when legacyApproval is preserve. */
  legacyMarkedPending: number;
}

export class OfferingCommunitiesService {
  constructor(
    private readonly communities: OfferingCommunitiesRepository = getOfferingCommunitiesRepository(),
    private readonly services: ServicesRepository = getServicesRepository(),
    private readonly offerings: CatalogOfferingsRepository = getCatalogOfferingsRepository(),
    private readonly directory: CommunityDirectorySource = getCommunityDirectorySource(),
    private readonly coverage: VendorCoverageSource = getVendorCoverageSource(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async listViews(serviceId: string, consistent = false): Promise<OfferingCommunityView[]> {
    const mappings = await this.communities.listByService(serviceId, consistent);
    return mappings
      .sort((left, right) => left.communityId.localeCompare(right.communityId))
      .map(toCommunityView);
  }

  async prepareCreate(input: {
    service: ServiceEntity;
    communityIds: readonly string[];
    idempotencyKey?: string;
  }): Promise<PreparedServiceCreate> {
    const communityIds = normalizeCommunityIds(input.communityIds);
    if (communityIds.length > 0 && !input.idempotencyKey) {
      throw new ValidationError('Idempotency-Key header is required');
    }
    if (input.idempotencyKey) {
      const existing = await this.communities.getIdempotency(
        input.service.vendorId,
        input.idempotencyKey,
      );
      if (existing) {
        if (existing.vendorId !== input.service.vendorId) {
          throw new ConflictError('Idempotency key is already in use');
        }
        return { replay: { serviceId: existing.serviceId, categoryId: existing.categoryId }, puts: [] };
      }
    }
    if (communityIds.length > 0) {
      const active = await this.directory.activeCommunityIds(communityIds);
      assertActiveDirectoryCommunities(communityIds, active);
    }
    const timestamp = input.service.createdAt;
    const approvalStatus = initialApprovalStatus();
    const mappings = communityIds.map((communityId) => buildOfferingCommunity({
      service: input.service,
      communityId,
      status: OFFERING_COMMUNITY_STATUS.ACTIVE,
      approvalStatus,
      now: timestamp,
    }));
    return {
      puts: buildServiceCreatePuts({
        service: input.service,
        lookup: buildServiceLookup(input.service, timestamp),
        vehicles: input.service.vehicleTypes.map((vehicleType) =>
          buildVehicleLink(input.service, vehicleType, timestamp)),
        mappings,
        ...(input.idempotencyKey
          ? {
              idempotency: buildServiceIdempotency({
                vendorId: input.service.vendorId,
                serviceId: input.service.serviceId,
                categoryId: input.service.categoryId,
                idempotencyKey: input.idempotencyKey,
                now: timestamp,
              }),
            }
          : {}),
      }),
    };
  }

  async commitCreate(puts: readonly CatalogPut[]): Promise<void> {
    await this.communities.commitWrites(puts);
  }

  async replayAfterConflict(
    vendorId: string,
    idempotencyKey: string | undefined,
  ): Promise<{ serviceId: string; categoryId: string } | undefined> {
    if (!idempotencyKey) {
      return undefined;
    }
    const existing = await this.communities.getIdempotency(vendorId, idempotencyKey);
    return existing
      ? { serviceId: existing.serviceId, categoryId: existing.categoryId }
      : undefined;
  }

  async addCommunities(service: ServiceEntity, communityIds: readonly string[]): Promise<OfferingCommunityView[]> {
    const ids = normalizeCommunityIds(communityIds);
    if (ids.length === 0) {
      throw new ValidationError('communityIds is required');
    }
    const active = await this.directory.activeCommunityIds(ids);
    assertActiveDirectoryCommunities(ids, active);
    const existing = await this.communities.listByService(service.serviceId, true);
    const known = new Set(existing.map((mapping) => mapping.communityId));
    const missing = ids.filter((communityId) => !known.has(communityId));
    if (existing.length + missing.length > 25) {
      throw new ValidationError('A service can be offered in at most 25 communities');
    }
    if (missing.length > 0) {
      const timestamp = this.now();
      const approvalStatus = initialApprovalStatus();
      const puts = missing.map((communityId) => ({
        item: buildOfferingCommunity({
          service,
          communityId,
          status: OFFERING_COMMUNITY_STATUS.ACTIVE,
          approvalStatus,
          now: timestamp,
        }) as unknown as Record<string, unknown>,
        condition: 'absent' as const,
      }));
      try {
        await this.communities.commitWrites(puts);
      } catch (error) {
        if (!(error instanceof ConditionalWriteConflictError)) {
          throw error;
        }
      }
    }
    return this.listViews(service.serviceId, true);
  }

  async setStatus(
    service: ServiceEntity,
    communityId: string,
    status: OfferingCommunityStatus,
    expectedVersion: number,
  ): Promise<OfferingCommunityView> {
    const id = normalizeCommunityIds([communityId])[0];
    const current = await this.communities.getMapping(service.serviceId, id, true);
    if (!current || current.vendorId !== service.vendorId) {
      throw new NotFoundError(`Community mapping not found: ${id}`);
    }
    if (current.version !== expectedVersion) {
      throw new ConflictError('Community mapping was modified concurrently. Please retry.');
    }
    const next = nextMappingStatus(
      { ...current, serviceActive: service.active },
      status,
      this.now(),
    );
    try {
      await this.communities.commitWrites([versionedPut(next)]);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Community mapping was modified concurrently. Please retry.');
      }
      throw error;
    }
    return toCommunityView(next);
  }

  async remove(service: ServiceEntity, communityId: string): Promise<{ deleted: true; communityId: string }> {
    const id = normalizeCommunityIds([communityId])[0];
    const current = await this.communities.getMapping(service.serviceId, id, true);
    if (!current) {
      return { deleted: true, communityId: id };
    }
    if (current.vendorId !== service.vendorId) {
      throw new NotFoundError(`Community mapping not found: ${id}`);
    }
    try {
      await this.communities.commitWrites([{ kind: 'delete', PK: current.PK, SK: current.SK }]);
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError)) {
        throw error;
      }
    }
    return { deleted: true, communityId: id };
  }

  /**
   * Admin decision. Operational status is left as the vendor set it.
   * A rejected mapping stays rejected until this method records a new decision.
   */
  async setApproval(
    serviceId: string,
    communityId: string,
    approvalStatus: OfferingCommunityApprovalStatus,
    expectedVersion: number,
    actor: string,
  ): Promise<OfferingCommunityView> {
    const id = normalizeCommunityIds([communityId])[0];
    const service = await this.services.findByServiceId(serviceId, true);
    if (!service) {
      throw new NotFoundError(`Service not found: ${serviceId}`);
    }
    const current = await this.communities.getMapping(service.serviceId, id, true);
    if (!current || current.vendorId !== service.vendorId) {
      throw new NotFoundError(`Community mapping not found: ${id}`);
    }
    if (current.version !== expectedVersion) {
      throw new ConflictError('Community mapping was modified concurrently. Please retry.');
    }
    const next = nextApproval(
      { ...current, serviceActive: service.active },
      approvalStatus,
      actor,
      this.now(),
    );
    try {
      await this.communities.commitWrites([versionedPut(next)]);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Community mapping was modified concurrently. Please retry.');
      }
      throw error;
    }
    return toCommunityView(next);
  }

  /**
   * Offering-wide active changes index membership only.
   * Mapping status and approval status stay as they were.
   */
  async syncServiceActive(service: ServiceEntity): Promise<void> {
    for (let attempt = 0; attempt < STATUS_RETRIES; attempt += 1) {
      const mappings = await this.communities.listByService(service.serviceId, true);
      const changed = mappings.filter((mapping) => mapping.serviceActive !== service.active);
      if (changed.length === 0) {
        return;
      }
      const timestamp = this.now();
      try {
        await this.communities.commitWrites(changed.map((mapping) =>
          versionedPut(nextServiceActive(mapping, service.active, timestamp))));
        return;
      } catch (error) {
        if (!(error instanceof ConditionalWriteConflictError) || attempt === STATUS_RETRIES - 1) {
          if (error instanceof ConditionalWriteConflictError) {
            throw new ConflictError('Community mappings changed while the service was updated. Please retry.');
          }
          throw error;
        }
      }
    }
  }

  /**
   * Creates missing mappings for communities the vendor already covers, after
   * those ids are confirmed in the platform directory. Existing mappings,
   * including rejected and paused rows, are not rewritten.
   * `legacyApproval: pending` is the only path that fills a missing
   * approvalStatus, and it always stores pending.
   */
  async backfillVendor(
    vendorId: string,
    dryRun: boolean,
    legacyApproval: 'preserve' | 'pending' = 'preserve',
  ): Promise<BackfillReport> {
    const covered = await this.coverage.activeCommunityIds(vendorId);
    const communityIds = covered.length > 0 ? normalizeCommunityIds(covered) : [];
    const directoryActive = new Set(
      communityIds.length > 0 ? await this.directory.activeCommunityIds(communityIds) : [],
    );
    const eligible = communityIds.filter((communityId) => directoryActive.has(communityId));
    let activeServices = 0;
    let inactiveServices = 0;
    let mappingsCreated = 0;
    let mappingsSkipped = communityIds.length - eligible.length;
    let legacyMissingApproval = 0;
    let legacyMarkedPending = 0;
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const page = await this.services.listByVendor(vendorId, { limit: 25, lastEvaluatedKey });
      for (const service of page.items) {
        if (service.active) {
          activeServices += 1;
        } else {
          inactiveServices += 1;
        }
        const existing = await this.communities.listByService(service.serviceId, true);
        const legacy = await this.fillMissingApproval(existing, dryRun, legacyApproval);
        legacyMissingApproval += legacy.missing;
        legacyMarkedPending += legacy.marked;
        const known = new Set(existing.map((mapping) => mapping.communityId));
        const missing = eligible.filter((communityId) => !known.has(communityId));
        mappingsSkipped += eligible.length - missing.length;
        if (missing.length === 0) {
          continue;
        }
        const timestamp = this.now();
        const approvalStatus = initialApprovalStatus();
        const puts = missing.map((communityId) => ({
          item: buildOfferingCommunity({
            service,
            communityId,
            status: service.active ? OFFERING_COMMUNITY_STATUS.ACTIVE : OFFERING_COMMUNITY_STATUS.INACTIVE,
            approvalStatus,
            now: timestamp,
          }) as unknown as Record<string, unknown>,
          condition: 'absent' as const,
        }));
        if (!dryRun) {
          try {
            await this.communities.commitWrites(puts);
          } catch (error) {
            if (!(error instanceof ConditionalWriteConflictError)) {
              throw error;
            }
            mappingsSkipped += missing.length;
            continue;
          }
        }
        mappingsCreated += missing.length;
      }
      lastEvaluatedKey = page.lastEvaluatedKey;
    } while (lastEvaluatedKey);

    let activeMappings = 0;
    let inactiveMappings = 0;
    if (!dryRun) {
      lastEvaluatedKey = undefined;
      do {
        const page = await this.services.listByVendor(vendorId, { limit: 25, lastEvaluatedKey });
        for (const service of page.items) {
          const mappings = await this.communities.listByService(service.serviceId, true);
          for (const mapping of mappings) {
            if (
              mapping.status === OFFERING_COMMUNITY_STATUS.ACTIVE
              && mapping.serviceActive
              && effectiveApprovalStatus(mapping) === OFFERING_COMMUNITY_APPROVAL.APPROVED
              && mapping.GSI3PK
            ) {
              activeMappings += 1;
            } else {
              inactiveMappings += 1;
            }
          }
        }
        lastEvaluatedKey = page.lastEvaluatedKey;
      } while (lastEvaluatedKey);
    }

    return {
      vendorId,
      dryRun,
      legacyApproval,
      activeServices,
      inactiveServices,
      mappingsCreated,
      mappingsSkipped,
      activeMappings,
      inactiveMappings,
      legacyMissingApproval,
      legacyMarkedPending,
    };
  }

  private async fillMissingApproval(
    mappings: readonly OfferingCommunityEntity[],
    dryRun: boolean,
    legacyApproval: 'preserve' | 'pending',
  ): Promise<{ missing: number; marked: number }> {
    let missing = 0;
    let marked = 0;
    for (const mapping of mappings) {
      if (hasStoredApproval(mapping)) {
        continue;
      }
      missing += 1;
      if (legacyApproval !== 'pending') {
        continue;
      }
      const next = legacyPendingMapping(mapping, this.now());
      if (!dryRun) {
        try {
          await this.communities.commitWrites([legacyApprovalPut(next)]);
        } catch (error) {
          if (!(error instanceof ConditionalWriteConflictError)) {
            throw error;
          }
          continue;
        }
      }
      marked += 1;
    }
    return { missing, marked };
  }

  async requireOwnedService(
    serviceId: string,
    vendorId: string,
  ): Promise<ServiceEntity> {
    const service = await this.services.findByServiceId(serviceId, true);
    if (service && service.vendorId === vendorId) {
      return service;
    }

    const offering = await this.offerings.findById(serviceId, true);
    if (offering && offering.vendorId === vendorId) {
      return {
        PK: CatalogKeyBuilder.categoryPk(offering.categoryId),
        SK: CatalogKeyBuilder.serviceSk(offering.offeringId),
        entityType: 'SERVICE',
        vendorId: offering.vendorId,
        categoryId: offering.categoryId,
        serviceId: offering.offeringId,
        name: offering.name,
        description: offering.description,
        vehiclePricing: offering.vehiclePricing.map((entry) => ({
          vehicleType: entry.vehicleType,
          price: paiseToRupees(entry.price),
          durationMinutes: entry.durationMinutes,
        })),
        durationMinutes: offering.durationMinutes,
        vehicleTypes: [...offering.vehicleTypes],
        basePrice: paiseToRupees(offering.basePrice),
        displayOrder: offering.displayOrder,
        active: offering.active,
        version: offering.version,
        createdAt: offering.createdAt,
        updatedAt: offering.updatedAt,
      };
    }

    throw new NotFoundError(`Offering not found: ${serviceId}`);
  }
}

function hasStoredApproval(mapping: OfferingCommunityEntity): boolean {
  return mapping.approvalStatus === OFFERING_COMMUNITY_APPROVAL.PENDING
    || mapping.approvalStatus === OFFERING_COMMUNITY_APPROVAL.APPROVED
    || mapping.approvalStatus === OFFERING_COMMUNITY_APPROVAL.REJECTED;
}

export function assertMappingStatus(value: unknown): OfferingCommunityStatus {
  if (value === OFFERING_COMMUNITY_STATUS.ACTIVE || value === OFFERING_COMMUNITY_STATUS.INACTIVE) {
    return value;
  }
  throw new ValidationError('status must be active or inactive');
}

export function assertApprovalStatus(value: unknown): OfferingCommunityApprovalStatus {
  if (value === OFFERING_COMMUNITY_APPROVAL.APPROVED || value === OFFERING_COMMUNITY_APPROVAL.REJECTED) {
    return value;
  }
  throw new ValidationError('approvalStatus must be approved or rejected');
}

export function assertMappingVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ValidationError('version must be a positive integer');
  }
  return value;
}

let service: OfferingCommunitiesService | undefined;

export function getOfferingCommunitiesService(): OfferingCommunitiesService {
  if (!service) {
    service = new OfferingCommunitiesService();
  }
  return service;
}
