import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * SendOtpRequest
 * ---------------------------------------------------------
 */

export const RegistrationUserTypeSchema = z.enum(["CUSTOMER", "VENDOR"]);

export const SendOtpRequestSchema = z.object({
destination: z.string().trim().min(1),
userType: RegistrationUserTypeSchema.default("CUSTOMER"),
}).strict();

export type SendOtpRequest =
    z.infer<typeof SendOtpRequestSchema>;

export const validateSendOtpRequest = (req: LambdaRequest): SendOtpRequest => {
    const result = SendOtpRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};

/**
 * ---------------------------------------------------------
 * VerifyOtpRequest
 * ---------------------------------------------------------
 */

export const VerifyOtpRequestSchema = z.object({
destination: z.string().trim().min(1),
otp: z.string().trim().min(1).max(12)
}).strict();

export type VerifyOtpRequest =
    z.infer<typeof VerifyOtpRequestSchema>;

export const validateVerifyOtpRequest = (req: LambdaRequest): VerifyOtpRequest => {
    const result = VerifyOtpRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
