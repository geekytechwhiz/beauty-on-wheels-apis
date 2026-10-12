import { QueryCommandInput } from "@aws-sdk/lib-dynamodb";

import { CatalogKeyBuilder } from "../utils/constants/catalog-key-builder";

export const GSI2_VENDOR_INDEX = "GSI2";

/**
 * List one vendor's catalog rows. Sort-key prefixes separate services, packages, and add-ons.
 * Active and other non-key filters stay on FilterExpression.
 */
export function vendorCatalogQuery(input: {
    tableName: string;
    vendorId: string;
    sortKeyPrefix: string;
    entityType: string;
    activeOnly?: boolean;
    extraFilters?: string[];
    extraNames?: Record<string, string>;
    extraValues?: Record<string, unknown>;
    limit?: number;
    lastEvaluatedKey?: Record<string, unknown>;
}): QueryCommandInput {
    const names: Record<string, string> = {
        "#gsi2pk": "GSI2PK",
        "#gsi2sk": "GSI2SK",
        ...(input.extraNames ?? {}),
    };
    const values: Record<string, unknown> = {
        ":gsi2pk": CatalogKeyBuilder.vendorPk(input.vendorId),
        ":skPrefix": input.sortKeyPrefix,
        ":et": input.entityType,
        ...(input.extraValues ?? {}),
    };
    const filters = ["entityType = :et", ...(input.extraFilters ?? [])];
    if (input.activeOnly) {
        names["#active"] = "active";
        values[":active"] = true;
        filters.push("#active = :active");
    }

    return {
        TableName: input.tableName,
        IndexName: GSI2_VENDOR_INDEX,
        KeyConditionExpression: "#gsi2pk = :gsi2pk AND begins_with(#gsi2sk, :skPrefix)",
        FilterExpression: filters.join(" AND "),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        Limit: input.limit,
        ExclusiveStartKey: input.lastEvaluatedKey as QueryCommandInput["ExclusiveStartKey"],
    };
}
