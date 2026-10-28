import { createHash } from 'crypto';
import { ValidationError } from '@api-hub/utils';

import { addCivilDays, isValidDate, isValidTime, zonedClock } from './time';

/** Monday is 0, matching the partner visit planner. Sunday is 6. */
export const VISIT_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type VisitWeekday = (typeof VISIT_WEEKDAYS)[number];

export const VISIT_HORIZON_DAYS = 28;
export const MIN_VISIT_CAPACITY = 1;
export const MAX_VISIT_CAPACITY = 100;
export const MAX_BOOKING_CUTOFF_MINUTES = 7 * 24 * 60;
export const SHARED_CREW_ID = 'shared';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface VisitWindowInput {
  days: number[];
  startTime: string;
  endTime: string;
  effectiveDate: string;
  timezone: string;
  oneOff: boolean;
  crewId?: string;
}

export interface DatedVisitWindow {
  date: string;
  startAt: string;
  endAt: string;
  overnight: boolean;
}

export function visitIdFor(scheduleId: string, date: string): string {
  const digest = createHash('sha256').update(`${scheduleId}|${date}`).digest('hex').slice(0, 24);
  return `vst_${digest}`;
}

export function recurringScheduleId(communityId: string): string {
  return stableToken('cvr', communityId);
}

export function oneOffScheduleId(idempotencyKey: string): string {
  return stableToken('cvo', idempotencyKey);
}

export function crewKey(crewId?: string): string {
  const value = crewId?.trim();
  return value || SHARED_CREW_ID;
}

export function weekdayIndex(date: string): VisitWeekday {
  const [year, month, day] = date.split('-').map(Number);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return ((utcDay + 6) % 7) as VisitWeekday;
}

export function weekdayLabel(day: VisitWeekday): string {
  return WEEKDAY_LABELS[day];
}

export function todayInTimeZone(timeZone: string, now: Date): string {
  return zonedClock(timeZone, now).date;
}

export function durationMinutes(startTime: string, endTime: string): number {
  const start = minutes(startTime);
  const end = minutes(endTime);
  if (end === start) {
    throw new ValidationError('Start and finish times must be different');
  }
  return end > start ? end - start : end + 1440 - start;
}

export function isOvernight(startTime: string, endTime: string): boolean {
  return minutes(endTime) < minutes(startTime);
}

/** UTC instant for a civil date and clock time in an IANA timezone. */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  assertTimeZone(timeZone);
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const clock = zonedClock(timeZone, new Date(utc));
    const [gotYear, gotMonth, gotDay] = clock.date.split('-').map(Number);
    const [gotHour, gotMinute] = clock.time.split(':').map(Number);
    const delta = Date.UTC(year, month - 1, day, hour, minute) - Date.UTC(gotYear, gotMonth - 1, gotDay, gotHour, gotMinute);
    if (delta === 0) {
      return new Date(utc);
    }
    utc += delta;
  }
  const resolved = zonedClock(timeZone, new Date(utc));
  if (resolved.date !== date || resolved.time !== time) {
    throw new ValidationError('The visit time does not exist in this timezone');
  }
  return new Date(utc);
}

export function datedWindow(date: string, startTime: string, endTime: string, timeZone: string): DatedVisitWindow {
  if (!isValidDate(date) || !isValidTime(startTime) || !isValidTime(endTime)) {
    throw new ValidationError('Visit date and times must be valid');
  }
  durationMinutes(startTime, endTime);
  const overnight = isOvernight(startTime, endTime);
  const endDate = overnight ? addCivilDays(date, 1) : date;
  const startAt = zonedInstant(date, startTime, timeZone);
  const endAt = zonedInstant(endDate, endTime, timeZone);
  if (endAt.getTime() <= startAt.getTime()) {
    throw new ValidationError('The visit finish must be after it starts');
  }
  return { date, startAt: startAt.toISOString(), endAt: endAt.toISOString(), overnight };
}

export function occurrenceDates(input: VisitWindowInput, fromDate: string, throughDate: string): string[] {
  const dates: string[] = [];
  let cursor = fromDate < input.effectiveDate ? input.effectiveDate : fromDate;
  while (cursor <= throughDate && dates.length <= VISIT_HORIZON_DAYS + 1) {
    if (input.oneOff) {
      if (cursor === input.effectiveDate) dates.push(cursor);
      break;
    }
    if (input.days.includes(weekdayIndex(cursor))) dates.push(cursor);
    cursor = addCivilDays(cursor, 1);
  }
  return dates;
}

interface MinuteSpan { start: number; end: number }

export function weeklySpans(input: Pick<VisitWindowInput, 'days' | 'startTime' | 'endTime' | 'oneOff'>): MinuteSpan[] {
  if (input.oneOff) return [];
  const length = durationMinutes(input.startTime, input.endTime);
  return input.days.map((day) => {
    const start = day * 1440 + minutes(input.startTime);
    return { start, end: start + length };
  });
}

function spansOverlap(left: MinuteSpan, right: MinuteSpan): boolean {
  return left.start < right.end && right.start < left.end;
}

export function recurringSchedulesOverlap(left: VisitWindowInput, right: VisitWindowInput): boolean {
  if (crewKey(left.crewId) !== crewKey(right.crewId)) return false;
  if (left.oneOff || right.oneOff) return false;
  const rightSpans = weeklySpans(right);
  return weeklySpans(left).some((span) => rightSpans.some((other) => (
    [-10080, 0, 10080].some((shift) => spansOverlap(span, { start: other.start + shift, end: other.end + shift }))
  )));
}

export function concreteSpans(input: VisitWindowInput, aroundDate: string): Array<{ start: number; end: number }> {
  if (input.oneOff) {
    const window = datedWindow(input.effectiveDate, input.startTime, input.endTime, input.timezone);
    return [{ start: Date.parse(window.startAt), end: Date.parse(window.endAt) }];
  }
  const spans: Array<{ start: number; end: number }> = [];
  for (let offset = -1; offset <= 1; offset += 1) {
    const date = addCivilDays(aroundDate, offset);
    if (date < input.effectiveDate || !input.days.includes(weekdayIndex(date))) continue;
    const window = datedWindow(date, input.startTime, input.endTime, input.timezone);
    spans.push({ start: Date.parse(window.startAt), end: Date.parse(window.endAt) });
  }
  return spans;
}

export function schedulesOverlap(left: VisitWindowInput, right: VisitWindowInput): boolean {
  if (crewKey(left.crewId) !== crewKey(right.crewId)) return false;
  if (!left.oneOff && !right.oneOff) return recurringSchedulesOverlap(left, right);
  const single = left.oneOff ? left : right;
  const other = left.oneOff ? right : left;
  const singleSpans = concreteSpans(single, single.effectiveDate);
  const otherSpans = concreteSpans(other, single.effectiveDate);
  return singleSpans.some((span) => otherSpans.some((candidate) => spansOverlap(span, candidate)));
}

export type BookableBlock = 'cancelled' | 'past' | 'cutoff' | 'capacity' | 'coverage' | 'inactive';

export function bookableBlock(input: {
  status: 'scheduled' | 'cancelled';
  startAt: string;
  endAt: string;
  bookingCutoffMinutes: number;
  capacity: number;
  bookedCount: number;
  heldCount: number;
  units?: number;
  covered: boolean;
  vendorActive: boolean;
  now: Date;
}): BookableBlock | null {
  if (!input.vendorActive) return 'inactive';
  if (!input.covered) return 'coverage';
  if (input.status !== 'scheduled') return 'cancelled';
  const now = input.now.getTime();
  if (Date.parse(input.endAt) <= now) return 'past';
  const cutoffAt = Date.parse(input.startAt) - input.bookingCutoffMinutes * 60_000;
  if (now >= cutoffAt) return 'cutoff';
  const units = input.units ?? 1;
  if (input.bookedCount + input.heldCount + units > input.capacity) return 'capacity';
  return null;
}

export function assertVisitDraft(input: {
  days: number[];
  startTime: string;
  endTime: string;
  effectiveDate: string;
  timezone: string;
  capacity: number;
  bookingCutoffMinutes: number;
  oneOff: boolean;
  now?: Date;
}): void {
  assertTimeZone(input.timezone);
  if (!isValidDate(input.effectiveDate)) throw new ValidationError('Enter a valid schedule date');
  if (!isValidTime(input.startTime) || !isValidTime(input.endTime)) throw new ValidationError('Enter a valid start and finish time');
  durationMinutes(input.startTime, input.endTime);
  datedWindow(input.effectiveDate, input.startTime, input.endTime, input.timezone);
  if (!input.oneOff && input.days.length === 0) throw new ValidationError('Select at least one visit day');
  if (!input.oneOff && input.days.some((day) => !VISIT_WEEKDAYS.includes(day as VisitWeekday))) {
    throw new ValidationError('Visit days must be Monday through Sunday');
  }
  if (!Number.isInteger(input.capacity) || input.capacity < MIN_VISIT_CAPACITY || input.capacity > MAX_VISIT_CAPACITY) {
    throw new ValidationError('Capacity must be a whole number from 1 to 100');
  }
  if (!Number.isInteger(input.bookingCutoffMinutes) || input.bookingCutoffMinutes < 0 || input.bookingCutoffMinutes > MAX_BOOKING_CUTOFF_MINUTES) {
    throw new ValidationError('Booking cutoff must be a whole number of minutes up to 7 days');
  }
  const today = todayInTimeZone(input.timezone, input.now ?? new Date());
  if (input.effectiveDate < today) throw new ValidationError('Choose a start date on or after today');
}

function minutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function assertTimeZone(timeZone: string): void {
  try {
    Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new ValidationError('timezone must be an IANA timezone');
  }
}

function stableToken(prefix: string, value: string): string {
  const cleaned = value.trim();
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/.test(cleaned)) return `${prefix}_${cleaned}`.slice(0, 80);
  const digest = createHash('sha256').update(cleaned).digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}
