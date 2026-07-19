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
    CategoriesRepository,
    getCategoriesRepository
} from "../repositories/categories.repository";
import {
    CreateCategoryInput,
    UpdateCategoryInput,
    validateCategory,
    validateCategoryUpdate,
} from "../schemas/categories.schema";
import { CatalogKeyBuilder } from "../utils/constants/catalog-key-builder";
import { CategoryEntity } from "../utils/types/catalog-domain.types";

const baseLogger = createLogger({
    service: "categories-service",
    redactPII: true,
});

export class CategoriesService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "CategoriesService"
            }
        );

    constructor(

        private readonly repository: CategoriesRepository =
            getCategoriesRepository()

    ) {
        this.repository;
    }



    async getcategories(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getcategories_start",
        });

        const activeOnly = request.params?.active === "true";
        const limit = request.params?.limit
            ? parseInt(request.params.limit as string, 10)
            : undefined;
        const lastEvaluatedKey = request.params?.nextToken
            ? JSON.parse(Buffer.from(request.params.nextToken as string, "base64").toString())
            : undefined;

        const result = await this.repository.listCategories({
            activeOnly,
            limit,
            lastEvaluatedKey,
        });

        const items = result.items.map(mapCategoryEntityToResponse);

        this.logger.info({
            event: "getcategories_success",
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



    async postcategories(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postcategories_start",
        });

        const body = validateCategory(request);

        await this.assertCategoryNameUnique(body.name);

        const now = new Date().toISOString();
        const categoryId = crypto.randomUUID();

        const entity = buildCategoryEntity(categoryId, body, now);

        try {

            await this.repository.createCategory(entity);

        } catch (err) {

            if (err instanceof ConditionalWriteConflictError) {
                this.logger.warn({
                    event: "postcategories_conflict",
                    categoryId,
                });
                throw new ConflictError("A category with this name already exists");
            }

            this.logger.error({
                event: "postcategories_error",
                error: err instanceof Error ? err.message : String(err),
            });

            throw err;
        }

        this.logger.info({
            event: "postcategories_success",
            categoryId,
        });

        return mapCategoryEntityToResponse(entity);

    }



    async getcategoryid(
        request: LambdaRequest
    ) {

        const categoryId = request.params?.categoryId as string;

        this.logger.info({
            event: "getcategoryid_start",
            categoryId,
        });

        const entity = await this.repository.findById(categoryId);

        if (!entity) {
            throw new NotFoundError(`Category not found: ${categoryId}`);
        }

        this.logger.info({
            event: "getcategoryid_success",
            categoryId,
        });

        return mapCategoryEntityToResponse(entity);

    }



    async putcategoryid(
        request: LambdaRequest
    ) {

        const categoryId = request.params?.categoryId as string;

        this.logger.info({
            event: "putcategoryid_start",
            categoryId,
        });

        const body = validateCategoryUpdate(request);

        // Verify category exists
        const existing = await this.repository.findById(categoryId);
        if (!existing) {
            throw new NotFoundError(`Category not found: ${categoryId}`);
        }

        // Deactivation guard: cannot deactivate if active services exist
        if (body.active === false && existing.active === true) {
            const activeServiceCount = await this.repository.countActiveServices(categoryId);
            if (activeServiceCount > 0) {
                throw new BusinessRuleError(
                    `Cannot deactivate category: ${activeServiceCount} active service(s) still exist under this category`
                );
            }
        }

        // Name uniqueness check (only if name is changing)
        if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
            await this.assertCategoryNameUnique(body.name);
        }

        const now = new Date().toISOString();
        const updated = mergeCategoryEntity(existing, body, now);

        try {

            await this.repository.updateCategory(updated);

        } catch (err) {

            if (err instanceof ConditionalWriteConflictError) {
                this.logger.warn({
                    event: "putcategoryid_conflict",
                    categoryId,
                });
                throw new ConflictError("Category was modified concurrently. Please retry.");
            }

            this.logger.error({
                event: "putcategoryid_error",
                error: err instanceof Error ? err.message : String(err),
            });

            throw err;
        }

        this.logger.info({
            event: "putcategoryid_success",
            categoryId,
        });

        return mapCategoryEntityToResponse(updated);

    }



    async deletecategoryid(
        request: LambdaRequest
    ) {

        const categoryId = request.params?.categoryId as string;

        this.logger.info({
            event: "deletecategoryid_start",
            categoryId,
        });

        // Verify category exists
        const existing = await this.repository.findById(categoryId);
        if (!existing) {
            throw new NotFoundError(`Category not found: ${categoryId}`);
        }

        // Business rule: cannot delete if services exist
        const serviceCount = await this.repository.countServices(categoryId);
        if (serviceCount > 0) {
            throw new BusinessRuleError(
                `Cannot delete category: ${serviceCount} service(s) are still linked to this category`
            );
        }

        try {

            await this.repository.deleteCategory(categoryId);

        } catch (err) {

            if (err instanceof ConditionalWriteConflictError) {
                this.logger.warn({
                    event: "deletecategoryid_conflict",
                    categoryId,
                });
                throw new NotFoundError(`Category not found: ${categoryId}`);
            }

            this.logger.error({
                event: "deletecategoryid_error",
                error: err instanceof Error ? err.message : String(err),
            });

            throw err;
        }

        this.logger.info({
            event: "deletecategoryid_success",
            categoryId,
        });

        return { deleted: true, categoryId };

    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async assertCategoryNameUnique(name: string): Promise<void> {
        const duplicate = await this.repository.findByName(name);
        if (duplicate) {
            throw new ConflictError(
                `A category named "${name}" already exists`
            );
        }
    }

}

// ── Mapper ─────────────────────────────────────────────────────────────────────

function mapCategoryEntityToResponse(entity: CategoryEntity) {
    return {
        id: entity.categoryId,
        name: entity.name,
        description: entity.description,
        displayOrder: entity.displayOrder,
        active: entity.active,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
    };
}

// ── Builder helpers ───────────────────────────────────────────────────────────

function buildCategoryEntity(
    categoryId: string,
    input: CreateCategoryInput,
    now: string
): CategoryEntity {
    return {
        pk: CatalogKeyBuilder.categoryPk(categoryId),
        sk: CatalogKeyBuilder.categorySk(),
        entityType: "CATEGORY",
        categoryId,
        name: input.name,
        description: input.description,
        displayOrder: input.displayOrder ?? 0,
        active: input.active ?? true,
        GSI1PK: CatalogKeyBuilder.gsi1pk(input.name),
        GSI1SK: CatalogKeyBuilder.gsi1sk("CATEGORY"),
        gsi1pk: CatalogKeyBuilder.gsi1pk(input.name),
        gsi1sk: CatalogKeyBuilder.gsi1sk("CATEGORY"),
        lsi1sk: CatalogKeyBuilder.lsi1sk(input.displayOrder ?? 0),
        lsi2sk: CatalogKeyBuilder.lsi2sk(input.active ?? true),
        lsi3sk: CatalogKeyBuilder.lsi3sk("CATEGORY"),
        createdAt: now,
        updatedAt: now,
    };
}

function mergeCategoryEntity(
    existing: CategoryEntity,
    updates: UpdateCategoryInput,
    now: string
): CategoryEntity {
    const name = updates.name ?? existing.name;
    const displayOrder = updates.displayOrder ?? existing.displayOrder;
    const active = updates.active ?? existing.active;

    return {
        ...existing,
        name,
        description: updates.description ?? existing.description,
        displayOrder,
        active,
        GSI1PK: CatalogKeyBuilder.gsi1pk(name),
        GSI1SK: CatalogKeyBuilder.gsi1sk("CATEGORY"),
        gsi1pk: CatalogKeyBuilder.gsi1pk(name),
        gsi1sk: CatalogKeyBuilder.gsi1sk("CATEGORY"),
        lsi1sk: CatalogKeyBuilder.lsi1sk(displayOrder),
        lsi2sk: CatalogKeyBuilder.lsi2sk(active),
        updatedAt: now,
    };
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let service: CategoriesService;

export function getCategoriesService() {

    if (!service) {

        service =
            new CategoriesService();

    }

    return service;

}
