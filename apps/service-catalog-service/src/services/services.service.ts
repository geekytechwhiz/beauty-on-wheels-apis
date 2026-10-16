import { randomUUID } from "crypto";

import { LambdaRequest, ValidationError } from "@api-hub/utils";
import {
    ConflictError,
    NotFoundError,
    BusinessRuleError,
    ConditionalWriteConflictError,
} from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    ServicesRepository,
    getServicesRepository
} from "../repositories/services.repository";
import {
    CategoriesRepository,
    getCategoriesRepository
} from "../repositories/categories.repository";
import {
    CreateServiceInput,
    UpdateServiceInput,
    validateService,
    validateServiceUpdate,
} from "../schemas/services.schema";
import { INITIAL_CATALOG_VERSION, nextCatalogVersion, sameMembers } from "../domain/catalog-version";
import {
    buildDiscoveryWritePlan,
    parseDiscoverServicesQuery,
    vendorStatusIsApproved,
} from "../domain/discovery-projection";
import { assertVendorOwner, requireVendorId } from "../domain/vendor-scope";
import { CatalogKeyBuilder } from "../utils/constants/catalog-key-builder";
import { ServiceEntity } from "../utils/types/catalog-domain.types";
import { DiscoveryPage } from "../types/api-types";
import {
    DiscoveryBranchState,
    DiscoveryPriceState,
    DiscoveryVendorState,
    DiscoveryWritePlan,
} from "../types/service-discovery.types";
import { mapDiscoveryEntityToResponse } from "../utils/helpers/catalog-admin";
import { persistDiscoveryFacts } from "../discovery/persist-discovery-facts";
import {
    DiscoveryFactsSource,
    getDiscoveryFactsSource,
} from "../integrations/vendor-discovery-facts";

const baseLogger = createLogger({
    service: "services-service",
    redactPII: true,
});

export class ServicesService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'ServicesService',
  });

  constructor(
    private readonly repository: ServicesRepository = getServicesRepository(),

    private readonly categoriesRepository: CategoriesRepository = getCategoriesRepository(),

    private readonly discoveryFacts: DiscoveryFactsSource | null = getDiscoveryFactsSource(),
  ) {}

  async discoverServices(query: unknown): Promise<DiscoveryPage> {
    const parsed = parseDiscoverServicesQuery(query);
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
      limit = 20,
      nextToken,
    } = parsed;

    const normalizedSearch = search?.trim().toLowerCase();

    this.logger.info({
      event: 'discoverservices_start',
      categoryId,
      vehicleType,
      sortBy,
      hasSearch: Boolean(normalizedSearch),
    });

    if (categoryId) {
      const category = await this.categoriesRepository.findById(categoryId);

      if (!category || !category.active) {
        throw new NotFoundError(`Active category not found: ${categoryId}`);
      }
    }

    // The repository must filter, rank, and paginate
    // across all eligible vendors BEFORE returning.
    const result = await this.repository.searchDiscovery({
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
      limit,
      nextToken,
    });


    const items = result.items.map(mapDiscoveryEntityToResponse);

    this.logger.info({
      event: 'discoverservices_success',
      count: items.length,
      hasMore: Boolean(result.nextToken),
      sortBy,
    });

    return {
      items,
      nextToken: result.nextToken,
      hasMore: Boolean(result.nextToken),
    };
  }


  async getservices(request: LambdaRequest) {
    this.logger.info({
      event: 'getservices_start',
    });

    const vendorId = requireVendorId(request.params?.vendorId);
    const categoryId = request.params?.categoryId as string | undefined;
    const activeOnly = request.params?.active === 'true';
    const vehicleType = request.params?.vehicleType as string | undefined;
    const durationMinutes = request.params?.durationMinutes
      ? parseInt(request.params.durationMinutes as string, 10)
      : undefined;
    const limit = request.params?.limit
      ? parseInt(request.params.limit as string, 10)
      : undefined;
    const lastEvaluatedKey = request.params?.nextToken
      ? JSON.parse(
          Buffer.from(request.params.nextToken as string, 'base64').toString(),
        )
      : undefined;

    if (categoryId) {
      const category = await this.categoriesRepository.findById(categoryId);
      if (!category) {
        throw new NotFoundError(`Category not found: ${categoryId}`);
      }
    }

    const result = await this.repository.listByVendor(vendorId, {
      categoryId,
      activeOnly,
      vehicleType,
      durationMinutes,
      limit,
      lastEvaluatedKey,
    });

    const items = result.items.map(mapServiceEntityToResponse);

    this.logger.info({
      event: 'getservices_success',
      vendorId,
      categoryId,
      count: items.length,
    });

    return {
      items,
      nextToken: result.lastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString(
            'base64',
          )
        : undefined,
      total: items.length,
    };
  }

 

  async postservices(request: LambdaRequest) {
    this.logger.info({
      event: 'postservices_start',
    });

    const body = validateService(request);

    // Validate parent category exists
    const category = await this.categoriesRepository.findById(body.categoryId);
    if (!category) {
      throw new NotFoundError(`Category not found: ${body.categoryId}`);
    }
    if (!category.active) {
      throw new ConflictError(`Category is not active: ${body.categoryId}`);
    }

    await this.assertServiceNameUnique(
      body.name,
      body.categoryId,
      body.vendorId,
    );

    const now = new Date().toISOString();
    const serviceId = randomUUID();

    const entity = buildServiceEntity(serviceId, body, now);

    try {
      await this.repository.createService(entity, await this.discoveryPlan(entity));
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        this.logger.warn({
          event: 'postservices_conflict',
          serviceId,
        });
        throw new ConflictError(
          'A service with this name already exists in the category',
        );
      }

      this.logger.error({
        event: 'postservices_error',
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    }

    this.logger.info({
      event: 'postservices_success',
      serviceId,
    });

    return mapServiceEntityToResponse(entity);
  }

  async getserviceid(request: LambdaRequest) {
    const serviceId = request.params?.serviceId as string;
    const categoryId = request.params?.categoryId as string | undefined;
    const vendorId = requireVendorId(request.params?.vendorId);

    this.logger.info({
      event: 'getserviceid_start',
      serviceId,
      categoryId,
      vendorId,
    });

    const entity = await this.loadOwnedService(serviceId, vendorId, categoryId);

    this.logger.info({
      event: 'getserviceid_success',
      serviceId,
    });

    return mapServiceEntityToResponse(entity);
  }

  async putserviceid(request: LambdaRequest) {
    const serviceId = request.params?.serviceId as string;
    const categoryId = request.params?.categoryId as string | undefined;
    const vendorId = requireVendorId(request.params?.vendorId);

    this.logger.info({
      event: 'putserviceid_start',
      serviceId,
      categoryId,
      vendorId,
    });

    const body = validateServiceUpdate(request);

    const existing = await this.loadOwnedService(
      serviceId,
      vendorId,
      categoryId,
    );

    if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertServiceNameUnique(
        body.name,
        existing.categoryId,
        vendorId,
      );
    }

    if (body.active === true && existing.active === false) {
      const category = await this.categoriesRepository.findById(
        existing.categoryId,
      );
      if (!category) {
        throw new NotFoundError(`Category not found: ${existing.categoryId}`);
      }
      if (!category.active) {
        throw new ConflictError(
          `Category is not active: ${existing.categoryId}`,
        );
      }
    }

    const now = new Date().toISOString();
    const updated = mergeServiceEntity(existing, body, now);

    try {
      await this.repository.updateService(
        updated,
        existing.vehicleTypes,
        await this.discoveryPlan(updated),
      );
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        this.logger.warn({
          event: 'putserviceid_conflict',
          serviceId,
        });
        throw new ConflictError(
          'Service was modified concurrently. Please retry.',
        );
      }

      this.logger.error({
        event: 'putserviceid_error',
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    }

    this.logger.info({
      event: 'putserviceid_success',
      serviceId,
    });

    return mapServiceEntityToResponse(updated);
  }

  async deleteserviceid(request: LambdaRequest) {
    const serviceId = request.params?.serviceId as string;
    const categoryId = request.params?.categoryId as string | undefined;
    const vendorId = requireVendorId(request.params?.vendorId);

    this.logger.info({
      event: 'deleteserviceid_start',
      serviceId,
      categoryId,
      vendorId,
    });

    const existing = await this.loadOwnedService(
      serviceId,
      vendorId,
      categoryId,
    );

    const addonCount = await this.repository.countAddons(
      existing.categoryId,
      serviceId,
    );
    if (addonCount > 0) {
      throw new BusinessRuleError(
        `Cannot delete service: ${addonCount} add-on(s) are still linked to this service`,
      );
    }

    try {
      const plan = await this.discoveryPlan(existing);
      await this.repository.deleteService(existing, discoveryKeys(plan));
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        this.logger.warn({
          event: 'deleteserviceid_conflict',
          serviceId,
        });
        throw new NotFoundError(`Service not found: ${serviceId}`);
      }

      this.logger.error({
        event: 'deleteserviceid_error',
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    }

    this.logger.info({
      event: 'deleteserviceid_success',
      serviceId,
    });

    return { deleted: true, serviceId };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async loadOwnedService(
    serviceId: string,
    vendorId: string,
    categoryId?: string,
  ): Promise<ServiceEntity> {
    const entity = categoryId
      ? await this.repository.findById(categoryId, serviceId)
      : await this.repository.findByServiceId(serviceId);
    if (!entity) {
      throw new NotFoundError(`Service not found: ${serviceId}`);
    }
    assertVendorOwner(entity.vendorId, vendorId, 'Service', serviceId);
    return entity;
  }

  /**
   * Records vendor approval from VendorApproved, VendorRejected, or VendorSuspended.
   * Refreshes discovery rows for that vendor. Does not rewrite canonical services.
   */
  async applyVendorLifecycle(input: {
    vendorId: string;
    newStatus: string;
    reviewedAt: string;
  }): Promise<void> {
    const state: DiscoveryVendorState = {
      PK: CatalogKeyBuilder.discoveryVendorPk(input.vendorId),
      SK: CatalogKeyBuilder.discoveryVendorSk(),
      entityType: 'DISCOVERY_VENDOR_STATE',
      vendorId: input.vendorId,
      approved: vendorStatusIsApproved(input.newStatus),
      reviewedAt: input.reviewedAt,
      updatedAt: input.reviewedAt,
    };
    const outcome = await this.repository.saveVendorDiscoveryState(state);
    this.logger.info({
      event: 'discovery_vendor_lifecycle_applied',
      vendorId: input.vendorId,
      approved: state.approved,
      outcome,
    });
    let synced = false;
    try {
      synced = await this.syncDiscoveryFromVendor(input.vendorId);
    } catch (error) {
      this.logger.warn({
        event: 'discovery_facts_unavailable',
        vendorId: input.vendorId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (!synced && outcome === 'saved') {
      await this.refreshVendorDiscovery(input.vendorId);
    }
  }

  /**
   * Reloads approval, branches, coverage, and prices from Vendor Service,
   * then rebuilds projections. Returns false when that function is not configured.
   */
  async syncDiscoveryFromVendor(vendorId: string): Promise<boolean> {
    if (!this.discoveryFacts) {
      return false;
    }
    const snapshot = await this.discoveryFacts.load(vendorId);
    if (!snapshot) {
      this.logger.warn({
        event: 'discovery_facts_unconfigured',
        vendorId,
      });
      return false;
    }
    await persistDiscoveryFacts(this.repository, snapshot);
    await this.refreshVendorDiscovery(vendorId);
    return true;
  }

  /**
   * Records branch coverage. Operational is taken from the caller.
   * A missing or inactive branch is stored as not operational.
   */
  async applyBranchCoverage(input: {
    vendorId: string;
    branchId: string;
    operational: boolean;
    latitude?: number;
    longitude?: number;
    serviceRadiusKm?: number;
    updatedAt: string;
  }): Promise<void> {
    const branchId = input.branchId.trim();
    if (!branchId) {
      throw new ValidationError('branchId is required');
    }
    const state: DiscoveryBranchState = {
      PK: CatalogKeyBuilder.discoveryBranchPk(input.vendorId),
      SK: CatalogKeyBuilder.discoveryBranchSk(branchId),
      entityType: 'DISCOVERY_BRANCH_STATE',
      vendorId: input.vendorId,
      branchId,
      operational: input.operational === true,
      ...(input.latitude === undefined ? {} : { latitude: input.latitude }),
      ...(input.longitude === undefined ? {} : { longitude: input.longitude }),
      ...(input.serviceRadiusKm === undefined ? {} : { serviceRadiusKm: input.serviceRadiusKm }),
      updatedAt: input.updatedAt,
    };
    const outcome = await this.repository.saveBranchDiscoveryState(state);
    this.logger.info({
      event: 'discovery_branch_coverage_applied',
      vendorId: input.vendorId,
      branchId,
      operational: state.operational,
      outcome,
    });
    if (outcome === 'saved') {
      await this.refreshVendorDiscovery(input.vendorId);
    }
  }

  /**
   * Records a provider price override for one service and refreshes its discovery rows.
   */
  async applyServicePrice(input: {
    vendorId: string;
    serviceId: string;
    enabled: boolean;
    priceOverride?: number;
    updatedAt: string;
  }): Promise<void> {
    const state: DiscoveryPriceState = {
      PK: CatalogKeyBuilder.discoveryPricePk(input.vendorId),
      SK: CatalogKeyBuilder.discoveryPriceSk(input.serviceId),
      entityType: 'DISCOVERY_PRICE_STATE',
      vendorId: input.vendorId,
      serviceId: input.serviceId,
      enabled: input.enabled,
      ...(input.priceOverride === undefined ? {} : { priceOverride: input.priceOverride }),
      updatedAt: input.updatedAt,
    };
    const outcome = await this.repository.savePriceDiscoveryState(state);
    this.logger.info({
      event: 'discovery_price_applied',
      vendorId: input.vendorId,
      serviceId: input.serviceId,
      enabled: state.enabled,
      outcome,
    });
    if (outcome !== 'saved') {
      return;
    }
    const service = await this.repository.findByServiceId(input.serviceId);
    if (!service || service.vendorId !== input.vendorId) {
      return;
    }
    await this.repository.replaceDiscovery(await this.discoveryPlan(service));
  }

  private async discoveryPlan(service: ServiceEntity): Promise<DiscoveryWritePlan> {
    await this.rememberDiscoveryFacts(service.vendorId);
    const [vendor, branches, price, existingPointers] = await Promise.all([
      this.repository.getVendorDiscoveryState(service.vendorId),
      this.repository.listBranchDiscoveryStates(service.vendorId),
      this.repository.getPriceDiscoveryState(service.vendorId, service.serviceId),
      this.repository.listDiscoveryPointers(service.serviceId),
    ]);
    return buildDiscoveryWritePlan({
      service,
      vendor,
      branches,
      price,
      existingPointers,
    });
  }

  /** Best-effort copy of vendor facts. Catalog writes still succeed when Vendor Service is down. */
  private async rememberDiscoveryFacts(vendorId: string): Promise<void> {
    if (!this.discoveryFacts) {
      return;
    }
    try {
      const snapshot = await this.discoveryFacts.load(vendorId);
      if (snapshot) {
        await persistDiscoveryFacts(this.repository, snapshot);
      }
    } catch (error) {
      this.logger.warn({
        event: 'discovery_facts_unavailable',
        vendorId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async refreshVendorDiscovery(vendorId: string): Promise<void> {
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const page = await this.repository.listByVendor(vendorId, {
        limit: 25,
        lastEvaluatedKey,
      });
      for (const service of page.items) {
        try {
          await this.repository.replaceDiscovery(await this.discoveryPlan(service));
        } catch (error) {
          if (error instanceof ConditionalWriteConflictError) {
            this.logger.warn({
              event: 'discovery_refresh_skipped',
              vendorId,
              serviceId: service.serviceId,
            });
            continue;
          }
          this.logger.error({
            event: 'discovery_refresh_failed',
            vendorId,
            serviceId: service.serviceId,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }
      lastEvaluatedKey = page.lastEvaluatedKey;
    } while (lastEvaluatedKey);
  }

  private async assertServiceNameUnique(
    name: string,
    categoryId: string,
    vendorId: string,
  ): Promise<void> {
    const duplicate = await this.repository.findByName(
      name,
      categoryId,
      vendorId,
    );
    if (duplicate) {
      throw new ConflictError(
        `A service named "${name}" already exists in this category for this vendor`,
      );
    }
  }
}

// ── Mapper ─────────────────────────────────────────────────────────────────────

function discoveryKeys(plan: DiscoveryWritePlan): Array<{ PK: string; SK: string }> {
    const keys = [
        ...plan.items.map((item) => ({ PK: item.PK, SK: item.SK })),
        ...plan.pointers.map((pointer) => ({ PK: pointer.PK, SK: pointer.SK })),
        ...plan.deletes,
    ];
    const seen = new Set<string>();
    return keys.filter((key) => {
        const id = `${key.PK}|${key.SK}`;
        if (seen.has(id)) {
            return false;
        }
        seen.add(id);
        return true;
    });
}

function mapServiceEntityToResponse(entity: ServiceEntity) {
    return {
        id: entity.serviceId,
        vendorId: entity.vendorId,
        categoryId: entity.categoryId,
        name: entity.name,
        description: entity.description,
        durationMinutes: entity.durationMinutes,
        vehicleTypes: entity.vehicleTypes,
        basePrice: entity.basePrice,
        displayOrder: entity.displayOrder,
        active: entity.active,
        ...(entity.version !== undefined ? { version: entity.version } : {}),
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
    };
}

// ── Builder helpers ───────────────────────────────────────────────────────────

function buildServiceEntity(
    serviceId: string,
    input: CreateServiceInput,
    now: string
): ServiceEntity {
    const pkVal = CatalogKeyBuilder.categoryPk(input.categoryId);
    const skVal = CatalogKeyBuilder.serviceSk(serviceId);
    const lsi1Val = CatalogKeyBuilder.lsi1sk(input.displayOrder ?? 0);
    const lsi2Val = CatalogKeyBuilder.lsi2sk(input.active ?? true);
    const lsi3Val = CatalogKeyBuilder.lsi3sk("SERVICE");
    const lsi5Val = CatalogKeyBuilder.lsi5sk(input.durationMinutes);

    return {
        PK: pkVal,
        SK: skVal,
        entityType: "SERVICE",
        vendorId: input.vendorId,
        categoryId: input.categoryId,
        serviceId,
        name: input.name,
        description: input.description,
        durationMinutes: input.durationMinutes,
        vehicleTypes: input.vehicleTypes,
        basePrice: input.basePrice,
        displayOrder: input.displayOrder ?? 0,
        active: input.active ?? true,
        version: INITIAL_CATALOG_VERSION,
        GSI1PK: CatalogKeyBuilder.gsi1pk(input.name),
        GSI1SK: CatalogKeyBuilder.gsi1VendorCategorySk("SERVICE", input.vendorId, input.categoryId),
        GSI2PK: CatalogKeyBuilder.vendorPk(input.vendorId),
        GSI2SK: CatalogKeyBuilder.vendorServiceSk(input.categoryId, serviceId),
        LSI1SK: lsi1Val,
        LSI2SK: lsi2Val,
        LSI3SK: lsi3Val,
        LSI5SK: lsi5Val,
        createdAt: now,
        updatedAt: now,
    };
}

function mergeServiceEntity(
    existing: ServiceEntity,
    updates: UpdateServiceInput,
    now: string
): ServiceEntity {
    const name = updates.name ?? existing.name;
    const displayOrder = updates.displayOrder ?? existing.displayOrder;
    const active = updates.active ?? existing.active;
    const vehicleTypes = updates.vehicleTypes ?? existing.vehicleTypes;
    const durationMinutes = updates.durationMinutes ?? existing.durationMinutes;

    const lsi1Val = CatalogKeyBuilder.lsi1sk(displayOrder);
    const lsi2Val = CatalogKeyBuilder.lsi2sk(active);
    const lsi5Val = CatalogKeyBuilder.lsi5sk(durationMinutes);

    const pricingChanged = (updates.basePrice !== undefined && updates.basePrice !== existing.basePrice)
        || (updates.active !== undefined && updates.active !== existing.active)
        || (updates.vehicleTypes !== undefined && !sameMembers(updates.vehicleTypes, existing.vehicleTypes));
    const next: ServiceEntity = {
        ...existing,
        name,
        description: updates.description ?? existing.description,
        durationMinutes,
        vehicleTypes,
        basePrice: updates.basePrice ?? existing.basePrice,
        displayOrder,
        active,
        version: nextCatalogVersion(existing.version, pricingChanged),
        GSI1PK: CatalogKeyBuilder.gsi1pk(name),
        GSI1SK: CatalogKeyBuilder.gsi1VendorCategorySk(
            "SERVICE",
            existing.vendorId,
            existing.categoryId,
        ),
        GSI2PK: CatalogKeyBuilder.vendorPk(existing.vendorId),
        GSI2SK: CatalogKeyBuilder.vendorServiceSk(existing.categoryId, existing.serviceId),
        LSI1SK: lsi1Val,
        LSI2SK: lsi2Val,
        LSI5SK: lsi5Val,
        updatedAt: now,
    };
    delete next.LSI4SK;
    return next;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let service: ServicesService;

export function getServicesService() {

    if (!service) {

        service =
            new ServicesService();

    }

    return service;

}
