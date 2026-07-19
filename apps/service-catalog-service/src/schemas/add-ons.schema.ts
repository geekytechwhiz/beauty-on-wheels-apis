import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

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
    price: z.number().min(0, "price must be non-negative"),
    durationMinutes: z.number().int().min(1, "durationMinutes must be at least 1"),
    displayOrder: z.number().int().min(0).optional().default(0),
    active: z.boolean().optional().default(true),
}).strict();

export const UpdateAddOnSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    price: z.number().min(0).optional(),
    durationMinutes: z.number().int().min(1).optional(),
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
    return result.data;
};

export const validateAddOnUpdate = (req: LambdaRequest): UpdateAddOnInput => {
    const result = UpdateAddOnSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
