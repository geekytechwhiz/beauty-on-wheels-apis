import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * CustomerProfile
 * ---------------------------------------------------------
 */

export const CustomerProfileSchema = z.object({
loyaltyPoints: z.number().int().optional(),
preferredLanguage: z.string().optional(),
marketingConsent: z.boolean().optional()
}).strict();

export type CustomerProfile =
    z.infer<typeof CustomerProfileSchema>;

export const validateCustomerProfile = (req: LambdaRequest): CustomerProfile => {
    const result = CustomerProfileSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
