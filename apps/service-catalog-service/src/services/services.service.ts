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
import { assertVendorOwner, requireVendorId } from "../domain/vendor-scope";
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

    ) {}



    async getservices(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getservices_start",
        });

        const vendorId = requireVendorId(request.params?.vendorId);
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
            event: "getservices_success",
            vendorId,
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
        if (!category.active) {
            throw new ConflictError(
                `Category is not active: ${body.categoryId}`,
            );
        }

        await this.assertServiceNameUnique(body.name, body.categoryId, body.vendorId);

        const now = new Date().toISOString();
        const serviceId = randomUUID();

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
        const categoryId = request.params?.categoryId as string | undefined;
        const vendorId = requireVendorId(request.params?.vendorId);

        this.logger.info({
            event: "getserviceid_start",
            serviceId,
            categoryId,
            vendorId,
        });

        const entity = await this.loadOwnedService(serviceId, vendorId, categoryId);

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
        const categoryId = request.params?.categoryId as string | undefined;
        const vendorId = requireVendorId(request.params?.vendorId);

        this.logger.info({
            event: "putserviceid_start",
            serviceId,
            categoryId,
            vendorId,
        });

        const body = validateServiceUpdate(request);

        const existing = await this.loadOwnedService(serviceId, vendorId, categoryId);

        if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
            await this.assertServiceNameUnique(body.name, existing.categoryId, vendorId);
        }

        if (body.active === true && existing.active === false) {
            const category = await this.categoriesRepository.findById(existing.categoryId);
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

            await this.repository.updateService(updated, existing.vehicleTypes);

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
        const categoryId = request.params?.categoryId as string | undefined;
        const vendorId = requireVendorId(request.params?.vendorId);

        this.logger.info({
            event: "deleteserviceid_start",
            serviceId,
            categoryId,
            vendorId,
        });

        const existing = await this.loadOwnedService(serviceId, vendorId, categoryId);

        const addonCount = await this.repository.countAddons(existing.categoryId, serviceId);
        if (addonCount > 0) {
            throw new BusinessRuleError(
                `Cannot delete service: ${addonCount} add-on(s) are still linked to this service`
            );
        }

        try {

            await this.repository.deleteService(existing);

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
        assertVendorOwner(entity.vendorId, vendorId, "Service", serviceId);
        return entity;
    }

    private async assertServiceNameUnique(
        name: string,
        categoryId: string,
        vendorId: string,
    ): Promise<void> {
        const duplicate = await this.repository.findByName(name, categoryId, vendorId);
        if (duplicate) {
            throw new ConflictError(
                `A service named "${name}" already exists in this category for this vendor`
            );
        }
    }

}

// ── Mapper ─────────────────────────────────────────────────────────────────────

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
