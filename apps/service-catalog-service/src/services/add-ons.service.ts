import { randomUUID } from "crypto";

import { LambdaRequest } from "@api-hub/utils";
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
    AddOnsRepository,
    getAddOnsRepository
} from "../repositories/add-ons.repository";
import {
    ServicesRepository,
    getServicesRepository
} from "../repositories/services.repository";
import {
    CategoriesRepository,
    getCategoriesRepository
} from "../repositories/categories.repository";
import {
    CreateAddOnInput,
    UpdateAddOnInput,
    validateAddOn,
    validateAddOnUpdate,
} from "../schemas/add-ons.schema";
import { INITIAL_CATALOG_VERSION, nextCatalogVersion } from "../domain/catalog-version";
import { assertVendorOwner, requireVendorId } from "../domain/vendor-scope";
import { CatalogKeyBuilder } from "../utils/constants/catalog-key-builder";
import { AddonEntity } from "../utils/types/catalog-domain.types";

const baseLogger = createLogger({
    service: "add-ons-service",
    redactPII: true,
});

export class AddOnsService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "AddOnsService"
            }
        );

    constructor(

        private readonly repository: AddOnsRepository =
            getAddOnsRepository(),

        private readonly servicesRepository: ServicesRepository =
            getServicesRepository(),

        private readonly categoriesRepository: CategoriesRepository =
            getCategoriesRepository()

    ) {}



    async getaddons(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getaddons_start",
        });

        const vendorId = requireVendorId(request.params?.vendorId);
        const categoryId = request.params?.categoryId as string | undefined;
        const serviceId = request.params?.serviceId as string | undefined;
        const activeOnly = request.params?.active === "true";
        const limit = request.params?.limit
            ? parseInt(request.params.limit as string, 10)
            : undefined;
        const lastEvaluatedKey = request.params?.nextToken
            ? JSON.parse(Buffer.from(request.params.nextToken as string, "base64").toString())
            : undefined;

        if (serviceId) {
            const service = categoryId
                ? await this.servicesRepository.findById(categoryId, serviceId)
                : await this.servicesRepository.findByServiceId(serviceId);
            if (!service || service.vendorId !== vendorId) {
                throw new NotFoundError(`Service not found: ${serviceId}`);
            }
        }

        const result = await this.repository.listByVendor(vendorId, {
            serviceId,
            categoryId,
            activeOnly,
            limit,
            lastEvaluatedKey,
        });

        const items = result.items.map(mapAddonEntityToResponse);

        this.logger.info({
            event: "getaddons_success",
            vendorId,
            serviceId,
            count: items.length,
        });

        return {
            items,
            nextToken: result.lastEvaluatedKey
                ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString("base64")
                : undefined,
            total: items.length,
        };

    }



    async postaddons(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postaddons_start",
        });

        const body = validateAddOn(request);

        // Validate parent hierarchy
        const category = await this.categoriesRepository.findById(body.categoryId);
        if (!category) {
            throw new NotFoundError(`Category not found: ${body.categoryId}`);
        }

        const service = await this.servicesRepository.findById(body.categoryId, body.serviceId);
        if (!service || service.vendorId !== body.vendorId) {
            throw new NotFoundError(`Service not found: ${body.serviceId}`);
        }
        if (!category.active || !service.active) {
            throw new ConflictError(
                "Add-ons can only be created for an active category and service",
            );
        }

        // Addon name unique within service
        await this.assertAddonNameUnique(body.name, body.categoryId, body.serviceId);

        const now = new Date().toISOString();
        const addonId = randomUUID();

        const entity = buildAddonEntity(addonId, body, now);

        try {

            await this.repository.createAddon(entity);

        } catch (err) {

            if (err instanceof ConditionalWriteConflictError) {
                this.logger.warn({
                    event: "postaddons_conflict",
                    addonId,
                });
                throw new ConflictError("An add-on with this name already exists on the service");
            }

            this.logger.error({
                event: "postaddons_error",
                error: err instanceof Error ? err.message : String(err),
            });

            throw err;
        }

        this.logger.info({
            event: "postaddons_success",
            addonId,
        });

        return mapAddonEntityToResponse(entity);

    }



    async getaddonid(
        request: LambdaRequest
    ) {

        const addonId = request.params?.addonId as string;
        const serviceId = request.params?.serviceId as string | undefined;
        const categoryId = request.params?.categoryId as string | undefined;
        const vendorId = requireVendorId(request.params?.vendorId);

        this.logger.info({
            event: "getaddonid_start",
            addonId,
            serviceId,
            categoryId,
            vendorId,
        });

        const entity = await this.loadOwnedAddon(addonId, vendorId, categoryId, serviceId);

        this.logger.info({
            event: "getaddonid_success",
            addonId,
        });

        return mapAddonEntityToResponse(entity);

    }



    async putaddonid(
        request: LambdaRequest
    ) {

        const addonId = request.params?.addonId as string;
        const serviceId = request.params?.serviceId as string | undefined;
        const categoryId = request.params?.categoryId as string | undefined;
        const vendorId = requireVendorId(request.params?.vendorId);

        this.logger.info({
            event: "putaddonid_start",
            addonId,
            serviceId,
            categoryId,
            vendorId,
        });

        const body = validateAddOnUpdate(request);

        const existing = await this.loadOwnedAddon(addonId, vendorId, categoryId, serviceId);

        if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
            await this.assertAddonNameUnique(body.name, existing.categoryId, existing.serviceId);
        }

        const now = new Date().toISOString();
        const updated = mergeAddonEntity(existing, body, now);

        try {

            await this.repository.updateAddon(updated);

        } catch (err) {

            if (err instanceof ConditionalWriteConflictError) {
                this.logger.warn({
                    event: "putaddonid_conflict",
                    addonId,
                });
                throw new ConflictError("Add-on was modified concurrently. Please retry.");
            }

            this.logger.error({
                event: "putaddonid_error",
                error: err instanceof Error ? err.message : String(err),
            });

            throw err;
        }

        this.logger.info({
            event: "putaddonid_success",
            addonId,
        });

        return mapAddonEntityToResponse(updated);

    }



    async deleteaddonid(
        request: LambdaRequest
    ) {

        const addonId = request.params?.addonId as string;
        const serviceId = request.params?.serviceId as string | undefined;
        const categoryId = request.params?.categoryId as string | undefined;
        const vendorId = requireVendorId(request.params?.vendorId);

        this.logger.info({
            event: "deleteaddonid_start",
            addonId,
            serviceId,
            categoryId,
            vendorId,
        });

        const existing = await this.loadOwnedAddon(addonId, vendorId, categoryId, serviceId);

        try {

            await this.repository.deleteAddon(existing.categoryId, existing.serviceId, addonId);

        } catch (err) {

            if (err instanceof ConditionalWriteConflictError) {
                this.logger.warn({
                    event: "deleteaddonid_conflict",
                    addonId,
                });
                throw new NotFoundError(`Add-on not found: ${addonId}`);
            }

            this.logger.error({
                event: "deleteaddonid_error",
                error: err instanceof Error ? err.message : String(err),
            });

            throw err;
        }

        this.logger.info({
            event: "deleteaddonid_success",
            addonId,
        });

        return { deleted: true, addonId };

    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async loadOwnedAddon(
        addonId: string,
        vendorId: string,
        categoryId?: string,
        serviceId?: string,
    ): Promise<AddonEntity> {
        if ((categoryId && !serviceId) || (!categoryId && serviceId)) {
            throw new BusinessRuleError(
                "categoryId and serviceId must be supplied together",
            );
        }
        const entity = categoryId && serviceId
            ? await this.repository.findById(categoryId, serviceId, addonId)
            : await this.repository.findByAddonId(addonId);
        if (!entity) {
            throw new NotFoundError(`Add-on not found: ${addonId}`);
        }
        assertVendorOwner(entity.vendorId, vendorId, "Add-on", addonId);
        return entity;
    }

    private async assertAddonNameUnique(
        name: string,
        categoryId: string,
        serviceId: string
    ): Promise<void> {
        const duplicate = await this.repository.findByNameInService(name, categoryId, serviceId);
        if (duplicate) {
            throw new ConflictError(
                `An add-on named "${name}" already exists on this service`
            );
        }
    }

}

// ── Mapper ─────────────────────────────────────────────────────────────────────

function mapAddonEntityToResponse(entity: AddonEntity) {
    return {
        id: entity.addonId,
        vendorId: entity.vendorId,
        serviceId: entity.serviceId,
        categoryId: entity.categoryId,
        name: entity.name,
        description: entity.description,
        price: entity.price,
        durationMinutes: entity.durationMinutes,
        displayOrder: entity.displayOrder,
        active: entity.active,
        ...(entity.version !== undefined ? { version: entity.version } : {}),
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
    };
}

// ── Builder helpers ───────────────────────────────────────────────────────────

function buildAddonEntity(
    addonId: string,
    input: CreateAddOnInput,
    now: string
): AddonEntity {
    const pkVal = CatalogKeyBuilder.categoryPk(input.categoryId);
    const skVal = CatalogKeyBuilder.addonSk(input.serviceId, addonId);
    const lsi1Val = CatalogKeyBuilder.lsi1sk(input.displayOrder ?? 0);
    const lsi2Val = CatalogKeyBuilder.lsi2sk(input.active ?? true);
    const lsi3Val = CatalogKeyBuilder.lsi3sk("ADDON");
    const lsi5Val = CatalogKeyBuilder.lsi5sk(input.durationMinutes);

    return {
        PK: pkVal,
        SK: skVal,
        entityType: "ADDON",
        vendorId: input.vendorId,
        categoryId: input.categoryId,
        serviceId: input.serviceId,
        addonId,
        name: input.name,
        description: input.description,
        price: input.price,
        durationMinutes: input.durationMinutes,
        displayOrder: input.displayOrder ?? 0,
        active: input.active ?? true,
        version: INITIAL_CATALOG_VERSION,
        GSI1PK: CatalogKeyBuilder.gsi1pk(input.name),
        GSI1SK: CatalogKeyBuilder.gsi1sk("ADDON"),
        GSI2PK: CatalogKeyBuilder.vendorPk(input.vendorId),
        GSI2SK: CatalogKeyBuilder.vendorAddonSk(input.serviceId, addonId),
        LSI1SK: lsi1Val,
        LSI2SK: lsi2Val,
        LSI3SK: lsi3Val,
        LSI5SK: lsi5Val,
        createdAt: now,
        updatedAt: now,
    };
}

function mergeAddonEntity(
    existing: AddonEntity,
    updates: UpdateAddOnInput,
    now: string
): AddonEntity {
    const name = updates.name ?? existing.name;
    const displayOrder = updates.displayOrder ?? existing.displayOrder;
    const active = updates.active ?? existing.active;
    const durationMinutes = updates.durationMinutes ?? existing.durationMinutes;
    const pricingChanged = (updates.price !== undefined && updates.price !== existing.price)
        || (updates.active !== undefined && updates.active !== existing.active);

    const lsi1Val = CatalogKeyBuilder.lsi1sk(displayOrder);
    const lsi2Val = CatalogKeyBuilder.lsi2sk(active);
    const lsi5Val = CatalogKeyBuilder.lsi5sk(durationMinutes);

    return {
        ...existing,
        name,
        description: updates.description ?? existing.description,
        price: updates.price ?? existing.price,
        durationMinutes,
        displayOrder,
        active,
        version: nextCatalogVersion(existing.version, pricingChanged),
        GSI1PK: CatalogKeyBuilder.gsi1pk(name),
        GSI1SK: CatalogKeyBuilder.gsi1sk("ADDON"),
        GSI2PK: CatalogKeyBuilder.vendorPk(existing.vendorId),
        GSI2SK: CatalogKeyBuilder.vendorAddonSk(existing.serviceId, existing.addonId),
        LSI1SK: lsi1Val,
        LSI2SK: lsi2Val,
        LSI5SK: lsi5Val,
        updatedAt: now,
    };
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let service: AddOnsService;

export function getAddOnsService() {

    if (!service) {

        service =
            new AddOnsService();

    }

    return service;

}
