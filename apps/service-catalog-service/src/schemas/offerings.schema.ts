import { z } from 'zod';
import { EventSchemaError } from '@api-hub/middleware';
import { BaseError, LambdaRequest } from '@api-hub/utils';

import {
  assertCatalogName,
  assertPositiveDuration,
  assertVehicleType,
} from '../domain/catalog-validation';
import {
  BILLING_PERIOD,
  DEFAULT_OFFERING_CURRENCY,
  OFFERING_STATUS,
  OFFERING_TYPE,
  SUPPORTED_OFFERING_TYPES,
  type BillingPeriod,
  type OfferingLifecycleStatus,
  type SupportedOfferingType,
} from '../domain/offering-lifecycle';

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:mm');

const VehiclePriceSchema = z.object({
  vehicleType: z.string().min(1),
  /** Integer minor units (paise for INR). Final customer price for this vehicle. */
  price: z.number().int().min(0),
  /**
   * Total package duration across visits in the billing period for this vehicle
   * (not a single-visit duration). Per-visit duration is on includedServices.
   */
  durationMinutes: z.number().int().positive(),
}).strict();

const IncludedServiceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  categoryId: z.string().min(1),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  visitsPerPeriod: z.number().int().positive(),
  /** Duration of one visit of this included service. */
  durationMinutes: z.number().int().positive(),
}).strict();

const VisitWindowSchema = z.object({
  visitWindowId: z.string().min(1).max(64),
  label: z.string().min(1).max(100),
  allDay: z.boolean().optional(),
  startTime: timeSchema.optional(),
  endTime: timeSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.allDay === true) {
    if (value.startTime !== undefined || value.endTime !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'all-day visit windows must not include startTime or endTime',
      });
    }
    return;
  }
  if (!value.startTime || !value.endTime) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'visit windows require startTime and endTime, or allDay: true',
    });
    return;
  }
  const start = minutesOf(value.startTime);
  const end = minutesOf(value.endTime);
  if (start === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startTime'],
      message: 'startTime must be a valid HH:mm time',
    });
  }
  if (end === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endTime'],
      message: 'endTime must be a valid HH:mm time',
    });
  }
  if (start !== undefined && end !== undefined && end <= start) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endTime'],
      message: 'endTime must be after startTime',
    });
  }
});

export const CreateOfferingSchema = z.object({
  offeringType: z.enum(SUPPORTED_OFFERING_TYPES),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  billingPeriod: z.enum([
    BILLING_PERIOD.ONE_TIME,
    BILLING_PERIOD.WEEKLY,
    BILLING_PERIOD.MONTHLY,
    BILLING_PERIOD.YEARLY,
  ]),
  currency: z.string().length(3).optional().default(DEFAULT_OFFERING_CURRENCY),
  vehiclePricing: z.array(VehiclePriceSchema).min(1),
  includedServices: z.array(IncludedServiceSchema).min(1),
  visitWindows: z.array(VisitWindowSchema).min(1).max(20).optional(),
  status: z.enum([
    OFFERING_STATUS.DRAFT,
    OFFERING_STATUS.PUBLISHED,
  ]).optional().default(OFFERING_STATUS.DRAFT),
  displayOrder: z.number().int().min(0).optional().default(0),
  communityIds: z.array(z.string().min(1)).max(25).optional(),
}).strict();

export const PatchOfferingSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  billingPeriod: z.enum([
    BILLING_PERIOD.ONE_TIME,
    BILLING_PERIOD.WEEKLY,
    BILLING_PERIOD.MONTHLY,
    BILLING_PERIOD.YEARLY,
  ]).optional(),
  currency: z.string().length(3).optional(),
  vehiclePricing: z.array(VehiclePriceSchema).min(1).optional(),
  includedServices: z.array(IncludedServiceSchema).min(1).optional(),
  visitWindows: z.array(VisitWindowSchema).min(1).max(20).optional(),
  status: z.enum([
    OFFERING_STATUS.DRAFT,
    OFFERING_STATUS.PUBLISHED,
    OFFERING_STATUS.PAUSED,
    OFFERING_STATUS.ARCHIVED,
  ]).optional(),
  displayOrder: z.number().int().min(0).optional(),
  /** Optimistic concurrency. When set, must match the stored version. */
  expectedVersion: z.number().int().positive().optional(),
}).strict();

export type CreateOfferingInput = z.infer<typeof CreateOfferingSchema>;
export type PatchOfferingInput = z.infer<typeof PatchOfferingSchema>;

export interface ValidatedIncludedService {
  name: string;
  description?: string;
  categoryId: string;
  tags?: string[];
  visitsPerPeriod: number;
  durationMinutes: number;
}

export interface ValidatedVehiclePrice {
  vehicleType: string;
  price: number;
  durationMinutes: number;
}

export interface ValidatedVisitWindow {
  visitWindowId: string;
  label: string;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
}

export interface ValidatedCreateOffering {
  offeringType: SupportedOfferingType;
  name: string;
  description?: string;
  billingPeriod: BillingPeriod;
  currency: string;
  vehiclePricing: ValidatedVehiclePrice[];
  includedServices: ValidatedIncludedService[];
  visitWindows?: ValidatedVisitWindow[];
  status: OfferingLifecycleStatus;
  displayOrder: number;
  communityIds?: string[];
}

export interface ValidatedPatchOffering {
  name?: string;
  description?: string;
  billingPeriod?: BillingPeriod;
  currency?: string;
  vehiclePricing?: ValidatedVehiclePrice[];
  includedServices?: ValidatedIncludedService[];
  visitWindows?: ValidatedVisitWindow[];
  status?: OfferingLifecycleStatus;
  displayOrder?: number;
  expectedVersion?: number;
}

export function validateCreateOffering(req: LambdaRequest): ValidatedCreateOffering {
  const result = CreateOfferingSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  if (result.data.offeringType !== OFFERING_TYPE.PACKAGE) {
    throw new BaseError(
      `offeringType ${result.data.offeringType} is not supported yet`,
      400,
      'UNSUPPORTED_OFFERING_TYPE',
    );
  }
  const name = assertCatalogName(result.data.name);
  const description = result.data.description;
  assertBillingPeriodCopy(result.data.billingPeriod, name, description);
  const visitWindows = result.data.visitWindows === undefined
    ? undefined
    : assertVisitWindows(result.data.visitWindows);
  if (result.data.status === OFFERING_STATUS.PUBLISHED && (!visitWindows || visitWindows.length === 0)) {
    throw new BaseError(
      'Published package offerings require visitWindows preferences',
      400,
      'VISIT_WINDOWS_REQUIRED',
    );
  }
  return {
    offeringType: result.data.offeringType,
    name,
    ...(description === undefined ? {} : { description }),
    billingPeriod: result.data.billingPeriod,
    currency: result.data.currency.trim().toUpperCase(),
    vehiclePricing: assertVehiclePrices(result.data.vehiclePricing),
    includedServices: assertIncludedServices(result.data.includedServices),
    ...(visitWindows === undefined ? {} : { visitWindows }),
    status: result.data.status,
    displayOrder: result.data.displayOrder,
    ...(result.data.communityIds === undefined
      ? {}
      : { communityIds: [...new Set(result.data.communityIds.map((id) => id.trim()))] }),
  };
}

export function validatePatchOffering(req: LambdaRequest): ValidatedPatchOffering {
  const result = PatchOfferingSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  if (Object.keys(result.data).length === 0) {
    throw new BaseError('At least one field is required', 400, 'VALIDATION_ERROR');
  }
  const name = result.data.name === undefined ? undefined : assertCatalogName(result.data.name);
  const description = result.data.description;
  const billingPeriod = result.data.billingPeriod;
  if (billingPeriod !== undefined && (name !== undefined || description !== undefined)) {
    assertBillingPeriodCopy(billingPeriod, name ?? '', description);
  }
  return {
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(billingPeriod === undefined ? {} : { billingPeriod }),
    ...(result.data.currency === undefined
      ? {}
      : { currency: result.data.currency.trim().toUpperCase() }),
    ...(result.data.vehiclePricing === undefined
      ? {}
      : { vehiclePricing: assertVehiclePrices(result.data.vehiclePricing) }),
    ...(result.data.includedServices === undefined
      ? {}
      : { includedServices: assertIncludedServices(result.data.includedServices) }),
    ...(result.data.visitWindows === undefined
      ? {}
      : { visitWindows: assertVisitWindows(result.data.visitWindows) }),
    ...(result.data.status === undefined ? {} : { status: result.data.status }),
    ...(result.data.displayOrder === undefined ? {} : { displayOrder: result.data.displayOrder }),
    ...(result.data.expectedVersion === undefined
      ? {}
      : { expectedVersion: result.data.expectedVersion }),
  };
}

function assertVehiclePrices(
  values: readonly { vehicleType: string; price: number; durationMinutes: number }[],
): ValidatedVehiclePrice[] {
  const seen = new Set<string>();
  return values.map((entry) => {
    const vehicleType = assertVehicleType(entry.vehicleType);
    if (seen.has(vehicleType)) {
      throw new BaseError(
        `Duplicate vehicle type: ${vehicleType}`,
        400,
        'VALIDATION_ERROR',
      );
    }
    seen.add(vehicleType);
    if (!Number.isInteger(entry.price) || entry.price < 0) {
      throw new BaseError(
        'price must be a non-negative integer in minor units',
        400,
        'INVALID_PRICE',
      );
    }
    assertPositiveDuration(entry.durationMinutes);
    return {
      vehicleType,
      price: entry.price,
      durationMinutes: entry.durationMinutes,
    };
  });
}

function assertIncludedServices(
  values: readonly {
    name: string;
    description?: string;
    categoryId: string;
    tags?: string[];
    visitsPerPeriod: number;
    durationMinutes: number;
  }[],
): ValidatedIncludedService[] {
  return values.map((entry) => {
    assertPositiveDuration(entry.durationMinutes);
    if (!Number.isInteger(entry.visitsPerPeriod) || entry.visitsPerPeriod < 1) {
      throw new BaseError(
        'visitsPerPeriod must be a positive integer',
        400,
        'VALIDATION_ERROR',
      );
    }
    return {
      name: assertCatalogName(entry.name),
      ...(entry.description === undefined ? {} : { description: entry.description }),
      categoryId: entry.categoryId.trim(),
      ...(entry.tags === undefined
        ? {}
        : { tags: [...new Set(entry.tags.map((tag) => tag.trim()).filter(Boolean))] }),
      visitsPerPeriod: entry.visitsPerPeriod,
      durationMinutes: entry.durationMinutes,
    };
  });
}

function assertVisitWindows(
  values: readonly {
    visitWindowId: string;
    label: string;
    allDay?: boolean;
    startTime?: string;
    endTime?: string;
  }[],
): ValidatedVisitWindow[] {
  const seen = new Set<string>();
  return values.map((entry) => {
    const visitWindowId = entry.visitWindowId.trim();
    if (seen.has(visitWindowId)) {
      throw new BaseError(
        `Duplicate visitWindowId: ${visitWindowId}`,
        400,
        'VALIDATION_ERROR',
      );
    }
    seen.add(visitWindowId);
    const label = assertCatalogName(entry.label, 'visitWindows.label');
    if (entry.allDay === true) {
      return { visitWindowId, label, allDay: true };
    }
    return {
      visitWindowId,
      label,
      startTime: entry.startTime!,
      endTime: entry.endTime!,
    };
  });
}

/**
 * Reject marketing copy that contradicts the billing period before publish.
 * Example: a name that says "daily" with billingPeriod weekly.
 */
function assertBillingPeriodCopy(
  billingPeriod: BillingPeriod,
  name: string,
  description?: string,
): void {
  const haystack = `${name} ${description ?? ''}`.toLowerCase();
  const conflicts: Array<{ period: BillingPeriod; tokens: string[] }> = [
    { period: BILLING_PERIOD.WEEKLY, tokens: ['daily', 'every day', 'per day'] },
    { period: BILLING_PERIOD.MONTHLY, tokens: ['daily', 'weekly', 'every week', 'per week'] },
    { period: BILLING_PERIOD.YEARLY, tokens: ['daily', 'weekly', 'monthly', 'every month', 'per month'] },
    { period: BILLING_PERIOD.ONE_TIME, tokens: ['daily', 'weekly', 'monthly', 'yearly', 'subscription', 'recurring'] },
  ];
  const rule = conflicts.find((entry) => entry.period === billingPeriod);
  if (!rule) {
    return;
  }
  const hit = rule.tokens.find((token) => haystack.includes(token));
  if (hit) {
    throw new BaseError(
      `Offering copy mentions "${hit}" which conflicts with billingPeriod ${billingPeriod}`,
      400,
      'BILLING_PERIOD_COPY_CONFLICT',
    );
  }
}

function minutesOf(value: string): number | undefined {
  const [hour, minute] = value.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) {
    return undefined;
  }
  return hour * 60 + minute;
}
