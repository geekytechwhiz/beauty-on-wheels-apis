import { ConditionalWriteConflictError, ForbiddenError } from '@api-hub/utils';
import type { LambdaRequest } from '@api-hub/utils';

import type { BookingReadinessRecord } from '../domain/booking-readiness';
import { BookingReadinessService } from './booking-readiness.service';

const request = (userId: string, roles: string[] = []): LambdaRequest => ({
  pathParameters: { vendorId: 'vendor-1' },
  context: { authContext: { userId, roles }, userContext: { userId } },
} as unknown as LambdaRequest);

class MemoryReadiness {
  record: BookingReadinessRecord | null = null;
  saves = 0;
  failOnce = false;
  async find(): Promise<BookingReadinessRecord | null> {
    return this.record ? structuredClone(this.record) : null;
  }
  async save(record: BookingReadinessRecord, expectedRevision: number | null): Promise<void> {
    if (this.failOnce) {
      this.failOnce = false;
      throw new ConditionalWriteConflictError('conflict');
    }
    if ((this.record?.projectionRevision ?? null) !== expectedRevision) {
      throw new ConditionalWriteConflictError('revision');
    }
    this.record = structuredClone(record);
    this.saves += 1;
  }
}

const vendorPayload = {
  eventId: 'evt-vendor',
  vendorId: 'vendor-1',
  source: 'vendor-service',
  aggregateVersion: 2,
  occurredAt: '2026-10-26T08:00:00.000Z',
  transition: 'approved',
  detail: {
    fact: 'vendor',
    approvalStatus: 'ACTIVE',
    operationalStatus: 'ONLINE',
    onboardingComplete: true,
    businessProfileComplete: true,
    ownerUserId: 'owner-1',
    staffUserIds: ['staff-1'],
    activeCommunityCount: 1,
    applicablePricingCount: 1,
    teamConfigured: true,
    paymentsConfigured: false,
  },
};

describe('BookingReadinessService', () => {
  const store = new MemoryReadiness();
  const vendors = { getVendorById: jest.fn(), listVendors: jest.fn() };
  const staff = { findStaffByUserId: jest.fn() };
  const service = new BookingReadinessService({
    readiness: store as never,
    vendors: vendors as never,
    staff: staff as never,
    now: () => '2026-10-26T08:00:00.000Z',
    publishVendor: jest.fn(),
  });

  beforeEach(() => {
    store.record = null;
    store.saves = 0;
    store.failOnce = false;
    vendors.getVendorById.mockReset();
    staff.findStaffByUserId.mockReset();
  });

  it('reads one stored projection for the vendor owner', async () => {
    await service.apply(vendorPayload);
    vendors.getVendorById.mockRejectedValue(new Error('profile should not be read'));
    const view = await service.get(request('owner-1'), 'vendor-1');
    expect(vendors.getVendorById).not.toHaveBeenCalled();
    expect(view.canAcceptBookings).toBe(false);
    expect(view.requirements.pricing.applicableCount).toBe(1);
  });

  it('allows projected staff and rejects customers', async () => {
    await service.apply(vendorPayload);
    await expect(service.get(request('staff-1'), 'vendor-1')).resolves.toMatchObject({ vendorId: 'vendor-1' });
    staff.findStaffByUserId.mockResolvedValue(null);
    await expect(service.get(request('customer-1'), 'vendor-1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('ignores duplicate and stale facts', async () => {
    await service.apply(vendorPayload);
    expect(await service.apply(vendorPayload)).toBe('duplicate');
    expect(await service.apply({ ...vendorPayload, eventId: 'evt-old', aggregateVersion: 1 })).toBe('stale');
    expect(store.saves).toBe(1);
  });

  it('retries a conflicting write and keeps the newer fact', async () => {
    store.failOnce = true;
    await expect(service.apply(vendorPayload)).resolves.toBe('applied');
    expect(store.saves).toBe(1);
    expect(store.record?.vendor?.aggregateVersion).toBe(2);
  });
});
