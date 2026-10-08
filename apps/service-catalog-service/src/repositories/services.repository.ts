import {
    BaseRepository,
} from "@api-hub/utils";

import { env } from "../configs/env.config";
import { CatalogKeyBuilder } from "../utils/constants/catalog-key-builder";
import {
    ServiceEntity,
    ServiceLookupEntity,
    ServiceVehicleEntity,
} from "../utils/types/catalog-domain.types";

const TABLE = () => env.DYNAMODB_TABLE_NAME;

const GSI1_INDEX = "GSI1";
const LSI1_INDEX = "LSI1";
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
            PK: CatalogKeyBuilder.categoryPk(categoryId),
            SK: CatalogKeyBuilder.serviceSk(serviceId),
        });
    }

    async findByServiceId(serviceId: string): Promise<ServiceEntity | null> {
        const lookup = await this.get<ServiceLookupEntity>(TABLE(), {
            PK: CatalogKeyBuilder.serviceLookupPk(serviceId),
            SK: CatalogKeyBuilder.serviceLookupSk(),
        });
        if (!lookup?.categoryId) {
            return null;
        }
        const service = await this.findById(lookup.categoryId, serviceId);
        return service?.entityType === "SERVICE" ? service : null;
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
                "#pk": "PK",
                "#sk": "SK",
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
                "#pk": "PK",
                "#lsi1sk": "LSI1SK",
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
     * Services in a category that apply to one vehicle type.
     * Applicability rows are one item per type, queried on the base table.
     */
    async listByVehicleType(
        categoryId: string,
        vehicleType: string
    ): Promise<ServiceEntity[]> {
        const links = await this.queryAll<ServiceVehicleEntity>({
            TableName: TABLE(),
            KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
            ExpressionAttributeNames: {
                "#pk": "PK",
                "#sk": "SK",
            },
            ExpressionAttributeValues: {
                ":pk": CatalogKeyBuilder.categoryPk(categoryId),
                ":prefix": CatalogKeyBuilder.vehicleApplicabilityPrefix(vehicleType),
            },
        });

        const services = await Promise.all(
            links.map((link) => this.findById(categoryId, link.serviceId)),
        );
        return services.filter(
            (service): service is ServiceEntity =>
                service?.entityType === "SERVICE",
        );
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
            FilterExpression: "entityType = :et",
            ExpressionAttributeNames: {
                "#pk": "PK",
                "#lsi5sk": "LSI5SK",
            },
            ExpressionAttributeValues: {
                ":pk": CatalogKeyBuilder.categoryPk(categoryId),
                ":lsi5sk": CatalogKeyBuilder.lsi5sk(durationMinutes),
                ":et": "SERVICE",
            },
        });
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
                "#pk": "PK",
                "#sk": "SK",
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
        const now = entity.updatedAt;
        await this.transactWrite({
            TransactItems: [
                putNew(entity),
                putNew(buildServiceLookup(entity, now)),
                ...entity.vehicleTypes.map((vehicleType) =>
                    putNew(buildVehicleLink(entity, vehicleType, now)),
                ),
            ],
        });
    }

    async updateService(
        entity: ServiceEntity,
        previousVehicleTypes: readonly string[],
    ): Promise<void> {
        const now = entity.updatedAt;
        const next = new Set(entity.vehicleTypes);
        const previous = new Set(previousVehicleTypes);
        const removed = [...previous].filter((vehicleType) => !next.has(vehicleType));
        const added = [...next].filter((vehicleType) => !previous.has(vehicleType));
        const kept = [...next].filter((vehicleType) => previous.has(vehicleType));

        await this.transactWrite({
            TransactItems: [
                putExisting(entity),
                putUpsert(buildServiceLookup(entity, now)),
                ...removed.map((vehicleType) =>
                    deleteKey(
                        CatalogKeyBuilder.categoryPk(entity.categoryId),
                        CatalogKeyBuilder.vehicleApplicabilitySk(vehicleType, entity.serviceId),
                    ),
                ),
                ...[...added, ...kept].map((vehicleType) =>
                    putUpsert(buildVehicleLink(entity, vehicleType, now)),
                ),
            ],
        });
    }

    async deleteService(entity: ServiceEntity): Promise<void> {
        await this.transactWrite({
            TransactItems: [
                {
                    Delete: {
                        TableName: TABLE(),
                        Key: {
                            PK: entity.PK,
                            SK: entity.SK,
                        },
                        ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
                    },
                },
                deleteKey(
                    CatalogKeyBuilder.serviceLookupPk(entity.serviceId),
                    CatalogKeyBuilder.serviceLookupSk(),
                ),
                ...entity.vehicleTypes.map((vehicleType) =>
                    deleteKey(
                        CatalogKeyBuilder.categoryPk(entity.categoryId),
                        CatalogKeyBuilder.vehicleApplicabilitySk(
                            vehicleType,
                            entity.serviceId,
                        ),
                    ),
                ),
            ],
        });
    }

}

function putNew(item: object) {
    return {
        Put: {
            TableName: TABLE(),
            Item: item,
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
    };
}

function putExisting(item: object) {
    return {
        Put: {
            TableName: TABLE(),
            Item: item,
            ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
        },
    };
}

function putUpsert(item: object) {
    return {
        Put: {
            TableName: TABLE(),
            Item: item,
        },
    };
}

function deleteKey(pk: string, sk: string) {
    return {
        Delete: {
            TableName: TABLE(),
            Key: { PK: pk, SK: sk },
        },
    };
}

function buildServiceLookup(entity: ServiceEntity, now: string): ServiceLookupEntity {
    return {
        PK: CatalogKeyBuilder.serviceLookupPk(entity.serviceId),
        SK: CatalogKeyBuilder.serviceLookupSk(),
        entityType: "SERVICE_LOOKUP",
        categoryId: entity.categoryId,
        serviceId: entity.serviceId,
        active: entity.active,
        createdAt: entity.createdAt,
        updatedAt: now,
    };
}

function buildVehicleLink(
    entity: ServiceEntity,
    vehicleType: string,
    now: string,
): ServiceVehicleEntity {
    return {
        PK: CatalogKeyBuilder.categoryPk(entity.categoryId),
        SK: CatalogKeyBuilder.vehicleApplicabilitySk(vehicleType, entity.serviceId),
        entityType: "SERVICE_VEHICLE",
        categoryId: entity.categoryId,
        serviceId: entity.serviceId,
        vehicleType,
        active: entity.active,
        LSI4SK: CatalogKeyBuilder.lsi4sk(vehicleType),
        createdAt: entity.createdAt,
        updatedAt: now,
    };
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
