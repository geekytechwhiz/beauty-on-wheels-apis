import { z } from 'zod';
import { LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

export const PLAN_CADENCES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;
export const VISIT_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

const fulfilmentTypeSchema = z
  .enum(['community', 'address', 'COMMUNITY', 'ADDRESS'])
  .transform((value) => value.toLowerCase() as 'community' | 'address');

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:mm');

/**
 * Create customer plan.
 *
 * `branchId` is an addition to the approved proposal: the vendor checkout
 * eligibility read is branch-scoped, so a plan must name the branch (taken
 * from the same discovery row the customer selected the package from).
 */
export const CreateCustomerPlanSchema = z.object({
  vendorId: z.string().trim().min(1),
  branchId: z.string().trim().min(1),
  packageId: z.string().trim().min(1),
  vehicleId: z.string().trim().min(1),
  location: z.object({
    fulfilmentType: fulfilmentTypeSchema,
    communityId: z.string().trim().min(1).optional(),
    addressId: z.string().trim().min(1).optional(),
  }).strict(),
  cadence: z.enum(PLAN_CADENCES),
  visitWindow: z.object({
    preferredDays: z.array(z.enum(VISIT_DAYS)).min(1).max(7),
    startTime: timeSchema,
    endTime: timeSchema,
    timezone: z.string().trim().min(1),
  }).strict(),
  expectedPrice: z.object({
    totalMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Za-z]{3}$/),
  }).strict(),
}).strict().superRefine((value, context) => {
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
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value.visitWindow.timezone });
  } catch {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['visitWindow', 'timezone'],
      message: 'timezone must be a valid IANA time zone',
    });
  }
  if (new Set(value.visitWindow.preferredDays).size !== value.visitWindow.preferredDays.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['visitWindow', 'preferredDays'],
      message: 'preferredDays must not contain duplicates',
    });
  }
  const start = minutesOf(value.visitWindow.startTime);
  const end = minutesOf(value.visitWindow.endTime);
  if (start === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['visitWindow', 'startTime'], message: 'startTime must be a valid HH:mm time' });
  }
  if (end === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['visitWindow', 'endTime'], message: 'endTime must be a valid HH:mm time' });
  }
  if (start !== undefined && end !== undefined && end <= start) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['visitWindow', 'endTime'], message: 'endTime must be after startTime' });
  }
});

function minutesOf(value: string): number | undefined {
  const [hour, minute] = value.split(':').map(Number);
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}

export type CreateCustomerPlanCommand = z.infer<typeof CreateCustomerPlanSchema>;

export const validateCreateCustomerPlan = (req: LambdaRequest): CreateCustomerPlanCommand => {
  const result = CreateCustomerPlanSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  return result.data;
};
