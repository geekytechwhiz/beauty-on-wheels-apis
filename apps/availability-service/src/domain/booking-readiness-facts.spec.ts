import { activeValidVisitScheduleCount } from './booking-readiness-facts';
import type { CommunityVisitScheduleRecord, DatedCommunityVisitRecord } from '../repositories/community-visits.repository';

const schedule = (overrides: Partial<CommunityVisitScheduleRecord> = {}): CommunityVisitScheduleRecord => ({
  scheduleId: 'schedule-1',
  vendorId: 'vendor-1',
  communityId: 'community-1',
  timezone: 'UTC',
  days: [0],
  startTime: '09:00',
  endTime: '12:00',
  effectiveDate: '2026-10-01',
  capacity: 2,
  bookingCutoffMinutes: 60,
  oneOff: false,
  active: true,
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  updatedBy: 'owner',
  ...overrides,
});

const visit = (overrides: Partial<DatedCommunityVisitRecord> = {}): DatedCommunityVisitRecord => ({
  visitId: 'visit-1',
  scheduleId: 'schedule-1',
  vendorId: 'vendor-1',
  communityId: 'community-1',
  timezone: 'UTC',
  date: '2026-10-26',
  startTime: '09:00',
  endTime: '12:00',
  startAt: '2026-10-26T09:00:00.000Z',
  endAt: '2026-10-26T12:00:00.000Z',
  overnight: false,
  capacity: 2,
  bookedCount: 0,
  heldCount: 0,
  status: 'scheduled',
  oneOff: false,
  exception: false,
  bookingCutoffMinutes: 60,
  version: 1,
  assignedStaffIds: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

describe('active visit schedule count', () => {
  const now = new Date('2026-10-26T08:00:00.000Z');

  it('counts a schedule with an upcoming scheduled visit', () => {
    expect(activeValidVisitScheduleCount([schedule()], [visit()], now)).toBe(1);
  });

  it('clears the count when the last visit is cancelled or in the past', () => {
    expect(activeValidVisitScheduleCount(
      [schedule(), schedule({ scheduleId: 'schedule-2' })],
      [visit({ status: 'cancelled' }), visit({ scheduleId: 'schedule-2', date: '2026-10-25' })],
      now,
    )).toBe(0);
  });
});
