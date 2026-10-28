import { EventSchemaError } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { z } from 'zod';
import { validateWeeklySchedule } from '../domain/community-schedule';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const CommunityScheduleSchema = z.object({
  timezone: z.string().trim().min(1).max(64).refine((value) => { try { Intl.DateTimeFormat(undefined, { timeZone: value }); return true; } catch { return false; } }, 'timezone must be an IANA timezone'),
  scheduleType: z.literal('RECURRING'),
  weeklySchedule: z.array(z.object({ dayOfWeek: z.enum(['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY']), windows: z.array(z.object({ startTime: time, endTime: time }).strict()) }).strict()),
}).strict();
export function validateCommunityScheduleRequest(req: LambdaRequest) {
  const result = CommunityScheduleSchema.safeParse(req.body);
  if (!result.success) throw new EventSchemaError('Request validation failed', result.error);
  validateWeeklySchedule(result.data.weeklySchedule);
  req.body = result.data;
  return result.data;
}
