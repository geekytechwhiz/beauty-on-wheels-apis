import { weekdayOfCivilDate, zonedClock, buildSlotWindows, civilDatesInclusive, hourBucketsEndingAt } from './time';
import { remainingCapacity, displayStatus } from './capacity';
import { AvailabilityKeyBuilder } from './keys';
import { deterministicSlotId } from './ids';

describe('availability time and keys', () => {
  it('treats a civil date as that weekday regardless of the reader timezone', () => {
    expect(weekdayOfCivilDate('2026-10-12')).toBe('MON');
    expect(weekdayOfCivilDate('2026-10-11')).toBe('SUN');
  });

  it('rolls the business date at the timezone midnight boundary', () => {
    const clock = zonedClock('Asia/Kolkata', new Date('2026-10-12T18:30:00.000Z'));
    expect(clock).toEqual({ date: '2026-10-13', time: '00:00' });
  });

  it('keeps the previous business date before local midnight', () => {
    const clock = zonedClock('America/New_York', new Date('2026-03-08T06:59:00.000Z'));
    expect(clock.date).toBe('2026-03-08');
  });

  it('stops the slot grid at closing time', () => {
    expect(buildSlotWindows('09:00', '10:00', 30)).toEqual([
      { startTime: '09:00', endTime: '09:30' },
      { startTime: '09:30', endTime: '10:00' },
    ]);
    expect(buildSlotWindows('17:30', '18:00', 60)).toEqual([]);
  });

  it('rejects ranges longer than 31 days', () => {
    expect(civilDatesInclusive('2026-10-01', '2026-10-31')).toHaveLength(31);
    expect(civilDatesInclusive('2026-10-01', '2026-11-15').length).toBeGreaterThan(31);
  });

  it('builds hour buckets backwards from the current hour', () => {
    const buckets = hourBucketsEndingAt(new Date('2026-10-12T11:40:00.000Z'), 2);
    expect(buckets).toEqual(['2026-10-12T11', '2026-10-12T10']);
  });

  it('partitions inventory by vendor, branch, and date', () => {
    expect(AvailabilityKeyBuilder.dailyPk('vendor-1', 'branch-1', '2026-10-12')).toBe(
      'VENDOR#vendor-1#BRANCH#branch-1#DATE#2026-10-12',
    );
    const slotId = deterministicSlotId('vendor-1', 'branch-1', '2026-10-12', '09:00');
    expect(AvailabilityKeyBuilder.slotSk('09:00', slotId)).toBe(`SLOT#09:00#${slotId}`);
    expect(deterministicSlotId('vendor-1', 'branch-1', '2026-10-12', '09:00')).toBe(slotId);
  });

  it('derives remaining capacity without mutating counters', () => {
    const slot = {
      capacity: 2,
      heldCount: 1,
      bookedCount: 1,
      status: 'available' as const,
    };
    expect(remainingCapacity(slot)).toBe(0);
    expect(displayStatus(slot)).toBe('full');
    expect(displayStatus({ ...slot, status: 'blocked', heldCount: 0, bookedCount: 0 })).toBe(
      'blocked',
    );
  });
});
