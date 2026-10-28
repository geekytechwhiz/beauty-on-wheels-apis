import { z } from 'zod';

import { defineEvent } from '../schema/define-event';
import { registerEventDefinition } from '../../governance/event-registry';

export const SERVICE_VISIT_EVENT_VERSION = '1.0.0' as const;
export const SERVICE_VISIT_EVENT_SOURCE = 'service-catalog-service' as const;

export const SERVICE_VISIT_EVENT_TYPES = {
  CREATED: 'ServiceVisit.Created',
  UPDATED: 'ServiceVisit.Updated',
  ACTIVATED: 'ServiceVisit.Activated',
  PAUSED: 'ServiceVisit.Paused',
  ARCHIVED: 'ServiceVisit.Archived',
} as const;

export type ServiceVisitEventType =
  (typeof SERVICE_VISIT_EVENT_TYPES)[keyof typeof SERVICE_VISIT_EVENT_TYPES];

export const SERVICE_VISIT_EVENT_OPERATIONS = {
  STREAM_PUBLISH: 'catalog.serviceVisit.processed',
  PROJECTION_CONSUME: 'availability.serviceVisit.processed',
} as const;

const time = z.string().regex(/^\d{2}:\d{2}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const waterSource = z.enum(['vendorSupplied', 'communitySupplied', 'waterless']);

export const ServiceVisitWindowSchema = z
  .object({
    windowId: z.string().min(1),
    label: z.enum([
      'earlyMorning',
      'morning',
      'afternoon',
      'evening',
      'night',
      'weekend',
      'custom',
    ]),
    daysOfWeek: z.array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])).min(1),
    startTime: time,
    endTime: time,
    endDayOffset: z.union([z.literal(0), z.literal(1)]),
    /** Present on windows saved before staff count and resources. */
    maxConcurrentBookings: z.number().int().positive().optional(),
    bufferMinutes: z.number().int().nonnegative().optional(),
    capacity: z
      .object({
        staffCount: z.number().int().positive(),
      })
      .strict()
      .optional(),
    resources: z
      .object({
        water: z
          .object({
            source: waterSource,
            capacityLiters: z.number().int().positive().optional(),
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
  .strict()
  .superRefine((window, ctx) => {
    const legacy = window.capacity === undefined && window.resources === undefined;
    if (legacy) {
      if (window.maxConcurrentBookings === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'A legacy window requires maxConcurrentBookings',
          path: ['maxConcurrentBookings'],
        });
      }
      return;
    }
    if (window.capacity === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'staffCount is required',
        path: ['capacity'],
      });
    }
    if (window.resources === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'water and equipment are required',
        path: ['resources'],
      });
      return;
    }
    const liters = window.resources.water.capacityLiters;
    if (window.resources.water.source === 'vendorSupplied' && liters === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'capacityLiters is required when water is vendor supplied',
        path: ['resources', 'water', 'capacityLiters'],
      });
    }
    if (window.resources.water.source !== 'vendorSupplied' && liters !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'capacityLiters is only allowed when water is vendor supplied',
        path: ['resources', 'water', 'capacityLiters'],
      });
    }
  });

export const ServiceVisitSnapshotSchema = z
  .object({
    vendorId: z.string().min(1),
    visitId: z.string().min(1),
    configurationVersion: z.number().int().positive(),
    occurredAt: z.string().min(1),
    change: z.enum(['created', 'updated', 'activated', 'paused', 'archived']),
    name: z.string().min(1),
    deliveryModel: z.enum(['community', 'doorstep']),
    location: z
      .object({
        type: z.enum(['community', 'serviceArea']),
        communityId: z.string().min(1).optional(),
        serviceAreaId: z.string().min(1).optional(),
        branchId: z.string().min(1).optional(),
      })
      .strict(),
    timezone: z.string().min(1),
    windows: z.array(ServiceVisitWindowSchema).min(1),
    serviceIds: z.array(z.string().min(1)).min(1),
    services: z
      .array(
        z
          .object({
            serviceId: z.string().min(1),
            durationMinutes: z.number().int().positive(),
            waterLiters: z.number().int().positive().optional(),
            requiresWater: z.boolean().optional(),
            requiresVendorEquipment: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1),
    staffIds: z.array(z.string().min(1)).optional(),
    effectiveFrom: date,
    effectiveUntil: date.nullable().optional(),
    status: z.enum(['draft', 'active', 'paused', 'archived']),
  })
  .strict();

export type ServiceVisitSnapshot = z.infer<typeof ServiceVisitSnapshotSchema>;

function defineVisitEvent(eventType: ServiceVisitEventType) {
  const event = defineEvent(ServiceVisitSnapshotSchema, {
    eventType,
    eventVersion: SERVICE_VISIT_EVENT_VERSION,
    source: SERVICE_VISIT_EVENT_SOURCE,
    transport: 'eventbridge',
  });
  registerEventDefinition({
    eventType,
    eventVersion: SERVICE_VISIT_EVENT_VERSION,
    source: SERVICE_VISIT_EVENT_SOURCE,
    transport: 'eventbridge',
    classification: 'domain',
    ownerTeam: 'service-catalog',
    compatibility: 'strict',
  });
  return event;
}

export const ServiceVisitCreatedEvent = defineVisitEvent(SERVICE_VISIT_EVENT_TYPES.CREATED);
export const ServiceVisitUpdatedEvent = defineVisitEvent(SERVICE_VISIT_EVENT_TYPES.UPDATED);
export const ServiceVisitActivatedEvent = defineVisitEvent(SERVICE_VISIT_EVENT_TYPES.ACTIVATED);
export const ServiceVisitPausedEvent = defineVisitEvent(SERVICE_VISIT_EVENT_TYPES.PAUSED);
export const ServiceVisitArchivedEvent = defineVisitEvent(SERVICE_VISIT_EVENT_TYPES.ARCHIVED);

export const SERVICE_VISIT_EVENTS = {
  [SERVICE_VISIT_EVENT_TYPES.CREATED]: ServiceVisitCreatedEvent,
  [SERVICE_VISIT_EVENT_TYPES.UPDATED]: ServiceVisitUpdatedEvent,
  [SERVICE_VISIT_EVENT_TYPES.ACTIVATED]: ServiceVisitActivatedEvent,
  [SERVICE_VISIT_EVENT_TYPES.PAUSED]: ServiceVisitPausedEvent,
  [SERVICE_VISIT_EVENT_TYPES.ARCHIVED]: ServiceVisitArchivedEvent,
} as const;

export function serviceVisitEventType(change: ServiceVisitSnapshot['change']): ServiceVisitEventType {
  switch (change) {
    case 'created':
      return SERVICE_VISIT_EVENT_TYPES.CREATED;
    case 'updated':
      return SERVICE_VISIT_EVENT_TYPES.UPDATED;
    case 'activated':
      return SERVICE_VISIT_EVENT_TYPES.ACTIVATED;
    case 'paused':
      return SERVICE_VISIT_EVENT_TYPES.PAUSED;
    case 'archived':
      return SERVICE_VISIT_EVENT_TYPES.ARCHIVED;
  }
}

export function serviceVisitIdempotencyKey(visitId: string, version: number, change: string): string {
  return `ServiceVisit:${visitId}:${version}:${change}`;
}
