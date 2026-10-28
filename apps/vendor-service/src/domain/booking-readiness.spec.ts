import {
  BOOKING_READINESS_FACT_SOURCES,
  type BookingReadinessFactPayload,
} from '@api-hub/event-platform';

import {
  applyReadinessFact,
  pendingBookingReadiness,
  PROJECTION_STATE,
  projectBookingReadiness,
} from './booking-readiness';

const now = '2026-10-26T08:00:00.000Z';

const vendorFact = (overrides: Partial<Extract<BookingReadinessFactPayload['detail'], { fact: 'vendor' }>> = {}): BookingReadinessFactPayload => ({
  eventId: 'evt-vendor',
  vendorId: 'vendor-1',
  source: BOOKING_READINESS_FACT_SOURCES.VENDOR,
  aggregateVersion: 3,
  occurredAt: now,
  transition: 'approved',
  detail: {
    fact: 'vendor',
    approvalStatus: 'ACTIVE',
    operationalStatus: 'ONLINE',
    onboardingComplete: true,
    businessProfileComplete: true,
    ownerUserId: 'owner-1',
    staffUserIds: ['staff-user'],
    activeCommunityCount: 1,
    applicablePricingCount: 1,
    teamConfigured: false,
    paymentsConfigured: false,
    ...overrides,
  },
});

describe('booking readiness projection', () => {
  it('treats missing catalog and availability facts as not ready', () => {
    const applied = applyReadinessFact(null, vendorFact(), now);
    expect(applied.result).toBe('applied');
    if (applied.result !== 'applied') return;
    const view = projectBookingReadiness(applied.record);
    expect(view.configurationReady).toBe(false);
    expect(view.canAcceptBookings).toBe(false);
    expect(view.blockingReasons).toContain('READINESS_PENDING_RECONCILIATION');
    expect(view.projectionState).toBe(PROJECTION_STATE.PENDING_RECONCILIATION);
  });

  it('clears service readiness when the authoritative count is zero', () => {
    const vendor = applyReadinessFact(null, vendorFact(), now);
    if (vendor.result !== 'applied') throw new Error('vendor fact was not applied');
    const services = applyReadinessFact(vendor.record, {
      eventId: 'evt-services',
      vendorId: 'vendor-1',
      source: BOOKING_READINESS_FACT_SOURCES.CATALOG,
      aggregateVersion: 8,
      occurredAt: now,
      transition: 'disabled',
      detail: { fact: 'services', activeBookableServiceCount: 0 },
    }, now);
    if (services.result !== 'applied') throw new Error('service fact was not applied');
    const visits = applyReadinessFact(services.record, {
      eventId: 'evt-visits',
      vendorId: 'vendor-1',
      source: BOOKING_READINESS_FACT_SOURCES.AVAILABILITY,
      aggregateVersion: 2,
      occurredAt: now,
      transition: 'updated',
      detail: { fact: 'visitSchedules', activeValidVisitScheduleCount: 1 },
    }, now);
    if (visits.result !== 'applied') throw new Error('visit fact was not applied');
    const view = projectBookingReadiness(visits.record);
    expect(view.requirements.services).toEqual({ complete: false, activeCount: 0 });
    expect(view.blockingReasons).toContain('NO_ACTIVE_SERVICE');
    expect(view.canAcceptBookings).toBe(false);
    expect(view.optional.payments.configured).toBe(false);
  });

  it('is bookable only when every required fact is ready and payments stay optional', () => {
    let record = applyReadinessFact(null, vendorFact(), now).record;
    record = applyReadinessFact(record, {
      eventId: 'evt-services',
      vendorId: 'vendor-1',
      source: BOOKING_READINESS_FACT_SOURCES.CATALOG,
      aggregateVersion: 4,
      occurredAt: now,
      transition: 'enabled',
      detail: { fact: 'services', activeBookableServiceCount: 2 },
    }, now).record!;
    record = applyReadinessFact(record, {
      eventId: 'evt-visits',
      vendorId: 'vendor-1',
      source: BOOKING_READINESS_FACT_SOURCES.AVAILABILITY,
      aggregateVersion: 5,
      occurredAt: now,
      transition: 'enabled',
      detail: { fact: 'visitSchedules', activeValidVisitScheduleCount: 1 },
    }, now).record!;
    const view = projectBookingReadiness(record!);
    expect(view.configurationReady).toBe(true);
    expect(view.canAcceptBookings).toBe(true);
    expect(view.optional.team.configured).toBe(false);
    expect(view.optional.payments.configured).toBe(false);
  });

  it('rejects stale and duplicate versions without changing the record', () => {
    const applied = applyReadinessFact(null, vendorFact(), now);
    if (applied.result !== 'applied') throw new Error('expected apply');
    const duplicate = applyReadinessFact(applied.record, vendorFact(), now);
    const stale = applyReadinessFact(applied.record, { ...vendorFact(), eventId: 'evt-old', aggregateVersion: 2 }, now);
    expect(duplicate.result).toBe('duplicate');
    expect(stale.result).toBe('stale');
    expect(duplicate.record?.projectionRevision).toBe(1);
  });

  it('keeps an unapproved vendor blocked after configuration is complete', () => {
    const pending = pendingBookingReadiness('vendor-1', 'PENDING_VERIFICATION', now);
    expect(pending.canAcceptBookings).toBe(false);
    expect(pending.approvalStatus).toBe('PENDING_VERIFICATION');
  });

  it('blocks suspended and offline vendors', () => {
    let record = applyReadinessFact(null, vendorFact({ approvalStatus: 'SUSPENDED', operationalStatus: 'OFFLINE' }), now).record;
    record = applyReadinessFact(record, {
      eventId: 'evt-services', vendorId: 'vendor-1', source: 'service-catalog-service', aggregateVersion: 1, occurredAt: now, transition: 'created',
      detail: { fact: 'services', activeBookableServiceCount: 1 },
    }, now).record;
    record = applyReadinessFact(record, {
      eventId: 'evt-visits', vendorId: 'vendor-1', source: 'availability-service', aggregateVersion: 1, occurredAt: now, transition: 'created',
      detail: { fact: 'visitSchedules', activeValidVisitScheduleCount: 1 },
    }, now).record;
    const view = projectBookingReadiness(record!);
    expect(view.blockingReasons).toEqual(expect.arrayContaining(['VENDOR_SUSPENDED', 'VENDOR_NOT_OPERATIONAL']));
    expect(view.canAcceptBookings).toBe(false);
  });
});
