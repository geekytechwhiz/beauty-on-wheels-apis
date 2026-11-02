import { EventSchemaError } from '@api-hub/middleware';
import { BaseError, LambdaRequest } from '@api-hub/utils';
import { z } from 'zod';

import { assertCatalogName, assertVehicleType } from '../domain/catalog-validation';
import { BILLING_PERIOD, OFFERING_STATUS } from '../domain/offering-lifecycle';

const id = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm');
const billingPeriod = z.enum([
  BILLING_PERIOD.ONE_TIME,
  BILLING_PERIOD.WEEKLY,
  BILLING_PERIOD.MONTHLY,
  BILLING_PERIOD.YEARLY,
]);
const packageStatus = z.enum([
  OFFERING_STATUS.DRAFT,
  OFFERING_STATUS.PUBLISHED,
  OFFERING_STATUS.PAUSED,
  OFFERING_STATUS.ARCHIVED,
]);

const vehiclePrice = z
  .object({
    vehicleType: id,
    /** Integer minor units (INR paise). */
    price: z.number().int().positive(),
    /** Total package duration for this vehicle, across visits in the billing period. */
    durationMinutes: z.number().int().positive().max(24 * 60 * 366),
  })
  .strict();

const includedService = z
  .object({
    name: z.string().trim().min(1).max(100),
    serviceKey: id,
    categoryId: id,
    description: z.string().trim().max(500).optional(),
    visitsPerPeriod: z.number().int().positive(),
    /** Duration of one visit of this included service. */
    durationMinutes: z.number().int().positive().max(24 * 60),
  })
  .strict();

const visitWindow = z
  .object({
    visitWindowId: id,
    label: z.string().trim().min(1).max(100),
    allDay: z.boolean().optional(),
    startTime: time.optional(),
    endTime: time.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.allDay) {
      if (value.startTime || value.endTime) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'allDay window cannot include times' });
      }
      return;
    }
    if (!value.startTime || !value.endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'window requires startTime and endTime, or allDay',
      });
    } else if (value.endTime <= value.startTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'endTime must be after startTime',
      });
    }
  });

const packageFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).optional(),
  categoryId: id,
  billingPeriod,
  currency: z.literal('INR'),
  displayOrder: z.number().int().min(0),
  status: packageStatus,
  includedServices: z.array(includedService).min(1).max(50),
  vehiclePricing: z.array(vehiclePrice).min(1).max(20),
  visitWindows: z.array(visitWindow).max(20).optional(),
};

export const CreatePlatformPackageSchema = z
  .object({
    ...packageFields,
    currency: packageFields.currency.default('INR'),
    displayOrder: packageFields.displayOrder.default(0),
    status: z.literal(OFFERING_STATUS.DRAFT).default(OFFERING_STATUS.DRAFT),
  })
  .strict();

export const UpdatePlatformPackageSchema = z
  .object({
    name: packageFields.name.optional(),
    description: packageFields.description,
    categoryId: packageFields.categoryId.optional(),
    billingPeriod: packageFields.billingPeriod.optional(),
    currency: packageFields.currency.optional(),
    displayOrder: packageFields.displayOrder.optional(),
    status: packageFields.status.optional(),
    includedServices: packageFields.includedServices.optional(),
    vehiclePricing: packageFields.vehiclePricing.optional(),
    visitWindows: packageFields.visitWindows,
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const SalesControlSchema = z.object({
  enabled: z.boolean(),
  expectedVersion: z.number().int().positive().optional(),
  reason: z.string().trim().min(3).max(500),
  effectiveFrom: z.string().datetime().optional(),
  effectiveUntil: z.string().datetime().optional(),
  /** Vendors assigned by operations; never exposed as package ownership. */
  fulfilmentVendorIds: z.array(id).min(1).max(25),
  /** References to Vendor Service approved capacity commitments. */
  capacityCommitmentIds: z.array(id).min(1).max(25),
}).strict().superRefine((value, ctx) => {
  if (value.effectiveFrom && value.effectiveUntil && value.effectiveUntil <= value.effectiveFrom) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveUntil'], message: 'effectiveUntil must be after effectiveFrom' });
  }
});

export type PlatformPackageInput = z.infer<typeof CreatePlatformPackageSchema>;
export type PlatformPackagePatch = z.infer<typeof UpdatePlatformPackageSchema>;
export type SalesControlInput = z.infer<typeof SalesControlSchema>;

export function validatePlatformPackage(request: LambdaRequest): PlatformPackageInput {
  return normalize(parse(CreatePlatformPackageSchema, request));
}

export function validatePlatformPackagePatch(request: LambdaRequest): PlatformPackagePatch {
  const value = parse(UpdatePlatformPackageSchema, request);
  if (Object.keys(value).length === 1) throw new BaseError('At least one package field is required', 400, 'VALIDATION_ERROR');
  const { expectedVersion, ...patch } = value;
  return { ...normalize(patch), expectedVersion };
}

export function validateSalesControl(request: LambdaRequest): SalesControlInput {
  return parse(SalesControlSchema, request);
}

function parse<T>(schema: z.ZodType<T>, request: LambdaRequest): T {
  const result = schema.safeParse(request.body);
  if (!result.success) throw new EventSchemaError('Request validation failed', result.error);
  return result.data;
}

function normalize<T extends {
  name?: string;
  vehiclePricing?: Array<{ vehicleType: string }>;
  includedServices?: Array<{ serviceKey: string }>;
}>(input: T): T {
  if (input.name !== undefined) input.name = assertCatalogName(input.name) as T['name'];
  if (input.vehiclePricing) {
    const types = new Set<string>();
    for (const price of input.vehiclePricing) {
      price.vehicleType = assertVehicleType(price.vehicleType);
      if (types.has(price.vehicleType)) throw new BaseError('vehicleType must be unique in vehiclePricing', 400, 'VALIDATION_ERROR');
      types.add(price.vehicleType);
    }
  }
  if (input.includedServices) {
    const keys = new Set<string>();
    for (const item of input.includedServices) {
      if (keys.has(item.serviceKey)) throw new BaseError('serviceKey must be unique within a package', 400, 'VALIDATION_ERROR');
      keys.add(item.serviceKey);
    }
  }
  return input;
}
