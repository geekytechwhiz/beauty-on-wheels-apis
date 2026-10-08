import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

const serviceItemSchema = z.object({
  type: z.literal("SERVICE"),
  serviceId: z.string().min(1),
  categoryId: z.string().min(1).optional(),
}).strict();

const packageItemSchema = z.object({
  type: z.literal("PACKAGE"),
  packageId: z.string().min(1),
}).strict();

/**
 * Pricing request.
 *
 * `serviceIds` matches the existing platform calculate contract.
 * `items` adds explicit service and package selection.
 * `couponCode` is accepted and ignored. Coupon application is Phase 2.
 */
export const PricingCalculateSchema = z.object({
  vehicleType: z.string().min(1),
  vendorId: z.string().min(1).optional(),
  items: z.array(z.discriminatedUnion("type", [serviceItemSchema, packageItemSchema])).optional(),
  serviceIds: z.array(z.string().min(1)).optional(),
  packageIds: z.array(z.string().min(1)).optional(),
  addOnIds: z.array(z.string().min(1)).optional(),
  addonIds: z.array(z.string().min(1)).optional(),
  couponCode: z.string().optional(),
}).strict();

export type PricingCalculateInput = z.infer<typeof PricingCalculateSchema>;

export interface ResolvedPricingSelection {
  vehicleType: string;
  vendorId?: string;
  services: Array<{ serviceId: string; categoryId?: string }>;
  packageIds: string[];
  addOnIds: string[];
  couponCodeIgnored: boolean;
}

export const validatePricingRequest = (req: LambdaRequest): void => {
  const result = PricingCalculateSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError("Request validation failed", result.error);
  }
};

export const validatePricingCalculate = (
  req: LambdaRequest,
): ResolvedPricingSelection => {
  const result = PricingCalculateSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError("Request validation failed", result.error);
  }
  return resolvePricingSelection(result.data);
};

export function resolvePricingSelection(
  input: PricingCalculateInput,
): ResolvedPricingSelection {
  const services: Array<{ serviceId: string; categoryId?: string }> = [];
  const packageIds: string[] = [];

  for (const item of input.items ?? []) {
    if (item.type === "SERVICE") {
      services.push({
        serviceId: item.serviceId,
        ...(item.categoryId ? { categoryId: item.categoryId } : {}),
      });
    } else {
      packageIds.push(item.packageId);
    }
  }

  for (const serviceId of input.serviceIds ?? []) {
    services.push({ serviceId });
  }
  for (const packageId of input.packageIds ?? []) {
    packageIds.push(packageId);
  }

  const addOnIds = [...(input.addOnIds ?? []), ...(input.addonIds ?? [])];

  return {
    vehicleType: input.vehicleType,
    ...(input.vendorId ? { vendorId: input.vendorId } : {}),
    services,
    packageIds,
    addOnIds,
    couponCodeIgnored: Boolean(input.couponCode?.trim()),
  };
}
