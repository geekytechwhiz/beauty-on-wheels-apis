import {
    BaseRepository,
} from "@api-hub/utils";

import { env } from "../configs/env.config";
import { CatalogKeyBuilder } from "../utils/constants/catalog-key-builder";
import { CategoryEntity } from "../utils/types/catalog-domain.types";

const TABLE = () => env.DYNAMODB_TABLE_NAME;

const GSI1_INDEX = "GSI1";
const LSI1_INDEX = "LSI1";
const LSI2_INDEX = "LSI2";

export class CategoriesRepository extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return TABLE();
    }

    // ── Read operations ──────────────────────────────────────────────────────

    async findById(categoryId: string): Promise<CategoryEntity | null> {
        return this.get<CategoryEntity>(TABLE(), {
            PK: CatalogKeyBuilder.categoryPk(categoryId),
            SK: CatalogKeyBuilder.categorySk(),
        });
    }

    /**
     * List all categories using a direct query on the category aggregate record.
     * Queries all items with pk prefix CAT# and sk = META using a GSI.
     * Since the project uses a single-table design, we maintain a "catalog index" record.
     */
    async listCategories(params?: {
        activeOnly?: boolean;
        limit?: number;
        lastEvaluatedKey?: Record<string, unknown>;
    }): Promise<{ items: CategoryEntity[]; lastEvaluatedKey?: Record<string, unknown> }> {
        const queryParams: any = {
            TableName: TABLE(),
            IndexName: LSI3_INDEX,
            KeyConditionExpression: "#pk = :pk AND #lsi3sk = :lsi3sk",
            ExpressionAttributeNames: {
                "#pk": "PK",
                "#lsi3sk": "LSI3SK",
            },
            ExpressionAttributeValues: {
                ":pk": CATALOG_AGGREGATE_PK,
                ":lsi3sk": CatalogKeyBuilder.lsi3sk("CATEGORY"),
            },
            Limit: params?.limit,
            ExclusiveStartKey: params?.lastEvaluatedKey as any,
        };

        if (params?.activeOnly) {
            queryParams.FilterExpression = "#active = :active";
            queryParams.ExpressionAttributeNames["#active"] = "active";
            queryParams.ExpressionAttributeValues[":active"] = true;
        }

        return this.queryPage<CategoryEntity>(queryParams);
    }

    /**
     * List all categories ordered by displayOrder ascending (LSI1).
     */
    async listCategoriesOrdered(): Promise<CategoryEntity[]> {
        return this.queryAll<CategoryEntity>({
            TableName: TABLE(),
            IndexName: LSI1_INDEX,
            KeyConditionExpression: "#pk = :pk",
            ExpressionAttributeNames: { "#pk": "PK" },
            ExpressionAttributeValues: {
                ":pk": CATALOG_AGGREGATE_PK,
            },
            FilterExpression: "entityType = :et",
            // Note: FilterExpression is outside KeyCondition; add to ExpressionAttributeValues
        }).then(items =>
            items
                .filter((i: any) => i.entityType === "CATEGORY")
                .sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
        );
    }

    /**
     * List active categories only.
     */
    async listActiveCategories(): Promise<CategoryEntity[]> {
        return this.queryAll<CategoryEntity>({
            TableName: TABLE(),
            IndexName: LSI2_INDEX,
            KeyConditionExpression: "#pk = :pk AND #lsi2sk = :lsi2sk",
            ExpressionAttributeNames: {
                "#pk": "PK",
                "#lsi2sk": "LSI2SK",
            },
            ExpressionAttributeValues: {
                ":pk": CATALOG_AGGREGATE_PK,
                ":lsi2sk": CatalogKeyBuilder.lsi2sk(true),
            },
            FilterExpression: "entityType = :et",
            // Note: we need entityType in ExpressionAttributeValues but can't reuse if not named:
        }).then(items => items.filter((i: any) => i.entityType === "CATEGORY"));
    }

    /**
     * Check if a category name is already taken (GSI1 — global name search).
     */
    async findByName(name: string): Promise<CategoryEntity | null> {
        return this.queryOne<CategoryEntity>({
            TableName: TABLE(),
            IndexName: GSI1_INDEX,
            KeyConditionExpression: "#gsi1pk = :gsi1pk AND #gsi1sk = :gsi1sk",
            ExpressionAttributeNames: {
                "#gsi1pk": "GSI1PK",
                "#gsi1sk": "GSI1SK",
            },
            ExpressionAttributeValues: {
                ":gsi1pk": CatalogKeyBuilder.gsi1pk(name),
                ":gsi1sk": CatalogKeyBuilder.gsi1sk("CATEGORY"),
            },
        });
    }

    /**
     * Count how many services exist under a category (to enforce delete constraint).
     */
    async countServices(categoryId: string): Promise<number> {
        const items = await this.query<{ PK: string; SK: string }>({
            TableName: TABLE(),
            KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
            ExpressionAttributeNames: {
                "#pk": "PK",
                "#sk": "SK",
            },
            ExpressionAttributeValues: {
                ":pk": CatalogKeyBuilder.categoryPk(categoryId),
                ":skPrefix": CatalogKeyBuilder.serviceSkPrefix(),
            },
            Select: "COUNT",
        } as any);
        return (items as any).length ?? 0;
    }

    /**
     * Count active services under a category (for deactivation guard).
     */
    async countActiveServices(categoryId: string): Promise<number> {
        const services = await this.queryAll<any>({
            TableName: TABLE(),
            KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
            FilterExpression: "#active = :active AND entityType = :et",
            ExpressionAttributeNames: {
                "#pk": "PK",
                "#sk": "SK",
                "#active": "active",
            },
            ExpressionAttributeValues: {
                ":pk": CatalogKeyBuilder.categoryPk(categoryId),
                ":skPrefix": CatalogKeyBuilder.serviceSkPrefix(),
                ":active": true,
                ":et": "SERVICE",
            },
        });
        return services.length;
    }

    // ── Write operations ─────────────────────────────────────────────────────

    async createCategory(entity: CategoryEntity): Promise<void> {
        await this.transactWrite({
            TransactItems: [
                {
                    Put: {
                        TableName: TABLE(),
                        Item: entity as any,
                        ConditionExpression: "attribute_not_exists(PK)",
                    },
                },
                // Aggregate index entry for listing
                {
                    Put: {
                        TableName: TABLE(),
                        Item: buildCategoryIndexEntry(entity) as any,
                        ConditionExpression: "attribute_not_exists(PK)",
                    },
                },
            ],
        });
    }

    async updateCategory(entity: CategoryEntity): Promise<void> {
        await this.transactWrite({
            TransactItems: [
                {
                    Put: {
                        TableName: TABLE(),
                        Item: entity as any,
                        ConditionExpression: "attribute_exists(PK)",
                    },
                },
                // Update aggregate index entry
                {
                    Put: {
                        TableName: TABLE(),
                        Item: buildCategoryIndexEntry(entity) as any,
                    },
                },
            ],
        });
    }

    async deleteCategory(categoryId: string): Promise<void> {
        await this.transactWrite({
            TransactItems: [
                {
                    Delete: {
                        TableName: TABLE(),
                        Key: {
                            PK: CatalogKeyBuilder.categoryPk(categoryId),
                            SK: CatalogKeyBuilder.categorySk(),
                        },
                        ConditionExpression: "attribute_exists(PK)",
                    },
                },
                // Remove aggregate index entry
                {
                    Delete: {
                        TableName: TABLE(),
                        Key: {
                            PK: CATALOG_AGGREGATE_PK,
                            SK: CatalogKeyBuilder.categorySk() + "#CAT#" + categoryId,
                        },
                    },
                },
            ],
        });
    }

}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Aggregate PK used for listing all categories. This is a well-known partition key
 * that stores index entries for all categories so we can query them without a scan.
 */
const CATALOG_AGGREGATE_PK = "CATALOG#CATEGORIES";
const LSI3_INDEX = "LSI3";

function buildCategoryIndexEntry(entity: CategoryEntity): Record<string, unknown> {
    return {
        PK: CATALOG_AGGREGATE_PK,
        SK: `META#CAT#${entity.categoryId}`,
        entityType: entity.entityType,
        categoryId: entity.categoryId,
        name: entity.name,
        displayOrder: entity.displayOrder,
        active: entity.active,
        LSI1SK: entity.LSI1SK,
        LSI2SK: entity.LSI2SK,
        LSI3SK: entity.LSI3SK,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
    };
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let repository: CategoriesRepository;

export function getCategoriesRepository() {

    if (!repository) {

        repository =
            new CategoriesRepository();

    }

    return repository;

}
