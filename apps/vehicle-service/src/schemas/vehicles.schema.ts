import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * Vehicle
 * ---------------------------------------------------------
 */

export const VehicleSchema = z.object({
id: z.string().optional(),
userId: z.string().optional(),
registrationNumber: z.string(),
vehicleType: z.enum(["HATCHBACK", "SEDAN", "SUV", "MUV", "LUXURY", "BIKE"]),
brand: z.string().optional(),
model: z.string().optional(),
variant: z.string().optional(),
color: z.string().optional(),
fuelType: z.enum(["PETROL", "DIESEL", "EV", "HYBRID", "CNG"]).optional(),
manufactureYear: z.number().int().optional(),
defaultVehicle: z.boolean().optional()
}).strict();

export type Vehicle =
    z.infer<typeof VehicleSchema>;

export const validateVehicle = (req: LambdaRequest): Vehicle => {
    const result = VehicleSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
