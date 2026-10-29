import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";
import { normalizeIndianMobile } from "../domain/indian-mobile";

const indianMobile = z.string().trim().superRefine((value, ctx) => {
    try {
        normalizeIndianMobile(value);
    } catch (error) {
        ctx.addIssue({
            code: "custom",
            message: error instanceof Error ? error.message : "Enter a valid Indian mobile number",
        });
    }
});

/**
 * ---------------------------------------------------------
 * CreateStaffRequest
 * ---------------------------------------------------------
 */

export const CreateStaffRequestSchema = z.object({
userId: z.string().optional(),
name: z.string().trim().min(2).max(100),
phoneNumber: indianMobile,
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
name: z.string().trim().min(2).max(100).optional(),
phoneNumber: indianMobile.optional(),
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
