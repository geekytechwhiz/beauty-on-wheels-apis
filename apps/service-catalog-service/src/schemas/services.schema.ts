import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

import {
    assertCatalogAmount,
    assertCatalogName,
    assertPositiveDuration,
    assertVehicleTypes,
} from "../domain/catalog-validation";

/**
 * ---------------------------------------------------------
 * Service
 * ---------------------------------------------------------
 */

export const CreateServiceSchema = z.object({
    categoryId: z.string().min(1, "categoryId is required"),
    name: z.string().min(1, "name is required").max(100),
    description: z.string().max(500).optional(),
    durationMinutes: z.number(),
    vehicleTypes: z.array(z.string()).min(1, "at least one vehicleType is required"),
    basePrice: z.number(),
    displayOrder: z.number().int().min(0).optional().default(0),
    active: z.boolean().optional().default(true),
}).strict();

export const UpdateServiceSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    durationMinutes: z.number().optional(),
    vehicleTypes: z.array(z.string()).optional(),
    basePrice: z.number().optional(),
    displayOrder: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
}).strict();

/** Legacy alias */
export const ServiceSchema = CreateServiceSchema;

export type CreateServiceInput = z.infer<typeof CreateServiceSchema>;
export type UpdateServiceInput = z.infer<typeof UpdateServiceSchema>;

/** Legacy alias */
export type Service = CreateServiceInput;

export const validateService = (req: LambdaRequest): CreateServiceInput => {
    const result = CreateServiceSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    const name = assertCatalogName(result.data.name);
    assertPositiveDuration(result.data.durationMinutes);
    assertCatalogAmount(result.data.basePrice, "basePrice");
    const vehicleTypes = assertVehicleTypes(result.data.vehicleTypes);
    return {
        ...result.data,
        name,
        vehicleTypes,
    };
};

export const validateServiceUpdate = (req: LambdaRequest): UpdateServiceInput => {
    const result = UpdateServiceSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    const name = result.data.name === undefined
        ? undefined
        : assertCatalogName(result.data.name);
    if (result.data.durationMinutes !== undefined) {
        assertPositiveDuration(result.data.durationMinutes);
    }
    if (result.data.basePrice !== undefined) {
        assertCatalogAmount(result.data.basePrice, "basePrice");
    }
    const vehicleTypes = result.data.vehicleTypes === undefined
        ? undefined
        : assertVehicleTypes(result.data.vehicleTypes);
    return {
        ...result.data,
        ...(name === undefined ? {} : { name }),
        ...(vehicleTypes === undefined ? {} : { vehicleTypes }),
    };
};
