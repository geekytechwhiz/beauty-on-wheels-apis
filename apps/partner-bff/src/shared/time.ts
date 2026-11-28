import { ValidationError } from '@api-hub/utils';

/**
 * Documented safe default when no schedule timezone is stored for the vendor.
 * Prefer the timezone returned by Booking (`overview`/`work`/`planning`) for
 * day boundaries and window clocks; only fall back here for local defaults.
 */
export const OPERATIONS_TIMEZONE = 'Asia/Kolkata';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function assertIanaTimeZone(value: string, field = 'timezone'): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(`${field} is required`);
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed }).format(new Date());
  } catch {
    throw new ValidationError(`${field} must be an IANA timezone`);
  }
  return trimmed;
}

/** Civil YYYY-MM-DD for `now` in the given IANA zone. */
export function todayInTimeZone(now: Date, timeZone: string): string {
  const zone = assertIanaTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  if (!year || !month || !day) {
    throw new ValidationError('Operational date could not be resolved');
  }
  return `${year}-${month}-${day}`;
}

/** @deprecated Prefer {@link todayInTimeZone} with the vendor's resolved zone. */
export function todayInOperationsTimeZone(now: Date): string {
  return todayInTimeZone(now, OPERATIONS_TIMEZONE);
}

export function requireDate(value: string | undefined, field: string): string {
  const trimmed = value?.trim() ?? '';
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (
    !ISO_DATE.test(trimmed) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== trimmed
  ) {
    throw new ValidationError(`${field} must be YYYY-MM-DD`);
  }
  return trimmed;
}

/** Keeps a UI read bounded without assuming a domain date is "today" in UTC. */
export function requireManagerDate(
  value: string | undefined,
  field: string,
  now: Date,
  timeZone: string = OPERATIONS_TIMEZONE,
): string {
  const date = requireDate(value, field);
  const today = todayInTimeZone(now, timeZone);
  if (date < addDays(today, -365) || date > addDays(today, 365)) {
    throw new ValidationError(
      `${field} must be within 365 days of the operations date`,
    );
  }
  return date;
}

export function addDays(date: string, count: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + count));
  return result.toISOString().slice(0, 10);
}

/** Local clock (date + minutes since midnight) for `asOf` in `timeZone`. */
export function zonedClock(
  asOf: Date,
  timeZone: string,
): { date: string; minutes: number } {
  const zone = assertIanaTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(asOf);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  let hour = Number(pick('hour'));
  const minute = Number(pick('minute'));
  let date = `${pick('year')}-${pick('month')}-${pick('day')}`;
  if (hour === 24) {
    hour = 0;
    date = addDays(date, 1);
  }
  return { date, minutes: hour * 60 + minute };
}

/**
 * Signed minutes from `asOf` to `date`T`time` on the vendor operations calendar.
 * Null for a malformed HH:mm. Does not hardcode a UTC offset.
 */
export function minutesUntil(
  date: string,
  time: string | undefined,
  asOf: Date,
  timeZone: string = OPERATIONS_TIMEZONE,
): number | null {
  if (!time || !TIME_PATTERN.test(time)) return null;
  const [hour, minute] = time.split(':').map(Number);
  const targetMinutes = hour * 60 + minute;
  const now = zonedClock(asOf, timeZone);
  const dayDelta =
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${now.date}T00:00:00Z`)) /
    86_400_000;
  if (!Number.isFinite(dayDelta)) return null;
  return Math.ceil(dayDelta * 1_440 + (targetMinutes - now.minutes));
}

/** A past window never has positive remaining time. */
export function remainingWindowMinutes(
  date: string,
  endTime: string | undefined,
  asOf: Date,
  timeZone: string = OPERATIONS_TIMEZONE,
): number | null {
  const minutes = minutesUntil(date, endTime, asOf, timeZone);
  return minutes === null ? null : Math.max(0, minutes);
}
