import {
  countReadinessTransition,
  planBookingReadinessFact,
  vendorReadinessTransition,
  type BookingReadinessFactPayload,
  type VendorReadinessDetail,
} from './booking-readiness-fact.events';

const vendorDetail = (overrides: Partial<VendorReadinessDetail> = {}): VendorReadinessDetail => ({
  fact: 'vendor',
  approvalStatus: 'PENDING_VERIFICATION',
  operationalStatus: 'OFFLINE',
  onboardingComplete: false,
  businessProfileComplete: false,
  ownerUserId: 'owner-1',
  staffUserIds: [],
  activeCommunityCount: 0,
  applicablePricingCount: 0,
  teamConfigured: false,
  paymentsConfigured: false,
  ...overrides,
});

const stored = (detail: BookingReadinessFactPayload['detail'], version = 4, pendingPublish = false): { aggregateVersion: number; pendingPublish: boolean; payload: BookingReadinessFactPayload } => ({
  aggregateVersion: version,
  pendingPublish,
  payload: {
    eventId: 'evt-stored',
    vendorId: 'vendor-1',
    source: 'service-catalog-service',
    aggregateVersion: version,
    occurredAt: '2026-10-26T07:00:00Z',
    transition: 'updated',
    detail,
  },
});

describe('booking readiness fact planning', () => {
  it('commits the next version when the authoritative count changes', () => {
    const plan = planBookingReadinessFact({
      current: stored({ fact: 'services', activeBookableServiceCount: 2 }),
      vendorId: 'vendor-1',
      source: 'service-catalog-service',
      transition: 'disabled',
      detail: { fact: 'services', activeBookableServiceCount: 0 },
      eventId: 'evt-next',
      occurredAt: '2026-10-26T08:00:00.000Z',
    });
    expect(plan.action).toBe('commit');
    if (plan.action !== 'commit') return;
    expect(plan.expectedVersion).toBe(4);
    expect(plan.payload.aggregateVersion).toBe(5);
    expect(plan.payload.detail).toEqual({ fact: 'services', activeBookableServiceCount: 0 });
  });

  it('keeps the stored version when the summary is unchanged', () => {
    const current = stored({ fact: 'visitSchedules', activeValidVisitScheduleCount: 1 });
    const plan = planBookingReadinessFact({
      current,
      vendorId: 'vendor-1',
      source: 'availability-service',
      transition: 'updated',
      detail: { fact: 'visitSchedules', activeValidVisitScheduleCount: 1 },
      eventId: 'evt-new',
      occurredAt: '2026-10-26T09:00:00Z',
    });
    expect(plan).toEqual({ action: 'skip', payload: current.payload });
  });

  it('republishes a stored version that has not reached EventBridge', () => {
    const current = stored({ fact: 'services', activeBookableServiceCount: 1 }, 4, true);
    const plan = planBookingReadinessFact({
      current,
      vendorId: 'vendor-1',
      source: 'service-catalog-service',
      transition: 'updated',
      detail: { fact: 'services', activeBookableServiceCount: 1 },
      eventId: 'evt-new',
      occurredAt: '2026-10-26T09:00:00Z',
    });
    expect(plan).toEqual({ action: 'republish', payload: current.payload });
  });

  it('names approval and zero-count transitions without using the clock', () => {
    expect(vendorReadinessTransition(null, vendorDetail())).toBe('created');
    expect(vendorReadinessTransition(vendorDetail(), vendorDetail({ approvalStatus: 'ACTIVE' }))).toBe('approved');
    expect(vendorReadinessTransition(vendorDetail({ approvalStatus: 'ACTIVE' }), vendorDetail({ approvalStatus: 'SUSPENDED' }))).toBe('suspended');
    expect(vendorReadinessTransition(vendorDetail({ approvalStatus: 'ACTIVE' }), vendorDetail({ approvalStatus: 'REJECTED' }))).toBe('rejected');
    expect(countReadinessTransition(2, 0, 'deleted')).toBe('deleted');
    expect(countReadinessTransition(2, 0, 'disabled')).toBe('disabled');
    expect(countReadinessTransition(0, 2)).toBe('enabled');
    expect(countReadinessTransition(2, 1)).toBe('updated');
  });
});
