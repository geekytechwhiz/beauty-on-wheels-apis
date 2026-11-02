import { z } from "zod";
import { LambdaRequest, VEHICLE_TYPE_VALUES } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

import {
  SERVICE_TYPE_CAPABILITY_IDS,
  WASH_METHOD_CAPABILITY_IDS,
} from "../domain/capabilities-catalog";

/**
 * ---------------------------------------------------------
 * UpdateVendorCapabilitiesRequest
 * ---------------------------------------------------------
 */

const catalogId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);

const priceOverride = z.number().nonnegative().finite().optional();

const serviceOfferingSchema = z
  .object({
    serviceId: catalogId,
    categoryId: catalogId,
    enabled: z.boolean().optional(),
    priceOverride,
  })
  .strict();

const packageOfferingSchema = z
  .object({
    packageId: catalogId,
    enabled: z.boolean().optional(),
    priceOverride,
  })
  .strict();

/** Full replacement of the vendor capability selection. Empty arrays clear that selection. */
export const UpdateVendorCapabilitiesRequestSchema = z
  .object({
    vehicleTypes: z.array(z.enum(VEHICLE_TYPE_VALUES)).max(20),
    washMethods: z.array(z.enum(WASH_METHOD_CAPABILITY_IDS)).max(50),
    serviceTypes: z.array(z.enum(SERVICE_TYPE_CAPABILITY_IDS)).max(50),
    services: z.array(serviceOfferingSchema).max(50),
    packages: z.array(packageOfferingSchema).max(50),
  })
  .strict();

export type UpdateVendorCapabilitiesRequest =
    z.infer<typeof UpdateVendorCapabilitiesRequestSchema>;

export const validateUpdateVendorCapabilitiesRequest = (req: LambdaRequest): UpdateVendorCapabilitiesRequest => {
    const result = UpdateVendorCapabilitiesRequestSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    req.body = result.data;
    return result.data;
};
