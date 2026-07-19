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

    ) {
        this.repository;
    }



    async getaddons(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getaddons_start",
        });

        const categoryId = request.params?.categoryId as string | undefined;
        const serviceId = request.params?.serviceId as string | undefined;
        const activeOnly = request.params?.active === "true";
        const limit = request.params?.limit
            ? parseInt(request.params.limit as string, 10)
            : undefined;
        const lastEvaluatedKey = request.params?.nextToken
            ? JSON.parse(Buffer.from(request.params.nextToken as string, "base64").toString())
            : undefined;

        if (!categoryId || !serviceId) {
            throw new BusinessRuleError("Both categoryId and serviceId query parameters are required");
        }

        // Validate parent hierarchy
        const service = await this.servicesRepository.findById(categoryId, serviceId);
        if (!service) {
            throw new NotFoundError(`Service not found: ${serviceId}`);
        }

        const result = await this.repository.listByService(categoryId, serviceId, {
            activeOnly,
            limit,
            lastEvaluatedKey,
        });

        const items = result.items.map(mapAddonEntityToResponse);

        this.logger.info({
            event: "getaddons_success",
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
        if (!service) {
            throw new NotFoundError(`Service not found: ${body.serviceId}`);
        }

        // Addon name unique within service
        await this.assertAddonNameUnique(body.name, body.categoryId, body.serviceId);

        const now = new Date().toISOString();
        const addonId = crypto.randomUUID();

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
        const serviceId = request.params?.serviceId as string;
        const categoryId = request.params?.categoryId as string;

        this.logger.info({
            event: "getaddonid_start",
            addonId,
            serviceId,
            categoryId,
        });

        if (!categoryId || !serviceId) {
            throw new BusinessRuleError("Both categoryId and serviceId query parameters are required");
        }

        const entity = await this.repository.findById(categoryId, serviceId, addonId);

        if (!entity) {
            throw new NotFoundError(`Add-on not found: ${addonId}`);
        }

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
        const serviceId = request.params?.serviceId as string;
        const categoryId = request.params?.categoryId as string;

        this.logger.info({
            event: "putaddonid_start",
            addonId,
            serviceId,
            categoryId,
        });

        if (!categoryId || !serviceId) {
            throw new BusinessRuleError("Both categoryId and serviceId query parameters are required");
        }

        const body = validateAddOnUpdate(request);

        // Verify addon exists
        const existing = await this.repository.findById(categoryId, serviceId, addonId);
        if (!existing) {
            throw new NotFoundError(`Add-on not found: ${addonId}`);
        }

        // Name uniqueness check (only if name is changing)
        if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
            await this.assertAddonNameUnique(body.name, categoryId, serviceId);
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
        const serviceId = request.params?.serviceId as string;
        const categoryId = request.params?.categoryId as string;

        this.logger.info({
            event: "deleteaddonid_start",
            addonId,
            serviceId,
            categoryId,
        });

        if (!categoryId || !serviceId) {
            throw new BusinessRuleError("Both categoryId and serviceId query parameters are required");
        }

        // Verify addon exists
        const existing = await this.repository.findById(categoryId, serviceId, addonId);
        if (!existing) {
            throw new NotFoundError(`Add-on not found: ${addonId}`);
        }

        try {

            await this.repository.deleteAddon(categoryId, serviceId, addonId);

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
        serviceId: entity.serviceId,
        categoryId: entity.categoryId,
        name: entity.name,
        description: entity.description,
        price: entity.price,
        durationMinutes: entity.durationMinutes,
        displayOrder: entity.displayOrder,
        active: entity.active,
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
    return {
        pk: CatalogKeyBuilder.categoryPk(input.categoryId),
        sk: CatalogKeyBuilder.addonSk(input.serviceId, addonId),
        entityType: "ADDON",
        categoryId: input.categoryId,
        serviceId: input.serviceId,
        addonId,
        name: input.name,
        description: input.description,
        price: input.price,
        durationMinutes: input.durationMinutes,
        displayOrder: input.displayOrder ?? 0,
        active: input.active ?? true,
        GSI1PK: CatalogKeyBuilder.gsi1pk(input.name),
        GSI1SK: CatalogKeyBuilder.gsi1sk("ADDON"),
        gsi1pk: CatalogKeyBuilder.gsi1pk(input.name),
        gsi1sk: CatalogKeyBuilder.gsi1sk("ADDON"),
        lsi1sk: CatalogKeyBuilder.lsi1sk(input.displayOrder ?? 0),
        lsi2sk: CatalogKeyBuilder.lsi2sk(input.active ?? true),
        lsi3sk: CatalogKeyBuilder.lsi3sk("ADDON"),
        lsi5sk: CatalogKeyBuilder.lsi5sk(input.durationMinutes),
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

    return {
        ...existing,
        name,
        description: updates.description ?? existing.description,
        price: updates.price ?? existing.price,
        durationMinutes,
        displayOrder,
        active,
        GSI1PK: CatalogKeyBuilder.gsi1pk(name),
        GSI1SK: CatalogKeyBuilder.gsi1sk("ADDON"),
        gsi1pk: CatalogKeyBuilder.gsi1pk(name),
        gsi1sk: CatalogKeyBuilder.gsi1sk("ADDON"),
        lsi1sk: CatalogKeyBuilder.lsi1sk(displayOrder),
        lsi2sk: CatalogKeyBuilder.lsi2sk(active),
        lsi5sk: CatalogKeyBuilder.lsi5sk(durationMinutes),
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
