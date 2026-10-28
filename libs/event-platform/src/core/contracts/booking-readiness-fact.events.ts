import { z } from 'zod';

import { defineEvent } from '../schema/define-event';
import { registerEventDefinition } from '../../governance/event-registry';

/**
 * Authoritative booking-readiness summary.
 * Producers publish the post-change aggregate, not a bare "something changed" flag.
 * A zero count clears the corresponding check. Ordering uses aggregateVersion.
 */
export const BOOKING_READINESS_FACT_EVENT_TYPE = 'BookingReadinessFact.Updated' as const;
export const BOOKING_READINESS_FACT_EVENT_VERSION = '1.0.0' as const;
export const BOOKING_READINESS_FACT_EVENT_SOURCE = 'vendor-service' as const;

export const BOOKING_READINESS_FACT_SOURCES = {
  VENDOR: 'vendor-service',
  CATALOG: 'service-catalog-service',
  AVAILABILITY: 'availability-service',
} as const;

export const BOOKING_READINESS_FACT_NAMES = {
  VENDOR: 'vendor',
  SERVICES: 'services',
  VISIT_SCHEDULES: 'visitSchedules',
} as const;

export const BOOKING_READINESS_TRANSITIONS = {
  CREATED: 'created',
  UPDATED: 'updated',
  DELETED: 'deleted',
  ENABLED: 'enabled',
  DISABLED: 'disabled',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SUSPENDED: 'suspended',
} as const;

const sourceSchema = z.enum([
  BOOKING_READINESS_FACT_SOURCES.VENDOR,
  BOOKING_READINESS_FACT_SOURCES.CATALOG,
  BOOKING_READINESS_FACT_SOURCES.AVAILABILITY,
]);

const transitionSchema = z.enum([
  BOOKING_READINESS_TRANSITIONS.CREATED,
  BOOKING_READINESS_TRANSITIONS.UPDATED,
  BOOKING_READINESS_TRANSITIONS.DELETED,
  BOOKING_READINESS_TRANSITIONS.ENABLED,
  BOOKING_READINESS_TRANSITIONS.DISABLED,
  BOOKING_READINESS_TRANSITIONS.APPROVED,
  BOOKING_READINESS_TRANSITIONS.REJECTED,
  BOOKING_READINESS_TRANSITIONS.SUSPENDED,
]);

const occurredAtSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
  'occurredAt must be a UTC timestamp',
);

export const VendorReadinessDetailSchema = z.object({
  fact: z.literal(BOOKING_READINESS_FACT_NAMES.VENDOR),
  approvalStatus: z.string().min(1),
  operationalStatus: z.string().min(1),
  onboardingComplete: z.boolean(),
  businessProfileComplete: z.boolean(),
  ownerUserId: z.string().min(1),
  staffUserIds: z.array(z.string().min(1)),
  activeCommunityCount: z.number().int().nonnegative(),
  applicablePricingCount: z.number().int().nonnegative(),
  teamConfigured: z.boolean(),
  paymentsConfigured: z.boolean(),
}).strict();

export const ServiceReadinessDetailSchema = z.object({
  fact: z.literal(BOOKING_READINESS_FACT_NAMES.SERVICES),
  activeBookableServiceCount: z.number().int().nonnegative(),
}).strict();

export const VisitScheduleReadinessDetailSchema = z.object({
  fact: z.literal(BOOKING_READINESS_FACT_NAMES.VISIT_SCHEDULES),
  activeValidVisitScheduleCount: z.number().int().nonnegative(),
}).strict();

export const BookingReadinessFactDetailSchema = z.discriminatedUnion('fact', [
  VendorReadinessDetailSchema,
  ServiceReadinessDetailSchema,
  VisitScheduleReadinessDetailSchema,
]);

export const BookingReadinessFactUpdatedPayloadSchema = z.object({
  eventId: z.string().min(1),
  vendorId: z.string().min(1),
  source: sourceSchema,
  aggregateVersion: z.number().int().positive(),
  occurredAt: occurredAtSchema,
  transition: transitionSchema,
  detail: BookingReadinessFactDetailSchema,
}).strict();

export type BookingReadinessFactSource = z.infer<typeof sourceSchema>;
export type BookingReadinessTransition = z.infer<typeof transitionSchema>;
export type BookingReadinessFactPayload = z.infer<typeof BookingReadinessFactUpdatedPayloadSchema>;
export type VendorReadinessDetail = z.infer<typeof VendorReadinessDetailSchema>;

export const BookingReadinessFactUpdatedEvent = defineEvent(BookingReadinessFactUpdatedPayloadSchema, {
  eventType: BOOKING_READINESS_FACT_EVENT_TYPE,
  eventVersion: BOOKING_READINESS_FACT_EVENT_VERSION,
  source: BOOKING_READINESS_FACT_EVENT_SOURCE,
  transport: 'eventbridge',
});

registerEventDefinition({
  eventType: BOOKING_READINESS_FACT_EVENT_TYPE,
  eventVersion: BOOKING_READINESS_FACT_EVENT_VERSION,
  source: BOOKING_READINESS_FACT_EVENT_SOURCE,
  transport: 'eventbridge',
  classification: 'domain',
  ownerTeam: 'vendor',
  compatibility: 'strict',
});

export function bookingReadinessFactIdempotencyKey(payload: Pick<BookingReadinessFactPayload, 'source' | 'vendorId' | 'aggregateVersion' | 'detail'>): string {
  return `BookingReadinessFact:${payload.source}:${payload.vendorId}:${payload.detail.fact}:${payload.aggregateVersion}`;
}

export function readinessDetailFingerprint(detail: unknown): string {
  return JSON.stringify(sortValue(detail));
}

export function vendorReadinessTransition(
  previous: VendorReadinessDetail | null,
  next: VendorReadinessDetail,
): BookingReadinessTransition {
  if (!previous) return BOOKING_READINESS_TRANSITIONS.CREATED;
  if (previous.approvalStatus !== next.approvalStatus) {
    if (next.approvalStatus === 'ACTIVE') return BOOKING_READINESS_TRANSITIONS.APPROVED;
    if (next.approvalStatus === 'REJECTED') return BOOKING_READINESS_TRANSITIONS.REJECTED;
    if (next.approvalStatus === 'SUSPENDED') return BOOKING_READINESS_TRANSITIONS.SUSPENDED;
  }
  const previousEnabled = previous.activeCommunityCount > 0 || previous.applicablePricingCount > 0;
  const nextEnabled = next.activeCommunityCount > 0 || next.applicablePricingCount > 0;
  if (!previousEnabled && nextEnabled) return BOOKING_READINESS_TRANSITIONS.ENABLED;
  if (previousEnabled && !nextEnabled) return BOOKING_READINESS_TRANSITIONS.DISABLED;
  if (previous.activeCommunityCount > 0 && next.activeCommunityCount === 0) return BOOKING_READINESS_TRANSITIONS.DISABLED;
  if (previous.applicablePricingCount > 0 && next.applicablePricingCount === 0) return BOOKING_READINESS_TRANSITIONS.DISABLED;
  return BOOKING_READINESS_TRANSITIONS.UPDATED;
}

export function countTransitionFrom(
  current: BookingReadinessFactPayload | null,
  fact: 'services' | 'visitSchedules',
  next: number,
  trigger?: BookingReadinessTransition,
): BookingReadinessTransition {
  if (!current || current.detail.fact !== fact) {
    return countReadinessTransition(null, next, trigger);
  }
  const previous = current.detail.fact === 'services'
    ? current.detail.activeBookableServiceCount
    : current.detail.activeValidVisitScheduleCount;
  return countReadinessTransition(previous, next, trigger);
}

export function countReadinessTransition(
  previous: number | null,
  next: number,
  trigger?: BookingReadinessTransition,
): BookingReadinessTransition {
  if (previous === null) return BOOKING_READINESS_TRANSITIONS.CREATED;
  if (previous > 0 && next === 0) {
    return trigger === BOOKING_READINESS_TRANSITIONS.DELETED
      ? BOOKING_READINESS_TRANSITIONS.DELETED
      : BOOKING_READINESS_TRANSITIONS.DISABLED;
  }
  if (previous === 0 && next > 0) return BOOKING_READINESS_TRANSITIONS.ENABLED;
  if (trigger === BOOKING_READINESS_TRANSITIONS.DELETED && next === 0) return BOOKING_READINESS_TRANSITIONS.DELETED;
  return BOOKING_READINESS_TRANSITIONS.UPDATED;
}

export interface ReadinessOutboxState {
  aggregateVersion: number;
  payload: BookingReadinessFactPayload;
  pendingPublish: boolean;
}

/**
 * Same post-change state republishes the stored version.
 * A changed state commits the next monotonic version.
 */
export function planBookingReadinessFact(input: {
  current: ReadinessOutboxState | null;
  vendorId: string;
  source: BookingReadinessFactSource;
  transition: BookingReadinessTransition;
  detail: BookingReadinessFactPayload['detail'];
  eventId: string;
  occurredAt: string;
}): { action: 'skip' | 'republish'; payload: BookingReadinessFactPayload } | { action: 'commit'; expectedVersion: number | null; payload: BookingReadinessFactPayload } {
  if (
    input.current
    && readinessDetailFingerprint(input.current.payload.detail) === readinessDetailFingerprint(input.detail)
  ) {
    return {
      action: input.current.pendingPublish ? 'republish' : 'skip',
      payload: input.current.payload,
    };
  }
  const expectedVersion = input.current?.aggregateVersion ?? null;
  const payload: BookingReadinessFactPayload = {
    eventId: input.eventId,
    vendorId: input.vendorId,
    source: input.source,
    aggregateVersion: (input.current?.aggregateVersion ?? 0) + 1,
    occurredAt: input.occurredAt,
    transition: input.transition,
    detail: input.detail,
  };
  return { action: 'commit', expectedVersion, payload };
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortValue((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
  }
  return value;
}
