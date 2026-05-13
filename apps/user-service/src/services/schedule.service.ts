import { createLogger, createChildLogger } from '@api-hub/observability';
import * as scheduleRepository from '../repositories/schedule.repository';
import type {
  ScheduleEntry,
  SchedulePreferences,
  ScheduleExclusion,
  TimeSlot,
} from '../models/Schedule';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

export async function getSchedulePreferences(
  userId: string,
  organizationId: string,
): Promise<SchedulePreferences | null> {
  const logger = createChildLogger(baseLogger, { userId, organizationId });
  logger.info({ event: 'scheduleService_getPreferences_start' });
  const result = await scheduleRepository.getSchedulePreferences(userId, organizationId);
  logger.info({ event: 'scheduleService_getPreferences_done', found: !!result });
  return result;
}

export async function putSchedulePreferences(
  userId: string,
  organizationId: string,
  prefs: SchedulePreferences,
): Promise<SchedulePreferences> {
  const logger = createChildLogger(baseLogger, { userId, organizationId });
  logger.info({ event: 'scheduleService_putPreferences_start' });
  await scheduleRepository.putSchedulePreferences(userId, organizationId, prefs);
  const updated = await scheduleRepository.getSchedulePreferences(userId, organizationId);
  logger.info({ event: 'scheduleService_putPreferences_done' });
  return updated!;
}

export async function getSchedule(
  userId: string,
  organizationId: string,
  scheduleId: string,
): Promise<ScheduleEntry | null> {
  return scheduleRepository.getSchedule(userId, organizationId, scheduleId);
}

export async function listSchedules(
  userId: string,
  organizationId: string,
  startDate: string,
  endDate: string,
  scheduleType?: string,
): Promise<ScheduleEntry[]> {
  return scheduleRepository.listSchedulesByDateRange(
    userId,
    organizationId,
    startDate,
    endDate,
    scheduleType,
  );
}

export async function createSchedule(
  userId: string,
  organizationId: string,
  body: {
    scheduleId: string;
    scheduleType: ScheduleEntry['scheduleType'];
    scheduleTitle?: string;
    scheduleNote?: string;
    startDate: string;
    endDate: string;
    frequency?: ScheduleEntry['frequency'];
    dayOfWeek?: string[];
    timeSlots?: TimeSlot[];
    leaveType?: ScheduleEntry['leaveType'];
    isEnabled?: boolean;
    queueCapacity?: number;
    maxCapacity?: number;
  },
): Promise<ScheduleEntry> {
  const entry = await scheduleRepository.createSchedule(userId, organizationId, {
    ...body,
    organizationId,
  });
  return entry;
}

export async function updateSchedule(
  userId: string,
  organizationId: string,
  scheduleId: string,
  body: Partial<ScheduleEntry>,
): Promise<ScheduleEntry | null> {
  return scheduleRepository.updateSchedule(userId, organizationId, scheduleId, body);
}

export async function deleteSchedule(
  userId: string,
  organizationId: string,
  scheduleId: string,
): Promise<boolean> {
  await scheduleRepository.deleteExclusionsBySchedule(userId, organizationId, scheduleId);
  return scheduleRepository.deleteSchedule(userId, organizationId, scheduleId);
}

export async function listExclusions(
  userId: string,
  organizationId: string,
  startDate: string,
  endDate: string,
): Promise<ScheduleExclusion[]> {
  return scheduleRepository.listExclusions(userId, organizationId, startDate, endDate);
}

export async function addExclusions(
  userId: string,
  organizationId: string,
  exclusions: Omit<ScheduleExclusion, 'organizationId'>[],
): Promise<void> {
  await scheduleRepository.addExclusions(userId, organizationId, exclusions);
}

export async function deleteExclusions(
  userId: string,
  organizationId: string,
  scheduleId?: string,
): Promise<number> {
  if (scheduleId) {
    return scheduleRepository.deleteExclusionsBySchedule(userId, organizationId, scheduleId);
  }
  return 0;
}
