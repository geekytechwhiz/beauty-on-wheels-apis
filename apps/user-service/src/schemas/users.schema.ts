import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * User
 * ---------------------------------------------------------
 */

export const UserSchema = z.object({
id: z.string().optional(),
identityId: z.string().optional(),
userType: z.enum(["CUSTOMER", "VENDOR", "ADMIN"]).optional(),
firstName: z.string().optional(),
lastName: z.string().optional(),
email: z.string().email().optional(),
phone: z.string().optional(),
profileImage: z.string().optional(),
status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional()
}).strict();

export type User =
    z.infer<typeof UserSchema>;

export const validateUser = (req: LambdaRequest): User => {
    const result = UserSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
