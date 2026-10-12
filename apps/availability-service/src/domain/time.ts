import { DayOfWeek, MAX_RANGE_DAYS } from './constants';

const WEEKDAY_BY_UTC: DayOfWeek[] = [
  'SUN',
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
];

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export function assertTimeZone(timeZone: string): void {
  Intl.DateTimeFormat('en-US', { timeZone });
}

export function isValidDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

export function isValidTime(value: string): boolean {
  const match = TIME_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function weekdayOfCivilDate(date: string): DayOfWeek {
  const [year, month, day] = date.split('-').map(Number);
  return WEEKDAY_BY_UTC[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function addCivilDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return utc.toISOString().slice(0, 10);
}

export function civilDatesInclusive(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  let cursor = fromDate;
  while (cursor <= toDate) {
    dates.push(cursor);
    if (dates.length > MAX_RANGE_DAYS) {
      break;
    }
    cursor = addCivilDays(cursor, 1);
  }
  return dates;
}

export function addMinutes(time: string, minutes: number): string {
  const [hour, minute] = time.split(':').map(Number);
  const total = hour * 60 + minute + minutes;
  const nextHour = Math.floor(total / 60);
  const nextMinute = total % 60;
  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`;
}

export function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export interface ZonedClock {
  date: string;
  time: string;
}

export function zonedClock(timeZone: string, instant: Date): ZonedClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';

  let hour = read('hour');
  if (hour === '24') {
    hour = '00';
  }

  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    time: `${hour}:${read('minute')}`,
  };
}

export function isSlotStartInPast(
  date: string,
  startTime: string,
  timeZone: string,
  instant: Date,
): boolean {
  const clock = zonedClock(timeZone, instant);
  if (date < clock.date) {
    return true;
  }
  if (date > clock.date) {
    return false;
  }
  return startTime <= clock.time;
}

export function expiryHourBucket(expiresAtIso: string): string {
  return expiresAtIso.slice(0, 13);
}

export function hourBucketsEndingAt(instant: Date, hours: number): string[] {
  const start = new Date(instant);
  start.setUTCMinutes(0, 0, 0);
  const buckets: string[] = [];
  for (let offset = 0; offset < hours; offset += 1) {
    const cursor = new Date(start.getTime() - offset * 60 * 60 * 1000);
    buckets.push(cursor.toISOString().slice(0, 13));
  }
  return buckets;
}

export function buildSlotWindows(
  openTime: string,
  closeTime: string,
  durationMinutes: number,
): Array<{ startTime: string; endTime: string }> {
  const windows: Array<{ startTime: string; endTime: string }> = [];
  let startTime = openTime;
  while (timeToMinutes(startTime) + durationMinutes <= timeToMinutes(closeTime)) {
    const endTime = addMinutes(startTime, durationMinutes);
    windows.push({ startTime, endTime });
    startTime = endTime;
  }
  return windows;
}
