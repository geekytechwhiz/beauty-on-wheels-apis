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
            pk: CatalogKeyBuilder.categoryPk(categoryId),
            sk: CatalogKeyBuilder.addonSk(serviceId, addonId),
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
                "#pk": "pk",
                "#sk": "sk",
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
                "#pk": "pk",
                "#lsi1sk": "lsi1sk",
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
            FilterExpression: "entityType = :et AND (#gsi1pk = :gsi1pk OR #gsi1pk_lower = :gsi1pk)",
            ExpressionAttributeNames: {
                "#pk": "pk",
                "#sk": "sk",
                "#gsi1pk": "GSI1PK",
                "#gsi1pk_lower": "gsi1pk",
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
                        ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
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
                        ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
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
                            pk: CatalogKeyBuilder.categoryPk(categoryId),
                            sk: CatalogKeyBuilder.addonSk(serviceId, addonId),
                        },
                        ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
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
