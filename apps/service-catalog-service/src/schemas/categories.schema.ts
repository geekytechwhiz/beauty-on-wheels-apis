import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * Category
 * ---------------------------------------------------------
 */

export const CreateCategorySchema = z.object({
    name: z.string().min(1, "name is required").max(100),
    description: z.string().max(500).optional(),
    displayOrder: z.number().int().min(0).optional().default(0),
    active: z.boolean().optional().default(true),
}).strict();

export const UpdateCategorySchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    displayOrder: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
}).strict();

/** Legacy alias kept for backward-compat with handler imports */
export const CategorySchema = CreateCategorySchema;

export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;

/** Legacy type alias */
export type Category = CreateCategoryInput;

export const validateCategory = (req: LambdaRequest): CreateCategoryInput => {
    const result = CreateCategorySchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};

export const validateCategoryUpdate = (req: LambdaRequest): UpdateCategoryInput => {
    const result = UpdateCategorySchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
