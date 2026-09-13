import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * UpdateVendorOperatingHoursRequest
 * ---------------------------------------------------------
 */

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const OperatingHoursRequestSchema = z.object({
dayOfWeek: z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]),
closed: z.boolean(),
openTime: z.string().regex(TIME_OF_DAY_PATTERN).optional(),
closeTime: z.string().regex(TIME_OF_DAY_PATTERN).optional()
}).strict();

export const UpdateVendorOperatingHoursRequestSchema = z.object({
operatingHours: z.array(OperatingHoursRequestSchema).min(1)
}).strict();

export type UpdateVendorOperatingHoursRequest =
    z.infer<typeof UpdateVendorOperatingHoursRequestSchema>;

export const validateUpdateVendorOperatingHoursRequest = (req: LambdaRequest): UpdateVendorOperatingHoursRequest => {
    const result = UpdateVendorOperatingHoursRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
