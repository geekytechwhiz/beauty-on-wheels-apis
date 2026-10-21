import { z } from "zod";
import { BaseError, LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

import {
    assertCatalogAmount,
    assertCatalogName,
    assertPositiveDuration,
    assertVehicleTypes,
} from "../domain/catalog-validation";
import {
    assertVehiclePricing,
    vehiclePricingFromLegacy,
    type VehiclePricing,
} from "../domain/vehicle-pricing";

const VehiclePricingSchema = z.object({
    vehicleType: z.string().min(1),
    price: z.number(),
    durationMinutes: z.number(),
}).strict();

/**
 * ---------------------------------------------------------
 * Service
 * ---------------------------------------------------------
 */

export const CreateServiceSchema = z.object({
    vendorId: z.string().min(1, "vendorId is required"),
    categoryId: z.string().min(1, "categoryId is required"),
    name: z.string().min(1, "name is required").max(100),
    description: z.string().max(500).optional(),
    vehiclePricing: z.array(VehiclePricingSchema).min(1).optional(),
    durationMinutes: z.number().optional(),
    vehicleTypes: z.array(z.string()).optional(),
    basePrice: z.number().optional(),
    displayOrder: z.number().int().min(0).optional().default(0),
    active: z.boolean().optional().default(true),
}).strict();

export const UpdateServiceSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    vehiclePricing: z.array(VehiclePricingSchema).min(1).optional(),
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

export interface ValidatedServiceWrite {
    vendorId: string;
    categoryId: string;
    name: string;
    description?: string;
    vehiclePricing: VehiclePricing[];
    displayOrder: number;
    active: boolean;
}

/** Legacy alias */
export type Service = CreateServiceInput;

export const validateService = (req: LambdaRequest): ValidatedServiceWrite => {
    const result = CreateServiceSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    const vendorId = result.data.vendorId.trim();
    const name = assertCatalogName(result.data.name);
    return {
        vendorId,
        categoryId: result.data.categoryId,
        name,
        ...(result.data.description === undefined ? {} : { description: result.data.description }),
        vehiclePricing: pricingFromCreate(result.data),
        displayOrder: result.data.displayOrder,
        active: result.data.active,
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
    const vehiclePricing = result.data.vehiclePricing === undefined
        ? undefined
        : assertVehiclePricing(result.data.vehiclePricing);
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
        ...(vehiclePricing === undefined ? {} : { vehiclePricing }),
        ...(vehicleTypes === undefined ? {} : { vehicleTypes }),
    };
};

function pricingFromCreate(input: CreateServiceInput): VehiclePricing[] {
    if (input.vehiclePricing !== undefined) {
        return assertVehiclePricing(input.vehiclePricing);
    }
    if (
        input.basePrice !== undefined
        && input.durationMinutes !== undefined
        && input.vehicleTypes !== undefined
    ) {
        return vehiclePricingFromLegacy({
            basePrice: input.basePrice,
            durationMinutes: input.durationMinutes,
            vehicleTypes: input.vehicleTypes,
        });
    }
    throw new BaseError(
        "vehiclePricing is required",
        400,
        "VALIDATION_ERROR",
    );
}
