import { z } from 'zod';
import { LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';


/**
 * Create a package plan (not an ON_DEMAND booking).
 *
 * Identity comes from the authorizer. Vendor and final price are resolved from
 * the catalog offering + selected vehicle. `visitWindowId` is a package-defined
 * preference, not a dated availability slot. `autoRenew` is stored as selected.
 * Package plans are community-based and do not require a branch.
 *
 * `packageId` is accepted as an alias of `offeringId` for UI compatibility.
 */
export const CreateCustomerPlanSchema = z
  .object({
    vendorId: z.string().trim().min(1),
    offeringId: z.string().trim().min(1).optional(),
    packageId: z.string().trim().min(1).optional(),
    vehicleId: z.string().trim().min(1),

    location: z
      .object({
        fulfilmentType: z.literal('community'),
        communityId: z.string().trim().min(1),
      })
      .strict(),

    visitWindowId: z.string().trim().min(1),
    autoRenew: z.boolean(),

    expectedPrice: z
      .object({
        totalMinor: z.number().int().nonnegative(),
        currency: z.string().regex(/^[A-Za-z]{3}$/),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.offeringId && !value.packageId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['offeringId'],
        message: 'offeringId is required',
      });
    }

    if (
      value.offeringId &&
      value.packageId &&
      value.offeringId !== value.packageId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['packageId'],
        message: 'packageId must match offeringId when both are provided',
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
