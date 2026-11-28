import { ConflictError, ValidationError } from '@api-hub/utils';

import {
  CAPACITY_BUSINESS_TIMEZONE,
  CommittedLoad,
  ServiceWindow,
  assertCapacityAvailable,
  capacityExceededMessage,
  claimedPeriodQuantityOf,
  commitmentCoversPreferredDays,
  commitmentIdForProposal,
  commitmentPeriodSupply,
  crewShortageForCapacity,
  dailyCapacity,
  dailyWindowsOverlap,
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
  /** 3 ACTIVE crews × 4 visits/crew/day = 12 daily capacity. */
  const threeCrews = { activeCrewCount: 3, maxVisitsPerCrewPerDay: 4 };

  it('sums overlapping commitments per day, across communities', () => {
    const commitments = [
      load(window('2026-11-01', '2026-11-04'), 5),
      load(window('2026-11-03', '2026-11-10'), 4),
    ];
    // Peak is Nov 3-4 with 9 committed.
    expect(peakCommittedQuantity(commitments, target).peak).toBe(9);
    expect(() =>
      assertCapacityAvailable({ commitments, window: target, quantity: 3, ...threeCrews }),
    ).not.toThrow();
    expect(() =>
      assertCapacityAvailable({ commitments, window: target, quantity: 4, ...threeCrews }),
    ).toThrow(ConflictError);
  });

  it('ignores non-overlapping windows and CANCELLED commitments', () => {
    const commitments = [
      load(window('2026-12-01', '2026-12-31'), 12),
      load(window('2026-11-02', '2026-11-08', '14:00', '18:00'), 12),
      load(target, 12, 'CANCELLED'),
    ];
    expect(() =>
      assertCapacityAvailable({ commitments, window: target, quantity: 12, ...threeCrews }),
    ).not.toThrow();
  });

  it('keeps counting CHANGE_PENDING and REDUCED commitments', () => {
    const commitments = [load(target, 6, 'CHANGE_PENDING'), load(target, 4, 'REDUCED')];
    expect(() =>
      assertCapacityAvailable({ commitments, window: target, quantity: 3, ...threeCrews }),
    ).toThrow(ConflictError);
  });

  it('rejects everything when the vendor has no crew capacity', () => {
    expect(() =>
      assertCapacityAvailable({
        commitments: [],
        window: target,
        quantity: 1,
        activeCrewCount: 0,
        maxVisitsPerCrewPerDay: 4,
      }),
    ).toThrow(ConflictError);
  });

  it('reports how many additional ACTIVE crews are needed (20 visits, 1 crew, limit 4)', () => {
    expect(crewShortageForCapacity({
      peakCommittedQuantity: 0,
      requestedQuantity: 20,
      activeCrewCount: 1,
      maxVisitsPerCrewPerDay: 4,
    })).toEqual({
      requiredCrewCount: 5,
      additionalCrewCount: 4,
      capacityPerDay: 4,
    });

    try {
      assertCapacityAvailable({
        commitments: [],
        window: target,
        quantity: 20,
        activeCrewCount: 1,
        maxVisitsPerCrewPerDay: 4,
      });
      throw new Error('expected ConflictError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      const conflict = error as ConflictError;
      expect(conflict.message).toBe(
        'You need 4 more active crews to accept this proposal. You have 1 active crew; 5 are required for 20 visits per service day.',
      );
      expect(conflict.details?.[0]).toMatchObject({
        code: 'CAPACITY_EXCEEDED',
        field: 'quantity',
        activeCrewCount: 1,
        requiredCrewCount: 5,
        additionalCrewCount: 4,
        maxVisitsPerCrewPerDay: 4,
        peakCommittedQuantity: 0,
        requestedQuantity: 20,
        capacityPerDay: 4,
      });
    }
  });

  it('includes existing committed visits in the shortage explanation', () => {
    const commitments = [load(target, 4)];
    try {
      assertCapacityAvailable({
        commitments,
        window: target,
        quantity: 8,
        activeCrewCount: 1,
        maxVisitsPerCrewPerDay: 4,
      });
      throw new Error('expected ConflictError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      const conflict = error as ConflictError;
      expect(conflict.message).toBe(
        'You need 2 more active crews to accept this proposal. You have 1 active crew; 3 are required for 8 requested visits plus 4 already committed visits on the busiest overlapping day.',
      );
      expect(conflict.details?.[0]).toMatchObject({
        code: 'CAPACITY_EXCEEDED',
        additionalCrewCount: 2,
        requiredCrewCount: 3,
        peakCommittedQuantity: 4,
        requestedQuantity: 8,
      });
    }
  });

  it('uses singular wording when one additional crew is needed', () => {
    expect(
      capacityExceededMessage({
        additionalCrewCount: 1,
        activeCrewCount: 1,
        requiredCrewCount: 2,
        requestedQuantity: 1,
        peakCommittedQuantity: 0,
      }),
    ).toBe(
      'You need 1 more active crew to accept this proposal. You have 1 active crew; 2 are required for 1 visit per service day.',
    );
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

  /** Verification #1: 20 slots/day × 10 weekend days = 200 (May 2026 has 10 Sat/Sun). */
  it('1: weekend commitment period supply is quantity × eligible Sat/Sun days', () => {
    const weekendMay = window('2026-05-01', '2026-05-31', '09:00', '13:00', ['SATURDAY', 'SUNDAY']);
    expect(expandWindowDates(weekendMay)).toHaveLength(10);
    expect(commitmentPeriodSupply({ quantity: 20, window: weekendMay })).toBe(200);
    expect(CAPACITY_BUSINESS_TIMEZONE).toBe('Asia/Kolkata');
  });

  /** Verification #5 + #12: inclusive bounds; civil YYYY-MM-DD weekday is timezone-stable. */
  it('5/12: inclusive start/end and civil-date weekdays (Asia/Kolkata product TZ)', () => {
    const weekend = window('2026-05-02', '2026-05-03', '09:00', '13:00', ['SATURDAY', 'SUNDAY']);
    expect(expandWindowDates(weekend)).toEqual(['2026-05-02', '2026-05-03']);
    expect(windowServesDate(weekend, '2026-05-01')).toBe(false); // before start (Fri)
    expect(windowServesDate(weekend, '2026-05-02')).toBe(true); // start (Sat)
    expect(windowServesDate(weekend, '2026-05-03')).toBe(true); // end (Sun)
    expect(windowServesDate(weekend, '2026-05-04')).toBe(false); // after end (Mon)
    // Civil Saturday must not flip when product ops are in IST.
    expect(windowServesDate(weekend, '2026-05-02')).toBe(true);
  });

  it('matches preferred days and daily clock overlap for period selection', () => {
    expect(
      commitmentCoversPreferredDays(
        { daysOfWeek: ['SATURDAY', 'SUNDAY'] },
        ['SATURDAY'],
      ),
    ).toBe(true);
    expect(
      commitmentCoversPreferredDays(
        { daysOfWeek: ['SATURDAY', 'SUNDAY'] },
        ['MONDAY'],
      ),
    ).toBe(false);
    expect(commitmentCoversPreferredDays({ daysOfWeek: ['MONDAY'] }, undefined)).toBe(true);
    expect(commitmentCoversPreferredDays({}, ['MONDAY'])).toBe(true);
    expect(
      dailyWindowsOverlap(
        { startTime: '09:00', endTime: '13:00' },
        { startTime: '09:00', endTime: '12:00' },
      ),
    ).toBe(true);
    expect(
      dailyWindowsOverlap(
        { startTime: '14:00', endTime: '18:00' },
        { startTime: '09:00', endTime: '12:00' },
      ),
    ).toBe(false);
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
