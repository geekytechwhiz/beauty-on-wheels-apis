import { z } from 'zod';

import { LambdaRequest, ValidationError } from '@api-hub/utils';

import {
  DAY_OF_WEEK,
  DELIVERY_MODEL,
  LOCATION_TYPE,
  WATER_SOURCE,
  WINDOW_LABEL,
  ServiceVisitWindow,
  VisitLocation,
  WaterSource,
  WindowLabel,
  WindowResources,
} from '../domain/service-visits';

const windowSchema = z
  .object({
    windowId: z.string().min(1),
    label: z.string(),
    daysOfWeek: z.array(z.enum(DAY_OF_WEEK)).min(1),
    startTime: z.string(),
    endTime: z.string(),
    endDayOffset: z.union([z.literal(0), z.literal(1)]).optional(),
    maxConcurrentBookings: z.number().int().optional(),
    bufferMinutes: z.number().int().optional(),
    capacity: z
      .object({
        staffCount: z.number(),
      })
      .strict()
      .optional(),
    resources: z
      .object({
        water: z
          .object({
            source: z.string(),
            capacityLiters: z.number().optional(),
          })
          .strict(),
        equipment: z
          .object({
            providedByVendor: z.boolean(),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict();

const locationSchema = z
  .object({
    type: z.enum([LOCATION_TYPE.COMMUNITY, LOCATION_TYPE.SERVICE_AREA]),
    communityId: z.string().optional(),
    serviceAreaId: z.string().optional(),
  })
  .strict();

export const createServiceVisitSchema = z
  .object({
    name: z.string(),
    deliveryModel: z.enum([DELIVERY_MODEL.COMMUNITY, DELIVERY_MODEL.DOORSTEP]),
    location: locationSchema,
    timezone: z.string(),
    windows: z.array(windowSchema).min(1),
    serviceIds: z.array(z.string()).min(1),
    staffIds: z.array(z.string()).optional(),
    effectiveFrom: z.string(),
    effectiveUntil: z.string().nullable().optional(),
  })
  .strict();

/**
 * `windows`, when present, replaces the complete windows array.
 * Omitted fields stay as they are. `expectedVersion` is required.
 */
export const updateServiceVisitSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    name: z.string().optional(),
    deliveryModel: z.enum([DELIVERY_MODEL.COMMUNITY, DELIVERY_MODEL.DOORSTEP]).optional(),
    location: locationSchema.optional(),
    timezone: z.string().optional(),
    windows: z.array(windowSchema).min(1).optional(),
    serviceIds: z.array(z.string()).min(1).optional(),
    staffIds: z.array(z.string()).optional(),
    effectiveFrom: z.string().optional(),
    effectiveUntil: z.string().nullable().optional(),
  })
  .strict();

export const versionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export type CreateServiceVisitInput = z.infer<typeof createServiceVisitSchema>;
export type UpdateServiceVisitInput = z.infer<typeof updateServiceVisitSchema>;

export function parseCreate(request: LambdaRequest): CreateServiceVisitInput {
  return parse(createServiceVisitSchema, request.body);
}

export function parseUpdate(request: LambdaRequest): UpdateServiceVisitInput {
  return parse(updateServiceVisitSchema, request.body);
}

export function parseVersion(request: LambdaRequest): { expectedVersion: number } {
  return parse(versionSchema, request.body);
}

export function windowsFrom(input: z.infer<typeof windowSchema>[]): ServiceVisitWindow[] {
  return input.map((window) => {
    const label = canonicalLabel(window.label);
    if (!label) {
      throw new ValidationError('window label is invalid');
    }
    const resources = window.resources ? resourcesFrom(window.resources) : undefined;
    return {
      windowId: window.windowId,
      label,
      daysOfWeek: [...window.daysOfWeek],
      startTime: window.startTime,
      endTime: window.endTime,
      endDayOffset: window.endDayOffset ?? 0,
      ...(window.maxConcurrentBookings !== undefined
        ? { maxConcurrentBookings: window.maxConcurrentBookings }
        : {}),
      ...(window.bufferMinutes !== undefined ? { bufferMinutes: window.bufferMinutes } : {}),
      ...(window.capacity ? { capacity: { staffCount: window.capacity.staffCount } } : {}),
      ...(resources ? { resources } : {}),
    };
  });
}

export function locationFrom(input: z.infer<typeof locationSchema>): VisitLocation {
  return { ...input };
}

function resourcesFrom(input: NonNullable<z.infer<typeof windowSchema>['resources']>): WindowResources {
  const source = canonicalWater(input.water.source);
  if (!source) {
    throw new ValidationError('water source must be vendorSupplied, communitySupplied, or waterless');
  }
  return {
    water: {
      source,
      ...(input.water.capacityLiters !== undefined ? { capacityLiters: input.water.capacityLiters } : {}),
    },
    equipment: { providedByVendor: input.equipment.providedByVendor },
  };
}

function canonicalLabel(value: string): WindowLabel | undefined {
  const compact = value.replace(/_/g, '').toLowerCase();
  return Object.values(WINDOW_LABEL).find((label) => label.toLowerCase() === compact);
}

function canonicalWater(value: string): WaterSource | undefined {
  const compact = value.replace(/_/g, '').toLowerCase();
  const match = Object.values(WATER_SOURCE).find((source) => source.toLowerCase() === compact);
  return match;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid service visit');
  }
  return result.data;
}
