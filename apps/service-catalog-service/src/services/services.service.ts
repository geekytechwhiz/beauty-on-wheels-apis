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
import { CatalogKeyBuilder } from "../utils/constants/catalog-key-builder";
import { ServiceEntity } from "../utils/types/catalog-domain.types";

const baseLogger = createLogger({
    service: "services-service",
    redactPII: true,
});

export class ServicesService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "ServicesService"
            }
        );

    constructor(

        private readonly repository: ServicesRepository =
            getServicesRepository(),

        private readonly categoriesRepository: CategoriesRepository =
            getCategoriesRepository()

    ) {
        this.repository;
    }



    async getservices(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getservices_start",
        });

        const categoryId = request.params?.categoryId as string | undefined;
        const activeOnly = request.params?.active === "true";
        const vehicleType = request.params?.vehicleType as string | undefined;
        const durationMinutes = request.params?.durationMinutes
            ? parseInt(request.params.durationMinutes as string, 10)
            : undefined;
        const limit = request.params?.limit
            ? parseInt(request.params.limit as string, 10)
            : undefined;
        const lastEvaluatedKey = request.params?.nextToken
            ? JSON.parse(Buffer.from(request.params.nextToken as string, "base64").toString())
            : undefined;

        if (!categoryId) {
            throw new BusinessRuleError("categoryId query parameter is required");
        }

        // Validate that the parent category exists
        const category = await this.categoriesRepository.findById(categoryId);
        if (!category) {
            throw new NotFoundError(`Category not found: ${categoryId}`);
        }

        if (vehicleType) {
            const items = await this.repository.listByVehicleType(categoryId, vehicleType);
            const filtered = activeOnly ? items.filter(s => s.active) : items;
            return {
                items: filtered.map(mapServiceEntityToResponse),
                total: filtered.length,
            };
        }

        if (durationMinutes !== undefined) {
            const items = await this.repository.listByDuration(categoryId, durationMinutes);
            const filtered = activeOnly ? items.filter(s => s.active) : items;
            return {
                items: filtered.map(mapServiceEntityToResponse),
                total: filtered.length,
            };
        }

        const result = await this.repository.listByCategory(categoryId, {
            activeOnly,
            limit,
            lastEvaluatedKey,
        });

        const items = result.items.map(mapServiceEntityToResponse);

        this.logger.info({
            event: "getservices_success",
            categoryId,
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



    async postservices(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postservices_start",
        });

        const body = validateService(request);

        // Validate parent category exists
        const category = await this.categoriesRepository.findById(body.categoryId);
        if (!category) {
            throw new NotFoundError(`Category not found: ${body.categoryId}`);
        }

        // Service name unique within category
        await this.assertServiceNameUnique(body.name, body.categoryId);

        const now = new Date().toISOString();
        const serviceId = crypto.randomUUID();

        const entity = buildServiceEntity(serviceId, body, now);

        try {

            await this.repository.createService(entity);

        } catch (err) {

            if (err instanceof ConditionalWriteConflictError) {
                this.logger.warn({
                    event: "postservices_conflict",
                    serviceId,
                });
                throw new ConflictError("A service with this name already exists in the category");
            }

            this.logger.error({
                event: "postservices_error",
                error: err instanceof Error ? err.message : String(err),
            });

            throw err;
        }

        this.logger.info({
            event: "postservices_success",
            serviceId,
        });

        return mapServiceEntityToResponse(entity);

    }



    async getserviceid(
        request: LambdaRequest
    ) {

        const serviceId = request.params?.serviceId as string;
        const categoryId = request.params?.categoryId as string;

        this.logger.info({
            event: "getserviceid_start",
            serviceId,
            categoryId,
        });

        if (!categoryId) {
            throw new BusinessRuleError("categoryId query parameter is required");
        }

        const entity = await this.repository.findById(categoryId, serviceId);

        if (!entity) {
            throw new NotFoundError(`Service not found: ${serviceId}`);
        }

        this.logger.info({
            event: "getserviceid_success",
            serviceId,
        });

        return mapServiceEntityToResponse(entity);

    }



    async putserviceid(
        request: LambdaRequest
    ) {

        const serviceId = request.params?.serviceId as string;
        const categoryId = request.params?.categoryId as string;

        this.logger.info({
            event: "putserviceid_start",
            serviceId,
            categoryId,
        });

        if (!categoryId) {
            throw new BusinessRuleError("categoryId query parameter is required");
        }

        const body = validateServiceUpdate(request);

        // Verify service exists
        const existing = await this.repository.findById(categoryId, serviceId);
        if (!existing) {
            throw new NotFoundError(`Service not found: ${serviceId}`);
        }

        // Name uniqueness check (only if name is changing)
        if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
            await this.assertServiceNameUnique(body.name, categoryId);
        }

        const now = new Date().toISOString();
        const updated = mergeServiceEntity(existing, body, now);

        try {

            await this.repository.updateService(updated);

        } catch (err) {

            if (err instanceof ConditionalWriteConflictError) {
                this.logger.warn({
                    event: "putserviceid_conflict",
                    serviceId,
                });
                throw new ConflictError("Service was modified concurrently. Please retry.");
            }

            this.logger.error({
                event: "putserviceid_error",
                error: err instanceof Error ? err.message : String(err),
            });

            throw err;
        }

        this.logger.info({
            event: "putserviceid_success",
            serviceId,
        });

        return mapServiceEntityToResponse(updated);

    }



    async deleteserviceid(
        request: LambdaRequest
    ) {

        const serviceId = request.params?.serviceId as string;
        const categoryId = request.params?.categoryId as string;

        this.logger.info({
            event: "deleteserviceid_start",
            serviceId,
            categoryId,
        });

        if (!categoryId) {
            throw new BusinessRuleError("categoryId query parameter is required");
        }

        // Verify service exists
        const existing = await this.repository.findById(categoryId, serviceId);
        if (!existing) {
            throw new NotFoundError(`Service not found: ${serviceId}`);
        }

        // Business rule: cannot delete if addons exist
        const addonCount = await this.repository.countAddons(categoryId, serviceId);
        if (addonCount > 0) {
            throw new BusinessRuleError(
                `Cannot delete service: ${addonCount} add-on(s) are still linked to this service`
            );
        }

        try {

            await this.repository.deleteService(categoryId, serviceId);

        } catch (err) {

            if (err instanceof ConditionalWriteConflictError) {
                this.logger.warn({
                    event: "deleteserviceid_conflict",
                    serviceId,
                });
                throw new NotFoundError(`Service not found: ${serviceId}`);
            }

            this.logger.error({
                event: "deleteserviceid_error",
                error: err instanceof Error ? err.message : String(err),
            });

            throw err;
        }

        this.logger.info({
            event: "deleteserviceid_success",
            serviceId,
        });

        return { deleted: true, serviceId };

    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async assertServiceNameUnique(name: string, categoryId: string): Promise<void> {
        const duplicate = await this.repository.findByName(name, categoryId);
        if (duplicate) {
            throw new ConflictError(
                `A service named "${name}" already exists in this category`
            );
        }
    }

}

// ── Mapper ─────────────────────────────────────────────────────────────────────

function mapServiceEntityToResponse(entity: ServiceEntity) {
    return {
        id: entity.serviceId,
        categoryId: entity.categoryId,
        name: entity.name,
        description: entity.description,
        durationMinutes: entity.durationMinutes,
        vehicleTypes: entity.vehicleTypes,
        basePrice: entity.basePrice,
        displayOrder: entity.displayOrder,
        active: entity.active,
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
    return {
        pk: CatalogKeyBuilder.categoryPk(input.categoryId),
        sk: CatalogKeyBuilder.serviceSk(serviceId),
        entityType: "SERVICE",
        categoryId: input.categoryId,
        serviceId,
        name: input.name,
        description: input.description,
        durationMinutes: input.durationMinutes,
        vehicleTypes: input.vehicleTypes,
        basePrice: input.basePrice,
        displayOrder: input.displayOrder ?? 0,
        active: input.active ?? true,
        GSI1PK: CatalogKeyBuilder.gsi1pk(input.name),
        GSI1SK: CatalogKeyBuilder.gsi1sk("SERVICE"),
        gsi1pk: CatalogKeyBuilder.gsi1pk(input.name),
        gsi1sk: CatalogKeyBuilder.gsi1sk("SERVICE"),
        lsi1sk: CatalogKeyBuilder.lsi1sk(input.displayOrder ?? 0),
        lsi2sk: CatalogKeyBuilder.lsi2sk(input.active ?? true),
        lsi3sk: CatalogKeyBuilder.lsi3sk("SERVICE"),
        // LSI4: vehicle type — store first vehicleType for single-dimension query
        lsi4sk: input.vehicleTypes.length > 0
            ? CatalogKeyBuilder.lsi4sk(input.vehicleTypes[0])
            : undefined,
        lsi5sk: CatalogKeyBuilder.lsi5sk(input.durationMinutes),
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

    return {
        ...existing,
        name,
        description: updates.description ?? existing.description,
        durationMinutes,
        vehicleTypes,
        basePrice: updates.basePrice ?? existing.basePrice,
        displayOrder,
        active,
        GSI1PK: CatalogKeyBuilder.gsi1pk(name),
        GSI1SK: CatalogKeyBuilder.gsi1sk("SERVICE"),
        gsi1pk: CatalogKeyBuilder.gsi1pk(name),
        gsi1sk: CatalogKeyBuilder.gsi1sk("SERVICE"),
        lsi1sk: CatalogKeyBuilder.lsi1sk(displayOrder),
        lsi2sk: CatalogKeyBuilder.lsi2sk(active),
        lsi4sk: vehicleTypes.length > 0
            ? CatalogKeyBuilder.lsi4sk(vehicleTypes[0])
            : existing.lsi4sk,
        lsi5sk: CatalogKeyBuilder.lsi5sk(durationMinutes),
        updatedAt: now,
    };
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
