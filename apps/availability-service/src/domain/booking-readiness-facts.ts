import { todayInTimeZone } from './community-visits';
import type { CommunityVisitScheduleRecord, DatedCommunityVisitRecord } from '../repositories/community-visits.repository';

/** A schedule counts only while it still has a non-cancelled visit today or later. */
export function activeValidVisitScheduleCount(
  schedules: readonly CommunityVisitScheduleRecord[],
  visits: readonly DatedCommunityVisitRecord[],
  now: Date,
): number {
  return schedules.filter((schedule) => {
    if (schedule.active === false) return false;
    const today = todayInTimeZone(schedule.timezone, now);
    return visits.some((visit) => (
      visit.scheduleId === schedule.scheduleId
      && visit.status === 'scheduled'
      && visit.date >= today
    ));
  }).length;
}
