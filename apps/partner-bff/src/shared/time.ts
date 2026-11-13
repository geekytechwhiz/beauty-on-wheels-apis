import { ValidationError } from '@api-hub/utils';

export const OPERATIONS_TIMEZONE = 'Asia/Kolkata';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function todayInOperationsTimeZone(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: OPERATIONS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  if (!year || !month || !day) throw new ValidationError('Operational date could not be resolved');
  return `${year}-${month}-${day}`;
}

export function requireDate(value: string | undefined, field: string): string {
  const trimmed = value?.trim() ?? '';
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (!ISO_DATE.test(trimmed) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new ValidationError(`${field} must be YYYY-MM-DD`);
  }
  return trimmed;
}

/** Keeps a UI read bounded without assuming a domain date is "today" in UTC. */
export function requireManagerDate(value: string | undefined, field: string, now: Date): string {
  const date = requireDate(value, field);
  const today = todayInOperationsTimeZone(now);
  if (date < addDays(today, -365) || date > addDays(today, 365)) {
    throw new ValidationError(`${field} must be within 365 days of the operations date`);
  }
  return date;
}

export function addDays(date: string, count: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + count));
  return result.toISOString().slice(0, 10);
}

/** Signed minutes from `asOf` to `date`T`time` on the Asia/Kolkata calendar; null for a malformed HH:mm. */
export function minutesUntil(date: string, time: string | undefined, asOf: Date): number | null {
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const at = new Date(`${date}T${time}:00+05:30`);
  if (Number.isNaN(at.getTime())) return null;
  return Math.ceil((at.getTime() - asOf.getTime()) / 60_000);
}

/** The current domain calendar is Asia/Kolkata; a past window never has positive remaining time. */
export function remainingWindowMinutes(date: string, endTime: string | undefined, asOf: Date): number | null {
  const minutes = minutesUntil(date, endTime, asOf);
  return minutes === null ? null : Math.max(0, minutes);
}
