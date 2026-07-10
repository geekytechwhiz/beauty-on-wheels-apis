import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * LoginRequest
 * ---------------------------------------------------------
 */

export const LoginRequestSchema = z.object({
username: z.string(),
password: z.string()
}).strict();

export type LoginRequest =
    z.infer<typeof LoginRequestSchema>;

export const validateLoginRequest = (req: LambdaRequest): LoginRequest => {
    const result = LoginRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};

/**
 * ---------------------------------------------------------
 * RefreshTokenRequest
 * ---------------------------------------------------------
 */

export const RefreshTokenRequestSchema = z.object({
refreshToken: z.string()
}).strict();

export type RefreshTokenRequest =
    z.infer<typeof RefreshTokenRequestSchema>;

export const validateRefreshTokenRequest = (req: LambdaRequest): RefreshTokenRequest => {
    const result = RefreshTokenRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};

/**
 * ---------------------------------------------------------
 * ChangePasswordRequest
 * ---------------------------------------------------------
 */

export const ChangePasswordRequestSchema = z.object({
oldPassword: z.string(),
newPassword: z.string()
}).strict();

export type ChangePasswordRequest =
    z.infer<typeof ChangePasswordRequestSchema>;

export const validateChangePasswordRequest = (req: LambdaRequest): ChangePasswordRequest => {
    const result = ChangePasswordRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
