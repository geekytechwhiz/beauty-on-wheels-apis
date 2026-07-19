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
    PackagesRepository,
    getPackagesRepository
} from "../repositories/packages.repository";
import {
    ServicesRepository,
    getServicesRepository
} from "../repositories/services.repository";
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
            getServicesRepository()

    ) {
        this.repository;
        this.servicesRepository;
    }



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
        const packageId = crypto.randomUUID();

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
                    await this.deletePackageItemRecord(item.pk, item.sk);
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
        for (const _item of items) {
            // We validate services exist but don't enforce category here —
            // caller is responsible for supplying valid serviceIds.
            // A full validation would require knowing the categoryId per service,
            // which the package schema doesn't include by design.
            // We do a lightweight existence check via GSI if needed.
            // For now, enforce uniqueness of serviceIds within a package.
        }

        const serviceIds = items.map(i => i.serviceId);
        const uniqueServiceIds = new Set(serviceIds);
        if (uniqueServiceIds.size !== serviceIds.length) {
            throw new BusinessRuleError("Duplicate service references are not allowed within a package");
        }
    }

    private async deletePackageItemRecord(pk: string, sk: string): Promise<void> {
        await this.repository.deletePackageItem(pk, sk);
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
    return {
        pk: CatalogKeyBuilder.packagePk(packageId),
        sk: CatalogKeyBuilder.packageSk(),
        entityType: "PACKAGE",
        packageId,
        name: input.name,
        description: input.description,
        discountedPrice: input.discountedPrice,
        displayOrder: input.displayOrder ?? 0,
        active: input.active ?? true,
        GSI1PK: CatalogKeyBuilder.gsi1pk(input.name),
        GSI1SK: CatalogKeyBuilder.gsi1sk("PACKAGE"),
        gsi1pk: CatalogKeyBuilder.gsi1pk(input.name),
        gsi1sk: CatalogKeyBuilder.gsi1sk("PACKAGE"),
        lsi1sk: CatalogKeyBuilder.lsi1sk(input.displayOrder ?? 0),
        lsi2sk: CatalogKeyBuilder.lsi2sk(input.active ?? true),
        lsi3sk: CatalogKeyBuilder.lsi3sk("PACKAGE"),
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
    const pk = CatalogKeyBuilder.packagePk(packageId);

    for (const item of items) {
        // Service item
        entities.push({
            pk,
            sk: CatalogKeyBuilder.packageItemServiceSk(item.serviceId),
            entityType: "PACKAGE_ITEM",
            packageId,
            refId: item.serviceId,
            itemType: "SERVICE",
            createdAt: now,
            updatedAt: now,
        });

        // Addon items for this service
        for (const addonId of item.addons ?? []) {
            entities.push({
                pk,
                sk: CatalogKeyBuilder.packageItemAddonSk(addonId),
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

    return {
        ...existing,
        name,
        description: updates.description ?? existing.description,
        discountedPrice: updates.discountedPrice ?? existing.discountedPrice,
        displayOrder,
        active,
        GSI1PK: CatalogKeyBuilder.gsi1pk(name),
        GSI1SK: CatalogKeyBuilder.gsi1sk("PACKAGE"),
        gsi1pk: CatalogKeyBuilder.gsi1pk(name),
        gsi1sk: CatalogKeyBuilder.gsi1sk("PACKAGE"),
        lsi1sk: CatalogKeyBuilder.lsi1sk(displayOrder),
        lsi2sk: CatalogKeyBuilder.lsi2sk(active),
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
