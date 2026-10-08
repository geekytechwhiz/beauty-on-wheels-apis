import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

import {
    assertCatalogAmount,
    assertCatalogName,
} from "../domain/catalog-validation";

/**
 * ---------------------------------------------------------
 * Package
 * ---------------------------------------------------------
 */

const PackageItemSchema = z.object({
    serviceId: z.string().min(1),
    addons: z.array(z.string().min(1)).optional().default([]),
});

export const CreatePackageSchema = z.object({
    name: z.string().min(1, "name is required").max(100),
    description: z.string().max(500).optional(),
    discountedPrice: z.number(),
    displayOrder: z.number().int().min(0).optional().default(0),
    active: z.boolean().optional().default(true),
    items: z.array(PackageItemSchema).min(1, "at least one service item is required"),
}).strict();

export const UpdatePackageSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    discountedPrice: z.number().optional(),
    displayOrder: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
    items: z.array(PackageItemSchema).min(1).optional(),
}).strict();

/** Legacy alias */
export const PackageSchema = CreatePackageSchema;

export type PackageItemInput = z.infer<typeof PackageItemSchema>;
export type CreatePackageInput = z.infer<typeof CreatePackageSchema>;
export type UpdatePackageInput = z.infer<typeof UpdatePackageSchema>;

/** Legacy alias */
export type Package = CreatePackageInput;

export const validatePackage = (req: LambdaRequest): CreatePackageInput => {
    const result = CreatePackageSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    const name = assertCatalogName(result.data.name);
    assertCatalogAmount(result.data.discountedPrice, "discountedPrice");
    return { ...result.data, name };
};

export const validatePackageUpdate = (req: LambdaRequest): UpdatePackageInput => {
    const result = UpdatePackageSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    const name = result.data.name === undefined
        ? undefined
        : assertCatalogName(result.data.name);
    if (result.data.discountedPrice !== undefined) {
        assertCatalogAmount(result.data.discountedPrice, "discountedPrice");
    }
    return {
        ...result.data,
        ...(name === undefined ? {} : { name }),
    };
};
