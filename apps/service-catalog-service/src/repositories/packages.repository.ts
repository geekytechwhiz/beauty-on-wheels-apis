import {
    BaseRepository,
} from "@api-hub/utils";

import { env } from "../configs/env.config";
import { CatalogKeyBuilder } from "../utils/constants/catalog-key-builder";
import { PackageEntity, PackageItemEntity } from "../utils/types/catalog-domain.types";

const TABLE = () => env.DYNAMODB_TABLE_NAME;

const GSI1_INDEX = "GSI1";
const LSI2_INDEX = "LSI2";

export class PackagesRepository extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return TABLE();
    }

    // ── Read operations ──────────────────────────────────────────────────────

    async findById(packageId: string): Promise<PackageEntity | null> {
        return this.get<PackageEntity>(TABLE(), {
            PK: CatalogKeyBuilder.packagePk(packageId),
            SK: CatalogKeyBuilder.packageSk(),
        });
    }

    /**
     * List package index rows.
     *
     * The aggregate partition key is CATALOG#PACKAGES and the sort key is
     * META#PACKAGE#<id> on the base table. LSI3's range key is LSI3SK, so a
     * condition on SK cannot be sent to that index.
     *
     * Active packages use LSI2 (PK + LSI2SK = ACTIVE#1), which is populated on
     * the same index rows.
     */
    async listPackages(params?: {
        activeOnly?: boolean;
        limit?: number;
        lastEvaluatedKey?: Record<string, unknown>;
    }): Promise<{ items: PackageEntity[]; lastEvaluatedKey?: Record<string, unknown> }> {
        if (params?.activeOnly) {
            return this.queryPage<PackageEntity>({
                TableName: TABLE(),
                IndexName: LSI2_INDEX,
                KeyConditionExpression: "#pk = :pk AND #lsi2sk = :lsi2sk",
                ExpressionAttributeNames: {
                    "#pk": "PK",
                    "#lsi2sk": "LSI2SK",
                },
                ExpressionAttributeValues: {
                    ":pk": PACKAGES_AGGREGATE_PK,
                    ":lsi2sk": CatalogKeyBuilder.lsi2sk(true),
                },
                Limit: params.limit,
                ExclusiveStartKey: params.lastEvaluatedKey as any,
            });
        }

        return this.queryPage<PackageEntity>({
            TableName: TABLE(),
            KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
            ExpressionAttributeNames: {
                "#pk": "PK",
                "#sk": "SK",
            },
            ExpressionAttributeValues: {
                ":pk": PACKAGES_AGGREGATE_PK,
                ":skPrefix": "META#PACKAGE#",
            },
            Limit: params?.limit,
            ExclusiveStartKey: params?.lastEvaluatedKey as any,
        });
    }

    /**
     * Get all items (services + addons) belonging to a package.
     */
    async listPackageItems(packageId: string): Promise<PackageItemEntity[]> {
        return this.queryAll<PackageItemEntity>({
            TableName: TABLE(),
            KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
            ExpressionAttributeNames: {
                "#pk": "PK",
                "#sk": "SK",
            },
            ExpressionAttributeValues: {
                ":pk": CatalogKeyBuilder.packagePk(packageId),
                ":skPrefix": CatalogKeyBuilder.packageItemPrefix(),
            },
        });
    }

    /**
     * Get only service items within a package.
     */
    async listPackageServiceItems(packageId: string): Promise<PackageItemEntity[]> {
        return this.queryAll<PackageItemEntity>({
            TableName: TABLE(),
            KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
            FilterExpression: "itemType = :itemType",
            ExpressionAttributeNames: {
                "#pk": "PK",
                "#sk": "SK",
            },
            ExpressionAttributeValues: {
                ":pk": CatalogKeyBuilder.packagePk(packageId),
                ":skPrefix": "ITEM#SERVICE#",
                ":itemType": "SERVICE",
            },
        });
    }

    /**
     * Get only addon items within a package.
     */
    async listPackageAddonItems(packageId: string): Promise<PackageItemEntity[]> {
        return this.queryAll<PackageItemEntity>({
            TableName: TABLE(),
            KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
            FilterExpression: "itemType = :itemType",
            ExpressionAttributeNames: {
                "#pk": "PK",
                "#sk": "SK",
            },
            ExpressionAttributeValues: {
                ":pk": CatalogKeyBuilder.packagePk(packageId),
                ":skPrefix": "ITEM#ADDON#",
                ":itemType": "ADDON",
            },
        });
    }

    /**
     * Check if a package name is already taken (GSI1 — global name search).
     */
    async findByName(name: string): Promise<PackageEntity | null> {
        return this.queryOne<PackageEntity>({
            TableName: TABLE(),
            IndexName: GSI1_INDEX,
            KeyConditionExpression: "#gsi1pk = :gsi1pk AND #gsi1sk = :gsi1sk",
            ExpressionAttributeNames: {
                "#gsi1pk": "GSI1PK",
                "#gsi1sk": "GSI1SK",
            },
            ExpressionAttributeValues: {
                ":gsi1pk": CatalogKeyBuilder.gsi1pk(name),
                ":gsi1sk": CatalogKeyBuilder.gsi1sk("PACKAGE"),
            },
        });
    }

    // ── Write operations ─────────────────────────────────────────────────────

    /**
     * Create a package + its items in a single transaction.
     */
    async createPackage(
        entity: PackageEntity,
        items: PackageItemEntity[]
    ): Promise<void> {
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
                        Item: buildPackageIndexEntry(entity) as any,
                    },
                },
                ...items.map(item => ({
                    Put: {
                        TableName: TABLE(),
                        Item: item as any,
                        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
                    },
                })),
            ],
        });
    }

    /**
     * Update a package header + replace its items in a single transaction.
     * Deletes existing item records and inserts fresh ones.
     */
    async updatePackage(
        entity: PackageEntity,
        existingItems: PackageItemEntity[],
        newItems: PackageItemEntity[]
    ): Promise<void> {
        const deleteOps = existingItems.map(item => ({
            Delete: {
                TableName: TABLE(),
                Key: {
                    PK: item.PK,
                    SK: item.SK,
                },
            },
        }));

        const putOps = [
            {
                Put: {
                    TableName: TABLE(),
                    Item: entity as any,
                    ConditionExpression: "attribute_exists(PK)",
                },
            },
            {
                Put: {
                    TableName: TABLE(),
                    Item: buildPackageIndexEntry(entity) as any,
                },
            },
            ...newItems.map(item => ({
                Put: {
                    TableName: TABLE(),
                    Item: item as any,
                },
            })),
        ];

        await this.transactWrite({
            TransactItems: [...deleteOps, ...putOps],
        });
    }

    async deletePackage(packageId: string): Promise<void> {
        await this.transactWrite({
            TransactItems: [
                {
                    Delete: {
                        TableName: TABLE(),
                        Key: {
                            PK: CatalogKeyBuilder.packagePk(packageId),
                            SK: CatalogKeyBuilder.packageSk(),
                        },
                        ConditionExpression: "attribute_exists(PK)",
                    },
                },
                // Remove aggregate index entry
                {
                    Delete: {
                        TableName: TABLE(),
                        Key: {
                            PK: PACKAGES_AGGREGATE_PK,
                            SK: `META#PACKAGE#${packageId}`,
                        },
                    },
                },
            ],
        });
    }

    async deletePackageItem(pkKey: string, skKey: string): Promise<void> {
        await this.transactWrite({
            TransactItems: [
                {
                    Delete: {
                        TableName: TABLE(),
                        Key: {
                            PK: pkKey,
                            SK: skKey,
                        },
                    },
                },
            ],
        });
    }

}

// ── Internal helpers ──────────────────────────────────────────────────────────

const PACKAGES_AGGREGATE_PK = "CATALOG#PACKAGES";

function buildPackageIndexEntry(entity: PackageEntity): Record<string, unknown> {
    return {
        PK: PACKAGES_AGGREGATE_PK,
        SK: `META#PACKAGE#${entity.packageId}`,
        entityType: entity.entityType,
        packageId: entity.packageId,
        name: entity.name,
        discountedPrice: entity.discountedPrice,
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

let repository: PackagesRepository;

export function getPackagesRepository() {

    if (!repository) {

        repository =
            new PackagesRepository();

    }

    return repository;

}
