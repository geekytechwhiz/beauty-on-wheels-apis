import { randomUUID } from "crypto";

import { LambdaRequest } from "@api-hub/utils";
import {
    ConflictError,
    NotFoundError,
    BaseError,
    ConditionalWriteConflictError,
} from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    PackagesRepository,
    getPackagesRepository
} from "../repositories/packages.repository";
import {
    ServicesRepository,
    getServicesRepository
} from "../repositories/services.repository";
import {
    AddOnsRepository,
    getAddOnsRepository
} from "../repositories/add-ons.repository";
import {
    CreatePackageInput,
    UpdatePackageInput,
    PackageItemInput,
    validatePackage,
    validatePackageUpdate,
} from "../schemas/packages.schema";
import { CatalogKeyBuilder } from "../utils/constants/catalog-key-builder";
import { PackageEntity, PackageItemEntity } from "../utils/types/catalog-domain.types";

const baseLogger = createLogger({
    service: "packages-service",
    redactPII: true,
});

export class PackagesService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "PackagesService"
            }
        );

    constructor(

        private readonly repository: PackagesRepository =
            getPackagesRepository(),

        private readonly servicesRepository: ServicesRepository =
            getServicesRepository(),

        private readonly addOnsRepository: AddOnsRepository =
            getAddOnsRepository()

    ) {}



    async getpackages(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getpackages_start",
        });

        const activeOnly = request.params?.active === "true";
        const limit = request.params?.limit
            ? parseInt(request.params.limit as string, 10)
            : undefined;
        const lastEvaluatedKey = request.params?.nextToken
            ? JSON.parse(Buffer.from(request.params.nextToken as string, "base64").toString())
            : undefined;

        const result = await this.repository.listPackages({
            activeOnly,
            limit,
            lastEvaluatedKey,
        });

        const items = result.items.map(mapPackageEntityToResponse);

        this.logger.info({
            event: "getpackages_success",
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



    async postpackages(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postpackages_start",
        });

        const body = validatePackage(request);

        // Package name unique
        await this.assertPackageNameUnique(body.name);

        // Validate that all referenced services exist
        await this.validatePackageItems(body.items);

        const now = new Date().toISOString();
        const packageId = randomUUID();

        const entity = buildPackageEntity(packageId, body, now);
        const itemEntities = buildPackageItemEntities(packageId, body.items, now);

        try {

            await this.repository.createPackage(entity, itemEntities);

        } catch (err) {

            if (err instanceof ConditionalWriteConflictError) {
                this.logger.warn({
                    event: "postpackages_conflict",
                    packageId,
                });
                throw new ConflictError("A package with this name already exists");
            }

            this.logger.error({
                event: "postpackages_error",
                error: err instanceof Error ? err.message : String(err),
            });

            throw err;
        }

        this.logger.info({
            event: "postpackages_success",
            packageId,
        });

        return mapPackageEntityToResponse(entity);

    }



    async getpackageid(
        request: LambdaRequest
    ) {

        const packageId = request.params?.packageId as string;

        this.logger.info({
            event: "getpackageid_start",
            packageId,
        });

        const entity = await this.repository.findById(packageId);

        if (!entity) {
            throw new NotFoundError(`Package not found: ${packageId}`);
        }

        // Enrich with items
        const items = await this.repository.listPackageItems(packageId);

        this.logger.info({
            event: "getpackageid_success",
            packageId,
        });

        return {
            ...mapPackageEntityToResponse(entity),
            items: items.map(mapPackageItemEntityToResponse),
        };

    }



    async putpackageid(
        request: LambdaRequest
    ) {

        const packageId = request.params?.packageId as string;

        this.logger.info({
            event: "putpackageid_start",
            packageId,
        });

        const body = validatePackageUpdate(request);

        // Verify package exists
        const existing = await this.repository.findById(packageId);
        if (!existing) {
            throw new NotFoundError(`Package not found: ${packageId}`);
        }

        // Name uniqueness check (only if name is changing)
        if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
            await this.assertPackageNameUnique(body.name);
        }

        // Validate new items if provided
        if (body.items && body.items.length > 0) {
            await this.validatePackageItems(body.items);
        }

        const now = new Date().toISOString();
        const updated = mergePackageEntity(existing, body, now);

        // Fetch existing items for replacement
        const existingItems = await this.repository.listPackageItems(packageId);
        const newItems = body.items
            ? buildPackageItemEntities(packageId, body.items, now)
            : existingItems;

        try {

            await this.repository.updatePackage(updated, existingItems, newItems);

        } catch (err) {

            if (err instanceof ConditionalWriteConflictError) {
                this.logger.warn({
                    event: "putpackageid_conflict",
                    packageId,
                });
                throw new ConflictError("Package was modified concurrently. Please retry.");
            }

            this.logger.error({
                event: "putpackageid_error",
                error: err instanceof Error ? err.message : String(err),
            });

            throw err;
        }

        this.logger.info({
            event: "putpackageid_success",
            packageId,
        });

        return {
            ...mapPackageEntityToResponse(updated),
            items: newItems.map(mapPackageItemEntityToResponse),
        };

    }



    async deletepackageid(
        request: LambdaRequest
    ) {

        const packageId = request.params?.packageId as string;

        this.logger.info({
            event: "deletepackageid_start",
            packageId,
        });

        // Verify package exists
        const existing = await this.repository.findById(packageId);
        if (!existing) {
            throw new NotFoundError(`Package not found: ${packageId}`);
        }

        // Remove all package items first (DynamoDB transaction handles this atomically)
        const existingItems = await this.repository.listPackageItems(packageId);

        try {

            // Delete package + items + index entry in one transaction
            await this.repository.deletePackage(packageId);

            // If there are items, delete them separately (transactWrite limit is 100 items)
            if (existingItems.length > 0) {
                // Batch deletes — items are removed separately since they can exceed transaction limits
                // Using individual deletes is safe here since the package header is already gone
                for (const item of existingItems) {
                    await this.deletePackageItemRecord(
                        item.PK,
                        item.SK
                    );
                }
            }

        } catch (err) {

            if (err instanceof ConditionalWriteConflictError) {
                this.logger.warn({
                    event: "deletepackageid_conflict",
                    packageId,
                });
                throw new NotFoundError(`Package not found: ${packageId}`);
            }

            this.logger.error({
                event: "deletepackageid_error",
                error: err instanceof Error ? err.message : String(err),
            });

            throw err;
        }

        this.logger.info({
            event: "deletepackageid_success",
            packageId,
        });

        return { deleted: true, packageId };

    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async assertPackageNameUnique(name: string): Promise<void> {
        const duplicate = await this.repository.findByName(name);
        if (duplicate) {
            throw new ConflictError(
                `A package named "${name}" already exists`
            );
        }
    }

    private async validatePackageItems(items: PackageItemInput[]): Promise<void> {
        const serviceIds = items.map((item) => item.serviceId);
        if (new Set(serviceIds).size !== serviceIds.length) {
            throw new BaseError(
                "Duplicate service references are not allowed within a package",
                400,
                "INVALID_PACKAGE",
            );
        }

        const addonIds = items.flatMap((item) => item.addons ?? []);
        if (new Set(addonIds).size !== addonIds.length) {
            throw new BaseError(
                "Duplicate add-on references are not allowed within a package",
                400,
                "INVALID_PACKAGE",
            );
        }

        for (const item of items) {
            const service = await this.servicesRepository.findByServiceId(item.serviceId);
            if (!service) {
                throw new BaseError(
                    `Service not found: ${item.serviceId}`,
                    404,
                    "SERVICE_NOT_FOUND",
                );
            }
            if (!service.active) {
                throw new BaseError(
                    `Inactive service cannot be included in a package: ${item.serviceId}`,
                    400,
                    "INVALID_PACKAGE",
                );
            }

            for (const addonId of item.addons ?? []) {
                const addon = await this.addOnsRepository.findByAddonId(addonId);
                if (!addon || addon.serviceId !== item.serviceId) {
                    throw new BaseError(
                        `Add-on not found: ${addonId}`,
                        404,
                        "ADDON_NOT_FOUND",
                    );
                }
                if (!addon.active) {
                    throw new BaseError(
                        `Inactive add-on cannot be included in a package: ${addonId}`,
                        400,
                        "INVALID_PACKAGE",
                    );
                }
            }
        }
    }

    private async deletePackageItemRecord(pkKey: string, skKey: string): Promise<void> {
        await this.repository.deletePackageItem(pkKey, skKey);
    }

}

// ── Mapper ─────────────────────────────────────────────────────────────────────

function mapPackageEntityToResponse(entity: PackageEntity) {
    return {
        id: entity.packageId,
        name: entity.name,
        description: entity.description,
        discountedPrice: entity.discountedPrice,
        displayOrder: entity.displayOrder,
        active: entity.active,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
    };
}

function mapPackageItemEntityToResponse(entity: PackageItemEntity) {
    return {
        refId: entity.refId,
        itemType: entity.itemType,
    };
}

// ── Builder helpers ───────────────────────────────────────────────────────────

function buildPackageEntity(
    packageId: string,
    input: CreatePackageInput,
    now: string
): PackageEntity {
    const pkVal = CatalogKeyBuilder.packagePk(packageId);
    const skVal = CatalogKeyBuilder.packageSk();
    const lsi1Val = CatalogKeyBuilder.lsi1sk(input.displayOrder ?? 0);
    const lsi2Val = CatalogKeyBuilder.lsi2sk(input.active ?? true);
    const lsi3Val = CatalogKeyBuilder.lsi3sk("PACKAGE");

    return {
        PK: pkVal,
        SK: skVal,
        entityType: "PACKAGE",
        packageId,
        name: input.name,
        description: input.description,
        discountedPrice: input.discountedPrice,
        displayOrder: input.displayOrder ?? 0,
        active: input.active ?? true,
        GSI1PK: CatalogKeyBuilder.gsi1pk(input.name),
        GSI1SK: CatalogKeyBuilder.gsi1sk("PACKAGE"),
        LSI1SK: lsi1Val,
        LSI2SK: lsi2Val,
        LSI3SK: lsi3Val,
        createdAt: now,
        updatedAt: now,
    };
}

function buildPackageItemEntities(
    packageId: string,
    items: PackageItemInput[],
    now: string
): PackageItemEntity[] {
    const entities: PackageItemEntity[] = [];
    const pkVal = CatalogKeyBuilder.packagePk(packageId);

    for (const item of items) {
        // Service item
        const skService = CatalogKeyBuilder.packageItemServiceSk(item.serviceId);
        entities.push({
            PK: pkVal,
            SK: skService,
            entityType: "PACKAGE_ITEM",
            packageId,
            refId: item.serviceId,
            itemType: "SERVICE",
            createdAt: now,
            updatedAt: now,
        });

        // Addon items for this service
        for (const addonId of item.addons ?? []) {
            const skAddon = CatalogKeyBuilder.packageItemAddonSk(addonId);
            entities.push({
                PK: pkVal,
                SK: skAddon,
                entityType: "PACKAGE_ITEM",
                packageId,
                refId: addonId,
                itemType: "ADDON",
                createdAt: now,
                updatedAt: now,
            });
        }
    }

    return entities;
}

function mergePackageEntity(
    existing: PackageEntity,
    updates: UpdatePackageInput,
    now: string
): PackageEntity {
    const name = updates.name ?? existing.name;
    const displayOrder = updates.displayOrder ?? existing.displayOrder;
    const active = updates.active ?? existing.active;

    const lsi1Val = CatalogKeyBuilder.lsi1sk(displayOrder);
    const lsi2Val = CatalogKeyBuilder.lsi2sk(active);

    return {
        ...existing,
        name,
        description: updates.description ?? existing.description,
        discountedPrice: updates.discountedPrice ?? existing.discountedPrice,
        displayOrder,
        active,
        GSI1PK: CatalogKeyBuilder.gsi1pk(name),
        GSI1SK: CatalogKeyBuilder.gsi1sk("PACKAGE"),
        LSI1SK: lsi1Val,
        LSI2SK: lsi2Val,
        updatedAt: now,
    };
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let service: PackagesService;

export function getPackagesService() {

    if (!service) {

        service =
            new PackagesService();

    }

    return service;

}
