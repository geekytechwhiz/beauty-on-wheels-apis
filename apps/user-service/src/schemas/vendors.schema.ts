import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * VendorProfile
 * ---------------------------------------------------------
 */

export const VendorProfileSchema = z.object({
businessName: z.string().optional(),
businessType: z.string().optional(),
gstNumber: z.string().optional(),
licenseNumber: z.string().optional(),
onboardingStatus: z.enum(["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"]).optional()
}).strict();

export type VendorProfile =
    z.infer<typeof VendorProfileSchema>;

export const validateVendorProfile = (req: LambdaRequest): VendorProfile => {
    const result = VendorProfileSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
