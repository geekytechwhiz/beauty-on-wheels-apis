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

const VehiclePriceSchema = z.object({
  vehicleType: z.string().min(1),
  /** Integer minor units (paise for INR). */
  price: z.number().int().min(0),
  durationMinutes: z.number().int().positive(),
}).strict();

const IncludedServiceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  categoryId: z.string().min(1),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  visitsPerPeriod: z.number().int().positive(),
  durationMinutes: z.number().int().positive(),
}).strict();

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

export interface ValidatedCreateOffering {
  offeringType: SupportedOfferingType;
  name: string;
  description?: string;
  billingPeriod: BillingPeriod;
  currency: string;
  vehiclePricing: ValidatedVehiclePrice[];
  includedServices: ValidatedIncludedService[];
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
  return {
    offeringType: result.data.offeringType,
    name: assertCatalogName(result.data.name),
    ...(result.data.description === undefined ? {} : { description: result.data.description }),
    billingPeriod: result.data.billingPeriod,
    currency: result.data.currency.trim().toUpperCase(),
    vehiclePricing: assertVehiclePrices(result.data.vehiclePricing),
    includedServices: assertIncludedServices(result.data.includedServices),
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
  return {
    ...(result.data.name === undefined ? {} : { name: assertCatalogName(result.data.name) }),
    ...(result.data.description === undefined ? {} : { description: result.data.description }),
    ...(result.data.billingPeriod === undefined ? {} : { billingPeriod: result.data.billingPeriod }),
    ...(result.data.currency === undefined
      ? {}
      : { currency: result.data.currency.trim().toUpperCase() }),
    ...(result.data.vehiclePricing === undefined
      ? {}
      : { vehiclePricing: assertVehiclePrices(result.data.vehiclePricing) }),
    ...(result.data.includedServices === undefined
      ? {}
      : { includedServices: assertIncludedServices(result.data.includedServices) }),
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
