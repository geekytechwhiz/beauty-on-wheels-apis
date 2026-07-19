import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * UpdateVendorCapabilitiesRequest
 * ---------------------------------------------------------
 */

export const UpdateVendorCapabilitiesRequestSchema = z.object({
vehicleTypes: z.array(z.enum(["HATCHBACK", "SEDAN", "SUV", "MUV", "LUXURY", "OTHER"])),
serviceIds: z.array(z.string()),
packageIds: z.array(z.string())
}).strict();

export type UpdateVendorCapabilitiesRequest =
    z.infer<typeof UpdateVendorCapabilitiesRequestSchema>;

export const validateUpdateVendorCapabilitiesRequest = (req: LambdaRequest): UpdateVendorCapabilitiesRequest => {
    const result = UpdateVendorCapabilitiesRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
