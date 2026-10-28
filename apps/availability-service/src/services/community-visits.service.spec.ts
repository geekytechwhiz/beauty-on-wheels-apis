import { ConflictError, ForbiddenError, LambdaRequest, ValidationError } from '@api-hub/utils';

import { visitIdFor } from '../domain/community-visits';
import { MemoryCommunityVisitStore } from '../repositories/community-visits.repository';
import { CommunityVisitsService, VISIT_PERMISSION, VisitActor } from './community-visits.service';

const vendorId = 'vendor-1';
const communityId = 'community-ivy';
const otherCommunity = 'community-abad';
const now = new Date('2026-10-24T08:00:00.000Z');

function request(): LambdaRequest {
  return { context: { userContext: { userId: 'user-1' } } } as LambdaRequest;
}

function actor(overrides: Partial<VisitActor> = {}): VisitActor {
  return {
    userId: 'user-1',
    vendorId,
    role: 'owner',
    permissions: [VISIT_PERMISSION.VIEW, VISIT_PERMISSION.PUBLISH, VISIT_PERMISSION.MANAGE],
    vendorActive: true,
    communityIds: [communityId, otherCommunity],
    ...overrides,
  };
}

const emptyHolidays = { listVendorHolidays: async () => [] };

function serviceFor(current = actor(), clock = now) {
  const store = new MemoryCommunityVisitStore();
  const service = new CommunityVisitsService(
    store,
    { resolve: async () => current },
    () => clock,
    emptyHolidays as never,
  );
  return { store, service };
}

function customerRequest(userId = 'customer-1'): LambdaRequest {
  return { context: { authContext: { userId }, userContext: { userId } } } as LambdaRequest;
}

const morning = {
  communityId,
  communityName: 'Ivy League',
  locality: 'Kakkanad',
  city: 'Kochi',
  timezone: 'Asia/Kolkata',
  days: [0, 1, 2, 3, 4],
  startTime: '05:00',
  endTime: '09:00',
  effectiveDate: '2026-10-26',
  capacity: 8,
  bookingCutoffMinutes: 120,
  oneOff: false,
  idempotencyKey: 'publish-morning',
};

describe('community visit service', () => {
  it('publishes a morning series once when the request is retried', async () => {
    const { service } = serviceFor();
    const first = await service.publish(request(), vendorId, morning);
    const second = await service.publish(request(), vendorId, morning);
    expect(second).toEqual(first);
    const visits = await service.listVisits(request(), vendorId, { limit: 50 });
    const ids = visits.items.map((visit) => visit.visitId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(visits.items.every((visit) => visit.overnight === false)).toBe(true);
    expect(visits.items.some((visit) => visit.date === '2026-10-26')).toBe(true);
  });

  it('publishes night, weekend, custom, and one-off visits without changing the series', async () => {
    const { service } = serviceFor();
    await service.publish(request(), vendorId, { ...morning, idempotencyKey: 'night', days: [0, 2, 4], startTime: '22:00', endTime: '02:00', communityId: otherCommunity });
    await service.publish(request(), vendorId, { ...morning, idempotencyKey: 'weekend', days: [5, 6], startTime: '07:00', endTime: '18:00' });
    await service.publish(request(), vendorId, { ...morning, communityId: otherCommunity, idempotencyKey: 'one', oneOff: true, days: [], effectiveDate: '2026-11-20', startTime: '07:00', endTime: '18:00' });
    const visits = await service.listVisits(request(), vendorId, { limit: 50 });
    expect(visits.items.some((visit) => visit.overnight && visit.date === '2026-10-26')).toBe(true);
    expect(visits.items.some((visit) => visit.oneOff && visit.date === '2026-11-20')).toBe(true);
    const series = visits.items.filter((visit) => visit.communityId === otherCommunity && !visit.oneOff);
    expect(series.every((visit) => visit.startTime === '22:00')).toBe(true);
  });

  it('rejects an overlapping crew window and a same start and finish', async () => {
    const { service } = serviceFor();
    await service.publish(request(), vendorId, { ...morning, idempotencyKey: 'nights', days: [6], startTime: '22:00', endTime: '02:00' });
    await expect(service.publish(request(), vendorId, { ...morning, communityId: otherCommunity, idempotencyKey: 'monday', days: [0], startTime: '00:30', endTime: '04:00' })).rejects.toBeInstanceOf(ConflictError);
    await expect(service.publish(request(), vendorId, { ...morning, idempotencyKey: 'equal', startTime: '09:00', endTime: '09:00' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('changes one visit capacity and cancellation without editing the series or its bookings', async () => {
    const { service } = serviceFor();
    await service.publish(request(), vendorId, morning);
    const listed = await service.listVisits(request(), vendorId, { limit: 1 });
    const visit = listed.items[0];
    const reserved = await service.reserve(request(), vendorId, visit.visitId, { bookingId: 'booking-1', units: 1, idempotencyKey: 'reserve-1' });
    const updated = await service.updateCapacity(request(), vendorId, visit.visitId, { capacity: 3, expectedVersion: reserved.version, idempotencyKey: 'cap-1' });
    expect(updated.capacity).toBe(3);
    expect(updated.exception).toBe(true);
    const cancelled = await service.cancel(request(), vendorId, visit.visitId, { expectedVersion: updated.version, idempotencyKey: 'cancel-1' });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.affectedBookingCount).toBe(1);
    expect(cancelled.bookingsCancelled).toBe(false);
    expect(cancelled.bookingIds).toEqual(['booking-1']);
    const schedules = await service.listSchedules(request(), vendorId);
    expect(schedules.items[0].capacity).toBe(8);
    await expect(service.reserve(request(), vendorId, visit.visitId, { bookingId: 'booking-2', units: 1, idempotencyKey: 'reserve-2' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('keeps a booked occurrence when the series changes and rejects capacity below reservations', async () => {
    const { service } = serviceFor();
    await service.publish(request(), vendorId, morning);
    const visit = (await service.listVisits(request(), vendorId, { limit: 1 })).items[0];
    await service.reserve(request(), vendorId, visit.visitId, { bookingId: 'booking-1', units: 1, idempotencyKey: 'reserve-1' });
    await service.reserve(request(), vendorId, visit.visitId, { bookingId: 'booking-1', units: 1, idempotencyKey: 'reserve-1b' });
    const published = await service.publish(request(), vendorId, { ...morning, idempotencyKey: 'edit', days: [5], startTime: '07:00', endTime: '12:00', expectedVersion: 1 });
    expect(published.preservedVisits.map((item) => item.visitId)).toContain(visit.visitId);
    const after = await service.listVisits(request(), vendorId, { limit: 50 });
    const preserved = after.items.find((item) => item.visitId === visit.visitId);
    expect(preserved?.startTime).toBe('05:00');
    await expect(service.updateCapacity(request(), vendorId, visit.visitId, { capacity: 0, expectedVersion: preserved?.version ?? 0, idempotencyKey: 'too-small' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a second reservation when capacity is already taken', async () => {
    const { service } = serviceFor();
    await service.publish(request(), vendorId, { ...morning, capacity: 1, idempotencyKey: 'one-car' });
    const visit = (await service.listVisits(request(), vendorId, { limit: 1 })).items[0];
    await service.reserve(request(), vendorId, visit.visitId, { bookingId: 'booking-1', units: 1, idempotencyKey: 'a' });
    await expect(service.reserve(request(), vendorId, visit.visitId, { bookingId: 'booking-2', units: 1, idempotencyKey: 'b' })).rejects.toBeInstanceOf(ConflictError);
    const released = await service.release(request(), vendorId, visit.visitId, 'booking-1');
    expect(released.bookedCount).toBe(0);
  });

  it('shows staff only the visit reserved for them and rejects management', async () => {
    const owner = serviceFor();
    await owner.service.publish(request(), vendorId, morning);
    const visit = (await owner.service.listVisits(request(), vendorId, { limit: 5 })).items[0];
    await owner.service.reserve(request(), vendorId, visit.visitId, { bookingId: 'booking-1', units: 1, staffId: 'staff-1', idempotencyKey: 'assign' });
    const staff = new CommunityVisitsService(owner.store, {
      resolve: async () => actor({ role: 'staff', staffId: 'staff-1', permissions: [VISIT_PERMISSION.VIEW], communityIds: [] }),
    }, () => now);
    const visible = await staff.listVisits(request(), vendorId, { limit: 20 });
    expect(visible.items.map((item) => item.visitId)).toEqual([visit.visitId]);
    expect(visible.items[0].bookingIds).toEqual(['booking-1']);
    const other = new CommunityVisitsService(owner.store, {
      resolve: async () => actor({ role: 'staff', staffId: 'staff-2', permissions: [VISIT_PERMISSION.VIEW], communityIds: [] }),
    }, () => now);
    expect((await other.listVisits(request(), vendorId, { limit: 20 })).items).toEqual([]);
    await expect(other.listBookingRefs(request(), vendorId, visit.visitId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staff.publish(request(), vendorId, { ...morning, idempotencyKey: 'staff-publish' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staff.cancel(request(), vendorId, visit.visitId, { expectedVersion: visit.version, idempotencyKey: 'staff-cancel' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('uses a stable visit id for the Sunday overnight occurrence', () => {
    expect(visitIdFor('cvr_community-ivy', '2026-10-25')).toMatch(/^vst_[a-f0-9]{24}$/);
  });

  it('lists bookable community occurrences by community and date range with optional vendor filter', async () => {
    const { service } = serviceFor();
    await service.publish(request(), vendorId, morning);
    const empty = await service.listBookableOccurrences(customerRequest(), {
      communityId: 'community-missing',
      fromDate: '2026-10-26',
      toDate: '2026-10-31',
    });
    expect(empty.items).toEqual([]);
    const page = await service.listBookableOccurrences(customerRequest(), {
      communityId,
      fromDate: '2026-10-26',
      toDate: '2026-10-31',
      vendorId,
    });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((item) => item.communityId === communityId && item.vendorId === vendorId && item.available > 0)).toBe(true);
    const otherVendor = await service.listBookableOccurrences(customerRequest(), {
      communityId,
      fromDate: '2026-10-26',
      toDate: '2026-10-31',
      vendorId: 'vendor-other',
    });
    expect(otherVendor.items).toEqual([]);
  });

  it('holds capacity idempotently, rejects oversell, expires, releases, and confirms', async () => {
    const { service, store } = serviceFor();
    await service.publish(request(), vendorId, { ...morning, capacity: 1, idempotencyKey: 'cap-1' });
    const visit = (await service.listVisits(request(), vendorId, { limit: 1 })).items[0];
    const first = await service.createHold(customerRequest(), {
      vendorId,
      visitId: visit.visitId,
      units: 1,
      idempotencyKey: 'hold-1',
    });
    const replay = await service.createHold(customerRequest(), {
      vendorId,
      visitId: visit.visitId,
      units: 1,
      idempotencyKey: 'hold-1',
    });
    expect(replay.holdId).toBe(first.holdId);
    await expect(service.createHold(customerRequest('customer-2'), {
      vendorId,
      visitId: visit.visitId,
      units: 1,
      idempotencyKey: 'hold-2',
    })).rejects.toBeInstanceOf(ConflictError);
    const afterHold = await store.getVisit(vendorId, visit.visitId);
    expect(afterHold?.heldCount).toBe(1);
    expect(afterHold?.available ?? afterHold!.capacity - afterHold!.bookedCount - afterHold!.heldCount).toBe(0);

    const released = await service.releaseHold(customerRequest(), first.holdId);
    expect(released.status).toBe('released');
    expect((await store.getVisit(vendorId, visit.visitId))?.heldCount).toBe(0);

    const held = await service.createHold(customerRequest(), {
      vendorId,
      visitId: visit.visitId,
      units: 1,
      idempotencyKey: 'hold-3',
    });
    const confirmed = await service.confirmHold({ holdId: held.holdId, bookingId: 'booking-9' });
    expect(confirmed.hold.status).toBe('consumed');
    expect(confirmed.visit.bookedCount).toBe(1);
    expect(confirmed.visit.heldCount).toBe(0);
    const again = await service.confirmHold({ holdId: held.holdId, bookingId: 'booking-9' });
    expect(again.hold.bookingId).toBe('booking-9');
  });

  it('expires an active visit hold and restores capacity without relying on TTL deletes', async () => {
    const start = new Date('2026-10-24T08:00:00.000Z');
    let clock = start;
    const store = new MemoryCommunityVisitStore();
    const service = new CommunityVisitsService(
      store,
      { resolve: async () => actor() },
      () => clock,
      emptyHolidays as never,
      60,
    );
    await service.publish(request(), vendorId, { ...morning, capacity: 1, idempotencyKey: 'expire' });
    const visit = (await service.listVisits(request(), vendorId, { limit: 1 })).items[0];
    const hold = await service.createHold(customerRequest(), {
      vendorId,
      visitId: visit.visitId,
      units: 1,
      idempotencyKey: 'exp-hold',
    });
    clock = new Date(start.getTime() + 120_000);
    const result = await service.expireDueHolds(clock);
    expect(result.expired).toBe(1);
    expect((await store.getHold(hold.holdId))?.status).toBe('expired');
    expect((await store.getVisit(vendorId, visit.visitId))?.heldCount).toBe(0);
  });

  it('blocks and unblocks an occurrence and excludes holidays from customer availability', async () => {
    const holidays = {
      listVendorHolidays: async () => [{ date: '2026-10-27', holidayId: 'h1', vendorId, PK: '', SK: '', entityType: 'Holiday' as const, createdAt: '', updatedAt: '' }],
    };
    const store = new MemoryCommunityVisitStore();
    const service = new CommunityVisitsService(
      store,
      { resolve: async () => actor() },
      () => now,
      holidays as never,
    );
    await service.publish(request(), vendorId, morning);
    const visit = (await service.listVisits(request(), vendorId, { fromDate: '2026-10-26', toDate: '2026-10-31', limit: 20 })).items
      .find((item) => item.date === '2026-10-26');
    expect(visit).toBeDefined();
    const cancelled = await service.cancel(request(), vendorId, visit!.visitId, {
      expectedVersion: visit!.version,
      idempotencyKey: 'block-1',
    });
    expect(cancelled.status).toBe('cancelled');
    const bookableWhileBlocked = await service.listBookableOccurrences(customerRequest(), {
      communityId,
      fromDate: '2026-10-26',
      toDate: '2026-10-26',
      vendorId,
    });
    expect(bookableWhileBlocked.items).toEqual([]);
    const restored = await service.unblock(request(), vendorId, visit!.visitId, {
      expectedVersion: cancelled.version,
      idempotencyKey: 'unblock-1',
    });
    expect(restored.status).toBe('scheduled');
    const holidayHidden = await service.listBookableOccurrences(customerRequest(), {
      communityId,
      fromDate: '2026-10-27',
      toDate: '2026-10-27',
      vendorId,
    });
    expect(holidayHidden.items).toEqual([]);
  });

  it('deactivates a recurring schedule so future empty occurrences stop generating', async () => {
    const { service, store } = serviceFor();
    const published = await service.publish(request(), vendorId, morning);
    const deactivated = await service.deactivateSchedule(request(), vendorId, published.schedule.scheduleId, {
      expectedVersion: published.schedule.version,
      idempotencyKey: 'deact-1',
    });
    expect(deactivated.schedule.active).toBe(false);
    const schedules = await store.listSchedules(vendorId);
    expect(schedules[0].active).toBe(false);
  });
});
