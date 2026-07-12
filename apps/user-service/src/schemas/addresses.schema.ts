import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * Address
 * ---------------------------------------------------------
 */

export const AddressSchema = z.object({
id: z.string().optional(),
type: z.enum(["HOME", "WORK", "BUSINESS"]).optional(),
line1: z.string().optional(),
line2: z.string().optional(),
city: z.string().optional(),
state: z.string().optional(),
postalCode: z.string().optional(),
country: z.string().optional(),
latitude: z.number().optional(),
longitude: z.number().optional()
}).strict();

export type Address =
    z.infer<typeof AddressSchema>;

export const validateAddress = (req: LambdaRequest): Address => {
    const result = AddressSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
