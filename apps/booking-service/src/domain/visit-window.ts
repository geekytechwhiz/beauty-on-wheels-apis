import { PlanVisitWindow } from '../types/customer-plan.types';
import { PackageVisitWindowSnapshot } from '../types/package-visit.types';
import { OPERATIONS_TIMEZONE, addCalendarDays } from './vendor-package-visits';

const CLOCK_PATTERN = /^(\d{2}):(\d{2})$/;

/** Minutes from midnight. `24:00` is accepted only as an end-of-day clock that was stored, not invented. */
export function clockMinutes(value: string | undefined, allowEndOfDay = false): number | undefined {
  if (!value) return undefined;
  const match = CLOCK_PATTERN.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes > 59) return undefined;
  if (hours === 24 && minutes === 0 && allowEndOfDay) return 24 * 60;
  if (hours > 23) return undefined;
  return hours * 60 + minutes;
}

function storedClock(value: string | undefined, allowEndOfDay = false): string | undefined {
  const minutes = clockMinutes(value, allowEndOfDay);
  if (minutes === undefined || !value) return undefined;
  return value.trim();
}

/**
 * Copies a visit-window clock only when the plan stored one.
 * A label alone is not a time. Equal start and end are not a range.
 * An end earlier than the start is an overnight window, not missing data.
 */
export function authoritativeWindowClock(
  visitWindowId: string | undefined,
  window: PlanVisitWindow | undefined,
): PackageVisitWindowSnapshot | undefined {
  if (!window?.visitWindowId?.trim()) return undefined;
  if (visitWindowId && window.visitWindowId !== visitWindowId) return undefined;
  const timezone = window.timezone?.trim();
  if (window.allDay === true) {
    return {
      visitWindowId: window.visitWindowId,
      allDay: true,
      ...(timezone ? { timezone } : {}),
    };
  }
  const startTime = storedClock(window.startTime);
  const endTime = storedClock(window.endTime, true);
  if (!startTime || !endTime) return undefined;
  const start = clockMinutes(startTime);
  const end = clockMinutes(endTime, true);
  if (start === undefined || end === undefined || start === end) return undefined;
  return {
    visitWindowId: window.visitWindowId,
    startTime,
    endTime,
    ...(timezone ? { timezone } : {}),
  };
}

/** Keeps a stored clock. Fills only missing fields from the parent plan. */
export function mergeWindowSnapshot(
  existing: PackageVisitWindowSnapshot | undefined,
  fromPlan: PackageVisitWindowSnapshot | undefined,
): PackageVisitWindowSnapshot | undefined {
  if (!existing) return fromPlan;
  if (!fromPlan || existing.visitWindowId !== fromPlan.visitWindowId) return existing;
  if (existing.allDay) return existing;
  if (existing.startTime && existing.endTime) return existing;
  if (fromPlan.allDay) {
    return {
      visitWindowId: existing.visitWindowId,
      allDay: true,
      ...(existing.timezone || fromPlan.timezone
        ? { timezone: existing.timezone ?? fromPlan.timezone }
        : {}),
    };
  }
  const startTime = existing.startTime ?? fromPlan.startTime;
  const endTime = existing.endTime ?? fromPlan.endTime;
  if (!startTime || !endTime) return existing;
  return {
    visitWindowId: existing.visitWindowId,
    startTime,
    endTime,
    ...(existing.timezone || fromPlan.timezone
      ? { timezone: existing.timezone ?? fromPlan.timezone }
      : {}),
  };
}

export interface WindowClockView {
  windowTimeKnown: boolean;
  allDay: boolean;
  crossesMidnight: boolean;
  windowStart?: string;
  windowEnd?: string;
  windowTimezone?: string;
}

/** Describes a stored clock without comparing HH:mm strings. */
export function describeWindowClock(snapshot: PackageVisitWindowSnapshot | undefined): WindowClockView {
  if (!snapshot) {
    return { windowTimeKnown: false, allDay: false, crossesMidnight: false };
  }
  const windowTimezone = snapshot.timezone;
  if (snapshot.allDay === true) {
    return {
      windowTimeKnown: true,
      allDay: true,
      crossesMidnight: false,
      ...(windowTimezone ? { windowTimezone } : {}),
    };
  }
  const start = clockMinutes(snapshot.startTime);
  const end = clockMinutes(snapshot.endTime, true);
  if (start === undefined || end === undefined || start === end || !snapshot.startTime || !snapshot.endTime) {
    return {
      windowTimeKnown: false,
      allDay: false,
      crossesMidnight: false,
      ...(windowTimezone ? { windowTimezone } : {}),
    };
  }
  return {
    windowTimeKnown: true,
    allDay: false,
    crossesMidnight: end < start,
    windowStart: snapshot.startTime,
    windowEnd: snapshot.endTime,
    ...(windowTimezone ? { windowTimezone } : {}),
  };
}

export type WindowElapsed = 'elapsed' | 'open' | 'unknown';

/**
 * Compares the server clock with the stored visit-window end.
 * A missing clock stays unknown. The caller must not substitute a client timestamp.
 */
export function windowElapsed(input: {
  now: Date;
  scheduledDate: string | undefined;
  snapshot: PackageVisitWindowSnapshot | undefined;
}): WindowElapsed {
  const scheduledDate = input.scheduledDate?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return 'unknown';
  const described = describeWindowClock(input.snapshot);
  if (!described.windowTimeKnown) return 'unknown';
  const zoned = zonedClock(input.now, input.snapshot?.timezone);
  if (described.allDay) return zoned.date > scheduledDate ? 'elapsed' : 'open';
  const end = clockMinutes(input.snapshot?.endTime, true);
  if (end === undefined) return 'unknown';
  if (!described.crossesMidnight) {
    if (zoned.date > scheduledDate) return 'elapsed';
    if (zoned.date < scheduledDate) return 'open';
    return zoned.minutes >= end ? 'elapsed' : 'open';
  }
  const nextDate = addCalendarDays(scheduledDate, 1);
  if (zoned.date > nextDate) return 'elapsed';
  if (zoned.date < nextDate) return 'open';
  return zoned.minutes >= end ? 'elapsed' : 'open';
}

function zonedClock(now: Date, timeZone: string | undefined): { date: string; minutes: number } {
  let zone = timeZone?.trim() || OPERATIONS_TIMEZONE;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: zone }).format(now);
  } catch {
    zone = OPERATIONS_TIMEZONE;
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  let hour = Number(pick('hour'));
  const minute = Number(pick('minute'));
  let date = `${pick('year')}-${pick('month')}-${pick('day')}`;
  if (hour === 24) {
    hour = 0;
    date = addCalendarDays(date, 1);
  }
  return { date, minutes: hour * 60 + minute };
}
