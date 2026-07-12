import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * Preference
 * ---------------------------------------------------------
 */

export const PreferenceSchema = z.object({
notifications: z.boolean().optional(),
emailNotifications: z.boolean().optional(),
smsNotifications: z.boolean().optional(),
language: z.string().optional(),
timezone: z.string().optional()
}).strict();

export type Preference =
    z.infer<typeof PreferenceSchema>;

export const validatePreference = (req: LambdaRequest): Preference => {
    const result = PreferenceSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
