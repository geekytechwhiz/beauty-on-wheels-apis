import { ConflictError, ValidationError } from '@api-hub/utils';

import {
  CommittedLoad,
  ServiceWindow,
  assertCapacityAvailable,
  claimedPeriodQuantityOf,
  commitmentIdForProposal,
  commitmentPeriodSupply,
  dailyCapacity,
  expandWindowDates,
  hasOfferingScopedCapacity,
  packageScopeForWrite,
  packageScopeOfferingId,
  peakCommittedQuantity,
  planReservationConsumesDailySlots,
  validateServiceWindow,
  visitFitsDailyWindow,
  windowServesDate,
  windowsOverlap,
} from './capacity-commitment';

function window(
  startDate: string,
  endDate: string,
  startTime = '09:00',
  endTime = '13:00',
  daysOfWeek?: ServiceWindow['daysOfWeek'],
): ServiceWindow {
  return {
    startDate,
    endDate,
    dailyWindow: { startTime, endTime },
    ...(daysOfWeek ? { daysOfWeek } : {}),
  };
}

function load(w: ServiceWindow, quantity: number, status: CommittedLoad['status'] = 'ACTIVE'): CommittedLoad {
  return { window: w, quantity, status };
}

describe('capacity windows', () => {
  it('computes daily capacity as crews x visits per crew per day (default 4)', () => {
    expect(dailyCapacity(3)).toBe(12);
    expect(dailyCapacity(0)).toBe(0);
    expect(dailyCapacity(2, 5)).toBe(10);
  });

  it('expands dates and honours daysOfWeek', () => {
    // 2026-11-02 is a Monday.
    expect(expandWindowDates(window('2026-11-02', '2026-11-04'))).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ]);
    expect(expandWindowDates(window('2026-11-02', '2026-11-08', '09:00', '13:00', ['MONDAY', 'SUNDAY']))).toEqual([
      '2026-11-02',
      '2026-11-08',
    ]);
  });

  it('validates window shape', () => {
    expect(() => validateServiceWindow(window('2026-11-05', '2026-11-01'))).toThrow(ValidationError);
    expect(() => validateServiceWindow(window('2026-11-01', '2026-11-02', '13:00', '09:00'))).toThrow(ValidationError);
    expect(() => validateServiceWindow(window('2026-02-30', '2026-03-02'))).toThrow(ValidationError);
    expect(() => validateServiceWindow(window('2026-01-01', '2027-06-01'))).toThrow(/366/);
    // Tuesday-only window that covers only a Monday.
    expect(() => validateServiceWindow(window('2026-11-02', '2026-11-02', '09:00', '13:00', ['TUESDAY'])))
      .toThrow(/no service days/);
  });

  it('detects overlap by date, weekday and daily time', () => {
    const base = window('2026-11-02', '2026-11-08');
    expect(windowsOverlap(base, window('2026-11-08', '2026-11-20'))).toBe(true);
    expect(windowsOverlap(base, window('2026-11-09', '2026-11-20'))).toBe(false);
    expect(windowsOverlap(base, window('2026-11-02', '2026-11-08', '13:00', '17:00'))).toBe(false);
    expect(windowsOverlap(base, window('2026-11-02', '2026-11-08', '12:00', '17:00'))).toBe(true);
    expect(
      windowsOverlap(
        window('2026-11-02', '2026-11-08', '09:00', '13:00', ['MONDAY']),
        window('2026-11-02', '2026-11-08', '09:00', '13:00', ['TUESDAY']),
      ),
    ).toBe(false);
  });

  it('derives one commitment id per proposal', () => {
    expect(commitmentIdForProposal('p1')).toBe(commitmentIdForProposal('p1'));
    expect(commitmentIdForProposal('p1')).not.toBe(commitmentIdForProposal('p2'));
  });
});

describe('assertCapacityAvailable', () => {
  const target = window('2026-11-02', '2026-11-08');

  it('sums overlapping commitments per day, across communities', () => {
    const commitments = [
      load(window('2026-11-01', '2026-11-04'), 5),
      load(window('2026-11-03', '2026-11-10'), 4),
    ];
    // Peak is Nov 3-4 with 9 committed.
    expect(peakCommittedQuantity(commitments, target).peak).toBe(9);
    expect(() => assertCapacityAvailable({ commitments, window: target, quantity: 3, capacityPerDay: 12 })).not.toThrow();
    expect(() => assertCapacityAvailable({ commitments, window: target, quantity: 4, capacityPerDay: 12 })).toThrow(ConflictError);
  });

  it('ignores non-overlapping windows and CANCELLED commitments', () => {
    const commitments = [
      load(window('2026-12-01', '2026-12-31'), 12),
      load(window('2026-11-02', '2026-11-08', '14:00', '18:00'), 12),
      load(target, 12, 'CANCELLED'),
    ];
    expect(() => assertCapacityAvailable({ commitments, window: target, quantity: 12, capacityPerDay: 12 })).not.toThrow();
  });

  it('keeps counting CHANGE_PENDING and REDUCED commitments', () => {
    const commitments = [load(target, 6, 'CHANGE_PENDING'), load(target, 4, 'REDUCED')];
    expect(() => assertCapacityAvailable({ commitments, window: target, quantity: 3, capacityPerDay: 12 })).toThrow(ConflictError);
  });

  it('rejects everything when the vendor has no crew capacity', () => {
    expect(() => assertCapacityAvailable({ commitments: [], window: target, quantity: 1, capacityPerDay: 0 })).toThrow(ConflictError);
  });
});

describe('period supply and visit window alignment', () => {
  it('computes period supply as daily quantity × service days', () => {
    expect(
      commitmentPeriodSupply({
        quantity: 2,
        window: window('2026-11-01', '2026-11-30'),
      }),
    ).toBe(60);
    expect(
      commitmentPeriodSupply({
        quantity: 7,
        window: window('2026-11-01', '2026-11-30'),
      }),
    ).toBe(210);
    expect(
      commitmentPeriodSupply({
        quantity: 5,
        window: window('2026-11-02', '2026-11-08', '09:00', '13:00', ['MONDAY']),
      }),
    ).toBe(5);
  });

  it('treats missing claimedPeriodQuantity as zero', () => {
    expect(claimedPeriodQuantityOf({})).toBe(0);
    expect(claimedPeriodQuantityOf({ claimedPeriodQuantity: 12 })).toBe(12);
  });

  it('treats absent consumesDailySlots as legacy daily debit', () => {
    expect(planReservationConsumesDailySlots({})).toBe(true);
    expect(planReservationConsumesDailySlots({ consumesDailySlots: true })).toBe(true);
    expect(planReservationConsumesDailySlots({ consumesDailySlots: false })).toBe(false);
  });

  it('checks civil date and daily clock for visit alignment', () => {
    const w = window('2026-11-01', '2026-11-30', '09:00', '13:00', ['SUNDAY']);
    expect(windowServesDate(w, '2026-11-01')).toBe(true); // Sunday
    expect(windowServesDate(w, '2026-11-02')).toBe(false); // Monday
    expect(visitFitsDailyWindow(w.dailyWindow, '09:00', '09:30')).toBe(true);
    expect(visitFitsDailyWindow(w.dailyWindow, '12:30', '13:00')).toBe(true);
    expect(visitFitsDailyWindow(w.dailyWindow, '12:30', '13:30')).toBe(false);
    expect(visitFitsDailyWindow(w.dailyWindow, '08:30', '09:00')).toBe(false);
  });
});

describe('package scope offeringId', () => {
  it('normalizes write scope to offeringId + label only', () => {
    expect(
      packageScopeForWrite({
        offeringId: 'pkg_car_wash',
        serviceScopeCode: 'service:CAR_WASH',
        label: 'Car wash',
      }),
    ).toEqual({ offeringId: 'pkg_car_wash', label: 'Car wash' });
  });

  it('rejects write scope that only has legacy serviceScopeCode', () => {
    expect(() =>
      packageScopeForWrite({ serviceScopeCode: 'service:CAR_WASH', label: 'Car wash' }),
    ).toThrow(ValidationError);
  });

  it('treats missing offeringId as ineligible for offering-scoped capacity', () => {
    expect(packageScopeOfferingId({ offeringId: '  ' })).toBeUndefined();
    expect(
      hasOfferingScopedCapacity({ serviceScopeCode: 'service:CAR_WASH', label: 'Car wash' }),
    ).toBe(false);
    expect(hasOfferingScopedCapacity({ offeringId: 'pkg_1' })).toBe(true);
  });
});
