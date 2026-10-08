import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";
import {
    assertCatalogAmount,
    assertCatalogName,
    assertPositiveDuration,
} from "../domain/catalog-validation";

/**
 * ---------------------------------------------------------
 * AddOn
 * ---------------------------------------------------------
 */

export const CreateAddOnSchema = z.object({
    serviceId: z.string().min(1, "serviceId is required"),
    categoryId: z.string().min(1, "categoryId is required"),
    name: z.string().min(1, "name is required").max(100),
    description: z.string().max(500).optional(),
    price: z.number(),
    durationMinutes: z.number(),
    displayOrder: z.number().int().min(0).optional().default(0),
    active: z.boolean().optional().default(true),
}).strict();

export const UpdateAddOnSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    price: z.number().optional(),
    durationMinutes: z.number().optional(),
    displayOrder: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
}).strict();

/** Legacy alias */
export const AddOnSchema = CreateAddOnSchema;

export type CreateAddOnInput = z.infer<typeof CreateAddOnSchema>;
export type UpdateAddOnInput = z.infer<typeof UpdateAddOnSchema>;

/** Legacy alias */
export type AddOn = CreateAddOnInput;

export const validateAddOn = (req: LambdaRequest): CreateAddOnInput => {
    const result = CreateAddOnSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    const name = assertCatalogName(result.data.name);
    assertCatalogAmount(result.data.price, "price");
    assertPositiveDuration(result.data.durationMinutes);
    return { ...result.data, name };
};

export const validateAddOnUpdate = (req: LambdaRequest): UpdateAddOnInput => {
    const result = UpdateAddOnSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    const name = result.data.name === undefined
        ? undefined
        : assertCatalogName(result.data.name);
    if (result.data.price !== undefined) {
        assertCatalogAmount(result.data.price, "price");
    }
    if (result.data.durationMinutes !== undefined) {
        assertPositiveDuration(result.data.durationMinutes);
    }
    return {
        ...result.data,
        ...(name === undefined ? {} : { name }),
    };
};
