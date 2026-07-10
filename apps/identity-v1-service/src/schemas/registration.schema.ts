import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * RegisterRequest
 * ---------------------------------------------------------
 */

export const RegisterRequestSchema = z.object({
firstName: z.string(),
lastName: z.string(),
email: z.string().email(),
phone: z.string().optional(),
password: z.string().min(8)
}).strict();

export type RegisterRequest =
    z.infer<typeof RegisterRequestSchema>;

export const validateRegisterRequest = (req: LambdaRequest): RegisterRequest => {
    const result = RegisterRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
