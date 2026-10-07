import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

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

export const UpdateVendorCapabilitiesRequestSchema = z
  .object({
    vehicleTypes: z.array(
      z.enum(['HATCHBACK', 'SEDAN', 'SUV', 'MUV', 'LUXURY', 'OTHER']),
    ),
    serviceIds: z.array(catalogId).optional(),
    packageIds: z.array(catalogId).optional(),
    services: z.array(serviceOfferingSchema).max(50).optional(),
    packages: z.array(packageOfferingSchema).max(50).optional(),
  })
  .strict();

export const ReplaceVendorServicesRequestSchema = z
  .object({
    services: z.array(serviceOfferingSchema).max(50),
  })
  .strict();

export const ReplaceVendorPackagesRequestSchema = z
  .object({
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

export const validateReplaceVendorServicesRequest = (
  req: LambdaRequest,
) => {
  const result = ReplaceVendorServicesRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};

export const validateReplaceVendorPackagesRequest = (
  req: LambdaRequest,
) => {
  const result = ReplaceVendorPackagesRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};
