import {
    BaseRepository,
} from "@api-hub/utils";

import { env } from "../configs/env.config";
import { CatalogKeyBuilder } from "../utils/constants/catalog-key-builder";
import { ServiceEntity } from "../utils/types/catalog-domain.types";

const TABLE = () => env.DYNAMODB_TABLE_NAME;

const GSI1_INDEX = "GSI1";
const LSI1_INDEX = "LSI1";
const LSI4_INDEX = "LSI4";
const LSI5_INDEX = "LSI5";

export class ServicesRepository extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return TABLE();
    }

    // ── Read operations ──────────────────────────────────────────────────────

    async findById(categoryId: string, serviceId: string): Promise<ServiceEntity | null> {
        return this.get<ServiceEntity>(TABLE(), {
            pk: CatalogKeyBuilder.categoryPk(categoryId),
            sk: CatalogKeyBuilder.serviceSk(serviceId),
        });
    }

    /**
     * List all services under a specific category (parent-scoped query).
     */
    async listByCategory(
        categoryId: string,
        params?: {
            activeOnly?: boolean;
            limit?: number;
            lastEvaluatedKey?: Record<string, unknown>;
        }
    ): Promise<{ items: ServiceEntity[]; lastEvaluatedKey?: Record<string, unknown> }> {
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
                ":skPrefix": CatalogKeyBuilder.serviceSkPrefix(),
                ":et": "SERVICE",
            },
            Limit: params?.limit,
            ExclusiveStartKey: params?.lastEvaluatedKey as any,
        };

        if (params?.activeOnly) {
            queryParams.FilterExpression += " AND #active = :active";
            queryParams.ExpressionAttributeNames["#active"] = "active";
            queryParams.ExpressionAttributeValues[":active"] = true;
        }

        return this.queryPage<ServiceEntity>(queryParams);
    }

    /**
     * List all services under a category ordered by displayOrder (LSI1).
     */
    async listByCategoryOrdered(categoryId: string): Promise<ServiceEntity[]> {
        return this.queryAll<ServiceEntity>({
            TableName: TABLE(),
            IndexName: LSI1_INDEX,
            KeyConditionExpression: "#pk = :pk AND begins_with(#lsi1sk, :prefix)",
            FilterExpression: "entityType = :et",
            ExpressionAttributeNames: {
                "#pk": "pk",
                "#lsi1sk": "lsi1sk",
            },
            ExpressionAttributeValues: {
                ":pk": CatalogKeyBuilder.categoryPk(categoryId),
                ":prefix": "DISPLAY_ORDER#",
                ":et": "SERVICE",
            },
        }).then(items =>
            items.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
        );
    }

    /**
     * List all services under a category filtered by vehicleType (LSI4).
     */
    async listByVehicleType(
        categoryId: string,
        vehicleType: string
    ): Promise<ServiceEntity[]> {
        return this.queryAll<ServiceEntity>({
            TableName: TABLE(),
            IndexName: LSI4_INDEX,
            KeyConditionExpression: "#pk = :pk AND #lsi4sk = :lsi4sk",
            ExpressionAttributeNames: {
                "#pk": "pk",
                "#lsi4sk": "lsi4sk",
            },
            ExpressionAttributeValues: {
                ":pk": CatalogKeyBuilder.categoryPk(categoryId),
                ":lsi4sk": CatalogKeyBuilder.lsi4sk(vehicleType),
            },
            FilterExpression: "entityType = :et",
        }).then(items => items.filter(i => i.entityType === "SERVICE"));
    }

    /**
     * List all services under a category filtered by duration (LSI5).
     */
    async listByDuration(
        categoryId: string,
        durationMinutes: number
    ): Promise<ServiceEntity[]> {
        return this.queryAll<ServiceEntity>({
            TableName: TABLE(),
            IndexName: LSI5_INDEX,
            KeyConditionExpression: "#pk = :pk AND #lsi5sk = :lsi5sk",
            ExpressionAttributeNames: {
                "#pk": "pk",
                "#lsi5sk": "lsi5sk",
            },
            ExpressionAttributeValues: {
                ":pk": CatalogKeyBuilder.categoryPk(categoryId),
                ":lsi5sk": CatalogKeyBuilder.lsi5sk(durationMinutes),
            },
            FilterExpression: "entityType = :et",
        }).then(items => items.filter(i => i.entityType === "SERVICE"));
    }

    /**
     * Search by name within a category (GSI1 — global name search).
     */
    async findByName(name: string, categoryId?: string): Promise<ServiceEntity | null> {
        const queryParams: any = {
            TableName: TABLE(),
            IndexName: GSI1_INDEX,
            KeyConditionExpression: "#gsi1pk = :gsi1pk AND #gsi1sk = :gsi1sk",
            ExpressionAttributeNames: {
                "#gsi1pk": "GSI1PK",
                "#gsi1sk": "GSI1SK",
            },
            ExpressionAttributeValues: {
                ":gsi1pk": CatalogKeyBuilder.gsi1pk(name),
                ":gsi1sk": CatalogKeyBuilder.gsi1sk("SERVICE"),
            },
        };

        if (categoryId) {
            queryParams.FilterExpression = "categoryId = :catId";
            queryParams.ExpressionAttributeValues[":catId"] = categoryId;
        }

        return this.queryOne<ServiceEntity>(queryParams);
    }

    /**
     * Count addons under a service (delete constraint check).
     */
    async countAddons(categoryId: string, serviceId: string): Promise<number> {
        const items = await this.queryAll<any>({
            TableName: TABLE(),
            KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
            ExpressionAttributeNames: {
                "#pk": "pk",
                "#sk": "sk",
            },
            ExpressionAttributeValues: {
                ":pk": CatalogKeyBuilder.categoryPk(categoryId),
                ":skPrefix": CatalogKeyBuilder.addonSkPrefix(serviceId),
            },
        });
        return items.length;
    }

    // ── Write operations ─────────────────────────────────────────────────────

    async createService(entity: ServiceEntity): Promise<void> {
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

    async updateService(entity: ServiceEntity): Promise<void> {
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

    async deleteService(categoryId: string, serviceId: string): Promise<void> {
        await this.transactWrite({
            TransactItems: [
                {
                    Delete: {
                        TableName: TABLE(),
                        Key: {
                            pk: CatalogKeyBuilder.categoryPk(categoryId),
                            sk: CatalogKeyBuilder.serviceSk(serviceId),
                        },
                        ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
                    },
                },
            ],
        });
    }

}

// ── Singleton ─────────────────────────────────────────────────────────────────

let repository: ServicesRepository;

export function getServicesRepository() {

    if (!repository) {

        repository =
            new ServicesRepository();

    }

    return repository;

}
