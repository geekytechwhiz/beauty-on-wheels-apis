import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * Service
 * ---------------------------------------------------------
 */

export const CreateServiceSchema = z.object({
    categoryId: z.string().min(1, "categoryId is required"),
    name: z.string().min(1, "name is required").max(100),
    description: z.string().max(500).optional(),
    durationMinutes: z.number().int().min(1, "durationMinutes must be at least 1"),
    vehicleTypes: z.array(z.string().min(1)).min(1, "at least one vehicleType is required"),
    basePrice: z.number().min(0, "basePrice must be non-negative"),
    displayOrder: z.number().int().min(0).optional().default(0),
    active: z.boolean().optional().default(true),
}).strict();

export const UpdateServiceSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    durationMinutes: z.number().int().min(1).optional(),
    vehicleTypes: z.array(z.string().min(1)).optional(),
    basePrice: z.number().min(0).optional(),
    displayOrder: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
}).strict();

/** Legacy alias */
export const ServiceSchema = CreateServiceSchema;

export type CreateServiceInput = z.infer<typeof CreateServiceSchema>;
export type UpdateServiceInput = z.infer<typeof UpdateServiceSchema>;

/** Legacy alias */
export type Service = CreateServiceInput;

export const validateService = (req: LambdaRequest): CreateServiceInput => {
    const result = CreateServiceSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};

export const validateServiceUpdate = (req: LambdaRequest): UpdateServiceInput => {
    const result = UpdateServiceSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
