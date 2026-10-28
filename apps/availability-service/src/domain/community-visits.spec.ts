import { ValidationError } from '@api-hub/utils';

import {
  bookableBlock,
  datedWindow,
  occurrenceDates,
  recurringSchedulesOverlap,
  schedulesOverlap,
  visitIdFor,
  weekdayIndex,
} from './community-visits';

const kolkata = 'Asia/Kolkata';

describe('community visit scheduling', () => {
  it('keeps an overnight Sunday window on Monday and stable across retries', () => {
    expect(weekdayIndex('2026-10-25')).toBe(6);
    const window = datedWindow('2026-10-25', '22:00', '02:00', kolkata);
    expect(window.overnight).toBe(true);
    expect(window.endAt).toBe('2026-10-25T20:30:00.000Z');
    expect(window.startAt).toBe('2026-10-25T16:30:00.000Z');
    expect(visitIdFor('cvr_ivy', '2026-10-25')).toBe(visitIdFor('cvr_ivy', '2026-10-25'));
  });

  it('rejects a window that starts and finishes at the same time', () => {
    expect(() => datedWindow('2026-10-26', '09:00', '09:00', kolkata)).toThrow(ValidationError);
  });

  it('detects a Sunday-night overlap with a Monday-morning visit for the same crew', () => {
    const nights = { days: [6], startTime: '22:00', endTime: '02:00', effectiveDate: '2026-10-25', timezone: kolkata, oneOff: false };
    const monday = { days: [0], startTime: '00:30', endTime: '04:00', effectiveDate: '2026-10-26', timezone: kolkata, oneOff: false };
    expect(recurringSchedulesOverlap(nights, monday)).toBe(true);
    expect(recurringSchedulesOverlap(nights, { ...monday, crewId: 'crew-b' })).toBe(false);
  });

  it('detects an overnight one-off that crosses into another community visit', () => {
    const oneOff = { days: [], startTime: '22:00', endTime: '02:00', effectiveDate: '2026-10-25', timezone: kolkata, oneOff: true };
    const monday = { days: [0], startTime: '01:00', endTime: '05:00', effectiveDate: '2026-10-01', timezone: kolkata, oneOff: false };
    expect(schedulesOverlap(oneOff, monday)).toBe(true);
  });

  it('generates only the selected weekdays inside the horizon', () => {
    const dates = occurrenceDates({
      days: [0, 6],
      startTime: '05:00',
      endTime: '09:00',
      effectiveDate: '2026-10-24',
      timezone: kolkata,
      oneOff: false,
    }, '2026-10-24', '2026-11-02');
    expect(dates).toEqual(['2026-10-25', '2026-10-26', '2026-11-01', '2026-11-02']);
  });

  it('blocks cancelled, past, cutoff, and over-capacity reservations', () => {
    const base = {
      status: 'scheduled' as const,
      startAt: '2026-10-26T00:30:00.000Z',
      endAt: '2026-10-26T03:30:00.000Z',
      bookingCutoffMinutes: 60,
      capacity: 2,
      bookedCount: 1,
      heldCount: 1,
      covered: true,
      vendorActive: true,
      now: new Date('2026-10-25T12:00:00.000Z'),
    };
    expect(bookableBlock(base)).toBe('capacity');
    expect(bookableBlock({ ...base, heldCount: 0, bookedCount: 0, now: new Date('2026-10-25T23:30:00.000Z') })).toBe('cutoff');
    expect(bookableBlock({ ...base, heldCount: 0, status: 'cancelled' })).toBe('cancelled');
    expect(bookableBlock({ ...base, heldCount: 0, now: new Date('2026-10-26T04:00:00.000Z') })).toBe('past');
    expect(bookableBlock({ ...base, heldCount: 0, covered: false })).toBe('coverage');
  });
});
