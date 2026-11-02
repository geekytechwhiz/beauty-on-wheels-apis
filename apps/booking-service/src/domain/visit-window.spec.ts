import { CustomerPlanRecord } from '../types/customer-plan.types';
import { PackageVisitRecord } from '../types/package-visit.types';
import { enrichVisitFromPlan } from './package-visit';
import { authoritativeWindowClock, describeWindowClock, mergeWindowSnapshot, windowElapsed } from './visit-window';

const plan = {
  planId: 'plan-1',
  vendorId: 'vendor-1',
  visitWindowId: 'night',
  visitWindow: { visitWindowId: 'night', label: 'Night' },
  location: { fulfilmentType: 'community', communityId: 'community-1' },
} as CustomerPlanRecord;

const visit = {
  visitId: 'visit-1',
  planId: 'plan-1',
  vendorId: 'vendor-1',
  visitWindowId: 'night',
  visitWindowName: 'Night',
} as PackageVisitRecord;

describe('visit window snapshots', () => {
  it('does not invent a clock from a display label', () => {
    expect(authoritativeWindowClock('night', { visitWindowId: 'night', label: 'Night' })).toBeUndefined();
    const enriched = enrichVisitFromPlan(visit, plan);
    expect(enriched.visitWindowSnapshot).toBeUndefined();
    expect(describeWindowClock(enriched.visitWindowSnapshot).windowTimeKnown).toBe(false);
  });

  it('copies stored bounds, including a window that crosses midnight', () => {
    const clock = authoritativeWindowClock('night', {
      visitWindowId: 'night',
      label: 'Night',
      startTime: '22:00',
      endTime: '02:00',
      timezone: 'Asia/Kolkata',
    });
    expect(clock).toEqual({
      visitWindowId: 'night',
      startTime: '22:00',
      endTime: '02:00',
      timezone: 'Asia/Kolkata',
    });
    expect(describeWindowClock(clock)).toMatchObject({
      windowTimeKnown: true,
      crossesMidnight: true,
      windowStart: '22:00',
      windowEnd: '02:00',
    });
  });

  it('fills a missing clock from the parent plan and keeps a clock already stored on the visit', () => {
    const fromPlan = authoritativeWindowClock('night', {
      visitWindowId: 'night',
      label: 'Night',
      startTime: '20:00',
      endTime: '23:00',
      timezone: 'Asia/Kolkata',
    });
    const enriched = enrichVisitFromPlan(visit, {
      ...plan,
      visitWindow: {
        visitWindowId: 'night',
        label: 'Night',
        startTime: '20:00',
        endTime: '23:00',
        timezone: 'Asia/Kolkata',
      },
    });
    expect(enriched.visitWindowSnapshot).toEqual(fromPlan);
    expect(mergeWindowSnapshot(
      { visitWindowId: 'night', startTime: '21:00', endTime: '23:30', timezone: 'Asia/Kolkata' },
      fromPlan,
    )).toEqual({ visitWindowId: 'night', startTime: '21:00', endTime: '23:30', timezone: 'Asia/Kolkata' });
  });

  it('keeps an all-day flag without inventing clock times', () => {
    const clock = authoritativeWindowClock('day', {
      visitWindowId: 'day',
      label: 'All day',
      allDay: true,
      timezone: 'Asia/Kolkata',
    });
    expect(describeWindowClock(clock)).toEqual({
      windowTimeKnown: true,
      allDay: true,
      crossesMidnight: false,
      windowTimezone: 'Asia/Kolkata',
    });
  });

  it('marks a stored window elapsed only from the supplied instant', () => {
    const snapshot = {
      visitWindowId: 'morning',
      startTime: '09:00',
      endTime: '10:00',
      timezone: 'Asia/Kolkata',
    };
    expect(windowElapsed({
      now: new Date('2026-01-10T04:29:00.000Z'),
      scheduledDate: '2026-01-10',
      snapshot,
    })).toBe('open');
    expect(windowElapsed({
      now: new Date('2026-01-10T04:30:00.000Z'),
      scheduledDate: '2026-01-10',
      snapshot,
    })).toBe('elapsed');
    expect(windowElapsed({
      now: new Date('2026-01-10T18:00:00.000Z'),
      scheduledDate: '2026-01-10',
      snapshot: { visitWindowId: 'morning' },
    })).toBe('unknown');
  });
});
