import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * WorkingHours
 * ---------------------------------------------------------
 */

export const WorkingHoursSchema = z.object({
vendorId: z.string().optional(),
dayOfWeek: z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]).optional(),
openTime: z.string().optional(),
closeTime: z.string().optional()
}).strict();

export type WorkingHours =
    z.infer<typeof WorkingHoursSchema>;

export const validateWorkingHours = (req: LambdaRequest): WorkingHours => {
    const result = WorkingHoursSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
