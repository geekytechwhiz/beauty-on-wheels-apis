import { z } from 'zod';
import { LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

const fulfilmentTypeSchema = z
  .enum(['community', 'address', 'COMMUNITY', 'ADDRESS'])
  .transform((value) => value.toLowerCase() as 'community' | 'address');

/**
 * Create a package plan (not an ON_DEMAND booking).
 *
 * Identity comes from the authorizer. Vendor and final price are resolved from
 * the catalog offering + selected vehicle. `visitWindowId` is a package-defined
 * preference, not a dated availability slot. `autoRenew` is stored as selected.
 *
 * `packageId` is accepted as an alias of `offeringId` for UI compatibility.
 */
export const CreateCustomerPlanSchema = z.object({
  vendorId: z.string().trim().min(1),
  branchId: z.string().trim().min(1),
  offeringId: z.string().trim().min(1).optional(),
  packageId: z.string().trim().min(1).optional(),
  vehicleId: z.string().trim().min(1),
  location: z.object({
    fulfilmentType: fulfilmentTypeSchema,
    communityId: z.string().trim().min(1).optional(),
    addressId: z.string().trim().min(1).optional(),
  }).strict(),
  visitWindowId: z.string().trim().min(1),
  autoRenew: z.boolean(),
  expectedPrice: z.object({
    totalMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Za-z]{3}$/),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (!value.offeringId && !value.packageId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['offeringId'],
      message: 'offeringId is required',
    });
  }
  if (value.offeringId && value.packageId && value.offeringId !== value.packageId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['packageId'],
      message: 'packageId must match offeringId when both are provided',
    });
  }
  if (value.location.fulfilmentType === 'community' && !value.location.communityId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['location', 'communityId'],
      message: 'communityId is required when fulfilmentType is community',
    });
  }
  if (value.location.fulfilmentType === 'address' && !value.location.addressId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['location', 'addressId'],
      message: 'addressId is required when fulfilmentType is address',
    });
  }
});

export type CreateCustomerPlanCommand = z.infer<typeof CreateCustomerPlanSchema> & {
  offeringId: string;
  packageId: string;
};

export const validateCreateCustomerPlan = (req: LambdaRequest): CreateCustomerPlanCommand => {
  const result = CreateCustomerPlanSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  const offeringId = (result.data.offeringId ?? result.data.packageId)!.trim();
  return {
    ...result.data,
    offeringId,
    packageId: offeringId,
  };
};
