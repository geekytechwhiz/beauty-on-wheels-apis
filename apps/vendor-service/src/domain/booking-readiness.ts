import type { BookingReadinessFactPayload } from '@api-hub/event-platform';

export const BOOKING_READINESS_SK = 'BOOKING_READINESS';
export const BOOKING_READINESS_VERSION = 2;

export const PROJECTION_STATE = {
  FRESH: 'fresh',
  STALE: 'stale',
  PENDING_RECONCILIATION: 'pendingReconciliation',
} as const;

export type ProjectionState = (typeof PROJECTION_STATE)[keyof typeof PROJECTION_STATE];

/**
 * Payment setup is not a booking gate in the current MVP.
 * Bank details are already part of onboarding review, and customer checkout
 * validates price, schedule, and capacity on its own.
 */
export const PAYMENTS_REQUIRED_FOR_READINESS = false;

export interface BookingReadiness {
  vendorId: string;
  configurationReady: boolean;
  approvalStatus: string;
  operationalStatus: string;
  canAcceptBookings: boolean;
  requirements: {
    businessProfile: { complete: boolean };
    onboarding: { complete: boolean };
    serviceAreas: { complete: boolean; eligibleCount: number };
    services: { complete: boolean; activeCount: number };
    serviceVisits: { complete: boolean; activeCount: number };
    pricing: { complete: boolean; applicableCount: number };
  };
  optional: { team: { configured: boolean }; payments: { configured: boolean } };
  blockingReasons: string[];
  projectionVersion: number;
  projectionState: ProjectionState;
  reconciledAt?: string;
  updatedAt: string;
}

export interface VendorReadinessFact {
  aggregateVersion: number;
  eventId: string;
  occurredAt: string;
  approvalStatus: string;
  operationalStatus: string;
  onboardingComplete: boolean;
  businessProfileComplete: boolean;
  ownerUserId: string;
  staffUserIds: string[];
  activeCommunityCount: number;
  applicablePricingCount: number;
  teamConfigured: boolean;
  paymentsConfigured: boolean;
}

export interface CatalogReadinessFact {
  aggregateVersion: number;
  eventId: string;
  occurredAt: string;
  activeBookableServiceCount: number;
}

export interface AvailabilityReadinessFact {
  aggregateVersion: number;
  eventId: string;
  occurredAt: string;
  activeValidVisitScheduleCount: number;
}

export interface BookingReadinessRecord {
  vendorId: string;
  projectionRevision: number;
  projectionState: ProjectionState;
  updatedAt: string;
  vendor?: VendorReadinessFact;
  catalog?: CatalogReadinessFact;
  availability?: AvailabilityReadinessFact;
}

export type ReadinessSlot = 'vendor' | 'catalog' | 'availability';

export function applyReadinessFact(
  current: BookingReadinessRecord | null,
  payload: BookingReadinessFactPayload,
  now: string,
): { result: 'applied'; record: BookingReadinessRecord } | { result: 'duplicate' | 'stale'; record: BookingReadinessRecord | null } {
  const slot = slotFor(payload);
  const existing = current?.[slot];
  if (existing?.eventId === payload.eventId) return { result: 'duplicate', record: current };
  if (existing && existing.aggregateVersion > payload.aggregateVersion) return { result: 'stale', record: current };
  if (existing && existing.aggregateVersion === payload.aggregateVersion) return { result: 'duplicate', record: current };

  const next: BookingReadinessRecord = {
    vendorId: payload.vendorId,
    projectionRevision: (current?.projectionRevision ?? 0) + 1,
    projectionState: PROJECTION_STATE.PENDING_RECONCILIATION,
    updatedAt: now,
    vendor: current?.vendor,
    catalog: current?.catalog,
    availability: current?.availability,
  };
  if (payload.detail.fact === 'vendor') {
    const { fact: _fact, ...state } = payload.detail;
    next.vendor = { ...state, aggregateVersion: payload.aggregateVersion, eventId: payload.eventId, occurredAt: payload.occurredAt };
  } else if (payload.detail.fact === 'services') {
    next.catalog = {
      activeBookableServiceCount: payload.detail.activeBookableServiceCount,
      aggregateVersion: payload.aggregateVersion,
      eventId: payload.eventId,
      occurredAt: payload.occurredAt,
    };
  } else {
    next.availability = {
      activeValidVisitScheduleCount: payload.detail.activeValidVisitScheduleCount,
      aggregateVersion: payload.aggregateVersion,
      eventId: payload.eventId,
      occurredAt: payload.occurredAt,
    };
  }
  next.projectionState = next.vendor && next.catalog && next.availability
    ? PROJECTION_STATE.FRESH
    : PROJECTION_STATE.PENDING_RECONCILIATION;
  return { result: 'applied', record: next };
}

export function slotFor(payload: BookingReadinessFactPayload): ReadinessSlot {
  if (payload.detail.fact === 'vendor') {
    if (payload.source !== 'vendor-service') throw new Error('Vendor readiness facts must come from vendor-service');
    return 'vendor';
  }
  if (payload.detail.fact === 'services') {
    if (payload.source !== 'service-catalog-service') throw new Error('Service readiness facts must come from service-catalog-service');
    return 'catalog';
  }
  if (payload.source !== 'availability-service') throw new Error('Visit schedule facts must come from availability-service');
  return 'availability';
}

export function projectBookingReadiness(record: BookingReadinessRecord): BookingReadiness {
  const vendor = record.vendor;
  const serviceCount = record.catalog?.activeBookableServiceCount ?? 0;
  const visitCount = record.availability?.activeValidVisitScheduleCount ?? 0;
  const communityCount = vendor?.activeCommunityCount ?? 0;
  const pricingCount = vendor?.applicablePricingCount ?? 0;
  const requirements = {
    businessProfile: { complete: vendor?.businessProfileComplete === true },
    onboarding: { complete: vendor?.onboardingComplete === true },
    serviceAreas: { complete: Boolean(vendor) && communityCount > 0, eligibleCount: communityCount },
    services: { complete: Boolean(record.catalog) && serviceCount > 0, activeCount: serviceCount },
    serviceVisits: { complete: Boolean(record.availability) && visitCount > 0, activeCount: visitCount },
    pricing: { complete: Boolean(vendor) && pricingCount > 0, applicableCount: pricingCount },
  };
  const configurationReady = Object.values(requirements).every((value) => value.complete);
  const blockingReasons: string[] = [];
  if (!vendor || !record.catalog || !record.availability) blockingReasons.push('READINESS_PENDING_RECONCILIATION');
  if (record.projectionState === PROJECTION_STATE.STALE) blockingReasons.push('READINESS_STALE');
  if (vendor && !requirements.businessProfile.complete) blockingReasons.push('BUSINESS_PROFILE_INCOMPLETE');
  if (vendor && !requirements.onboarding.complete) blockingReasons.push('ONBOARDING_INCOMPLETE');
  if (vendor && !requirements.serviceAreas.complete) blockingReasons.push('NO_ELIGIBLE_COMMUNITY');
  if (record.catalog && !requirements.services.complete) blockingReasons.push('NO_ACTIVE_SERVICE');
  if (record.availability && !requirements.serviceVisits.complete) blockingReasons.push('NO_ACTIVE_SERVICE_VISIT');
  if (vendor && !requirements.pricing.complete) blockingReasons.push('NO_APPLICABLE_PRICING');
  if (vendor) {
    if (vendor.approvalStatus === 'PENDING_VERIFICATION') blockingReasons.push('VENDOR_APPROVAL_PENDING');
    else if (vendor.approvalStatus === 'SUSPENDED') blockingReasons.push('VENDOR_SUSPENDED');
    else if (vendor.approvalStatus !== 'ACTIVE') blockingReasons.push('VENDOR_NOT_APPROVED');
    if (vendor.operationalStatus !== 'ONLINE') blockingReasons.push('VENDOR_NOT_OPERATIONAL');
  }
  return {
    vendorId: record.vendorId,
    configurationReady,
    approvalStatus: vendor?.approvalStatus ?? 'UNKNOWN',
    operationalStatus: vendor?.operationalStatus ?? 'UNKNOWN',
    canAcceptBookings: blockingReasons.length === 0,
    requirements,
    optional: {
      team: { configured: vendor?.teamConfigured === true },
      payments: { configured: vendor?.paymentsConfigured === true },
    },
    blockingReasons,
    projectionVersion: BOOKING_READINESS_VERSION,
    projectionState: record.projectionState,
    ...(record.projectionState === PROJECTION_STATE.FRESH ? { reconciledAt: record.updatedAt } : {}),
    updatedAt: record.updatedAt,
  };
}

export function pendingBookingReadiness(vendorId: string, approvalStatus: string, now: string): BookingReadiness {
  const view = projectBookingReadiness({
    vendorId,
    projectionRevision: 0,
    projectionState: PROJECTION_STATE.PENDING_RECONCILIATION,
    updatedAt: now,
  });
  return { ...view, approvalStatus };
}
