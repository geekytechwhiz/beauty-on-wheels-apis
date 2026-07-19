import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * CreateStaffRequest
 * ---------------------------------------------------------
 */

export const CreateStaffRequestSchema = z.object({
userId: z.string().optional(),
name: z.string().min(2).max(100),
phoneNumber: z.string(),
email: z.string().email().optional(),
role: z.string().optional(),
status: z.enum(["ACTIVE", "INACTIVE"]).optional()
}).strict();

export type CreateStaffRequest =
    z.infer<typeof CreateStaffRequestSchema>;

export const validateCreateStaffRequest = (req: LambdaRequest): CreateStaffRequest => {
    const result = CreateStaffRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};

/**
 * ---------------------------------------------------------
 * UpdateStaffRequest
 * ---------------------------------------------------------
 */

export const UpdateStaffRequestSchema = z.object({
name: z.string().optional(),
phoneNumber: z.string().optional(),
email: z.string().email().optional(),
role: z.string().optional(),
status: z.enum(["ACTIVE", "INACTIVE"]).optional()
}).strict();

export type UpdateStaffRequest =
    z.infer<typeof UpdateStaffRequestSchema>;

export const validateUpdateStaffRequest = (req: LambdaRequest): UpdateStaffRequest => {
    const result = UpdateStaffRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
