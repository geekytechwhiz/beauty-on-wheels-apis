import {
    BaseRepository,
} from "@api-hub/utils";

import { env } from "../configs/env.config";
import { CatalogKeyBuilder } from "../utils/constants/catalog-key-builder";
import { AddonEntity } from "../utils/types/catalog-domain.types";

const TABLE = () => env.DYNAMODB_TABLE_NAME;

const LSI1_INDEX = "LSI1";

export class AddOnsRepository extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return TABLE();
    }

    // ── Read operations ──────────────────────────────────────────────────────

    async findById(
        categoryId: string,
        serviceId: string,
        addonId: string
    ): Promise<AddonEntity | null> {
        return this.get<AddonEntity>(TABLE(), {
            PK: CatalogKeyBuilder.categoryPk(categoryId),
            SK: CatalogKeyBuilder.addonSk(serviceId, addonId),
        });
    }

    /**
     * List all addons under a specific service (parent-scoped query).
     */
    async listByService(
        categoryId: string,
        serviceId: string,
        params?: {
            activeOnly?: boolean;
            limit?: number;
            lastEvaluatedKey?: Record<string, unknown>;
        }
    ): Promise<{ items: AddonEntity[]; lastEvaluatedKey?: Record<string, unknown> }> {
        const queryParams: any = {
            TableName: TABLE(),
            KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
            FilterExpression: "entityType = :et",
            ExpressionAttributeNames: {
                "#pk": "PK",
                "#sk": "SK",
            },
            ExpressionAttributeValues: {
                ":pk": CatalogKeyBuilder.categoryPk(categoryId),
                ":skPrefix": CatalogKeyBuilder.addonSkPrefix(serviceId),
                ":et": "ADDON",
            },
            Limit: params?.limit,
            ExclusiveStartKey: params?.lastEvaluatedKey as any,
        };

        if (params?.activeOnly) {
            queryParams.FilterExpression += " AND #active = :active";
            queryParams.ExpressionAttributeNames["#active"] = "active";
            queryParams.ExpressionAttributeValues[":active"] = true;
        }

        return this.queryPage<AddonEntity>(queryParams);
    }

    /**
     * List all addons under a service ordered by displayOrder (LSI1).
     */
    async listByServiceOrdered(
        categoryId: string,
        serviceId: string
    ): Promise<AddonEntity[]> {
        return this.queryAll<AddonEntity>({
            TableName: TABLE(),
            IndexName: LSI1_INDEX,
            KeyConditionExpression: "#pk = :pk AND begins_with(#lsi1sk, :prefix)",
            FilterExpression: "entityType = :et AND serviceId = :svcId",
            ExpressionAttributeNames: {
                "#pk": "PK",
                "#lsi1sk": "LSI1SK",
            },
            ExpressionAttributeValues: {
                ":pk": CatalogKeyBuilder.categoryPk(categoryId),
                ":prefix": "DISPLAY_ORDER#",
                ":et": "ADDON",
                ":svcId": serviceId,
            },
        }).then(items =>
            items.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
        );
    }

    /**
     * Find addon by name within a service (duplicate check).
     */
    async findByNameInService(
        name: string,
        categoryId: string,
        serviceId: string
    ): Promise<AddonEntity | null> {
        return this.queryOne<AddonEntity>({
            TableName: TABLE(),
            KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
            FilterExpression: "entityType = :et AND #gsi1pk = :gsi1pk",
            ExpressionAttributeNames: {
                "#pk": "PK",
                "#sk": "SK",
                "#gsi1pk": "GSI1PK",
            },
            ExpressionAttributeValues: {
                ":pk": CatalogKeyBuilder.categoryPk(categoryId),
                ":skPrefix": CatalogKeyBuilder.addonSkPrefix(serviceId),
                ":et": "ADDON",
                ":gsi1pk": CatalogKeyBuilder.gsi1pk(name),
            },
        });
    }

    // ── Write operations ─────────────────────────────────────────────────────

    async createAddon(entity: AddonEntity): Promise<void> {
        await this.transactWrite({
            TransactItems: [
                {
                    Put: {
                        TableName: TABLE(),
                        Item: entity as any,
                        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
                    },
                },
            ],
        });
    }

    async updateAddon(entity: AddonEntity): Promise<void> {
        await this.transactWrite({
            TransactItems: [
                {
                    Put: {
                        TableName: TABLE(),
                        Item: entity as any,
                        ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
                    },
                },
            ],
        });
    }

    async deleteAddon(
        categoryId: string,
        serviceId: string,
        addonId: string
    ): Promise<void> {
        await this.transactWrite({
            TransactItems: [
                {
                    Delete: {
                        TableName: TABLE(),
                        Key: {
                            PK: CatalogKeyBuilder.categoryPk(categoryId),
                            SK: CatalogKeyBuilder.addonSk(serviceId, addonId),
                        },
                        ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
                    },
                },
            ],
        });
    }

}

// ── Singleton ─────────────────────────────────────────────────────────────────

let repository: AddOnsRepository;

export function getAddOnsRepository() {

    if (!repository) {

        repository =
            new AddOnsRepository();

    }

    return repository;

}
