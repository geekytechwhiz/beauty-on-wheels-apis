import { ValidationError } from '@api-hub/utils';

export type DayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';
export type TimeWindow = { startTime: string; endTime: string };
export type WeeklySchedule = Array<{ dayOfWeek: DayOfWeek; windows: TimeWindow[] }>;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutes(value: string) { const [hours, minutesPart] = value.split(':').map(Number); return hours * 60 + minutesPart; }

/** Validates configuration only; Availability owns date exceptions and slots. */
export function validateWeeklySchedule(schedule: WeeklySchedule): WeeklySchedule {
  const days = new Set<DayOfWeek>();
  for (const day of schedule) {
    if (days.has(day.dayOfWeek)) throw new ValidationError(`Duplicate schedule for ${day.dayOfWeek}`);
    days.add(day.dayOfWeek);
    const intervals = day.windows.map((window) => {
      if (!TIME.test(window.startTime) || !TIME.test(window.endTime) || window.startTime === window.endTime) throw new ValidationError(`Invalid window for ${day.dayOfWeek}`);
      const start = minutes(window.startTime); const end = minutes(window.endTime);
      return { ...window, start, end: end > start ? end : end + 1440 };
    }).sort((a, b) => a.start - b.start);
    for (let index = 1; index < intervals.length; index += 1) {
      if (intervals[index].start < intervals[index - 1].end) throw new ValidationError(`Overlapping windows for ${day.dayOfWeek}`);
    }
  }
  return schedule;
}
