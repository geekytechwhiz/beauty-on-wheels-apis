import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * CreateServiceAreaRequest
 * ---------------------------------------------------------
 */

export const CreateServiceAreaRequestSchema = z.object({
name: z.string(),
city: z.string(),
state: z.string().optional(),
postalCodes: z.array(z.string()).optional(),
center: z.object({
latitude: z.number().min(-90).max(90),
longitude: z.number().min(-180).max(180)
}).optional(),
radiusKm: z.number().min(0).optional(),
active: z.boolean().optional()
}).strict();

export type CreateServiceAreaRequest =
    z.infer<typeof CreateServiceAreaRequestSchema>;

export const validateCreateServiceAreaRequest = (req: LambdaRequest): CreateServiceAreaRequest => {
    const result = CreateServiceAreaRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};

/**
 * ---------------------------------------------------------
 * UpdateServiceAreaRequest
 * ---------------------------------------------------------
 */

export const UpdateServiceAreaRequestSchema = z.object({
name: z.string().optional(),
city: z.string().optional(),
state: z.string().optional(),
postalCodes: z.array(z.string()).optional(),
center: z.object({
latitude: z.number().min(-90).max(90),
longitude: z.number().min(-180).max(180)
}).optional(),
radiusKm: z.number().min(0).optional(),
active: z.boolean().optional()
}).strict();

export type UpdateServiceAreaRequest =
    z.infer<typeof UpdateServiceAreaRequestSchema>;

export const validateUpdateServiceAreaRequest = (req: LambdaRequest): UpdateServiceAreaRequest => {
    const result = UpdateServiceAreaRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
