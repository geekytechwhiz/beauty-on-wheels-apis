import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * SendOtpRequest
 * ---------------------------------------------------------
 */

export const SendOtpRequestSchema = z.object({
destination: z.string()
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
destination: z.string(),
otp: z.string()
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
