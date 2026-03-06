import { z } from 'zod';

const timeSlotSchema = z.object({
  from: z.string(),
  to: z.string(),
  maxCapacity: z.number().optional(),
  queueCapacity: z.number().optional(),
});

const scheduleTypeEnum = z.enum([
  'MEETING',
  'LEAVE',
  'BREAK',
  'WALKIN_ONLINE',
  'WALKIN_VISIT',
  'SQUEEZE_IN',
  'EDIT_DATES',
]);

export const getSchedulePreferencesSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  organizationId: z.string().min(1, 'organizationId is required'),
});

export const putSchedulePreferencesSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  workingHours: z.record(z.string(), z.object({
    available: z.boolean(),
    availableHours: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  })).optional(),
  slotDurationInMinutes: z.number().optional(),
  availability: z.array(z.object({
    day: z.string(),
    available: z.boolean(),
    availableHours: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  })).optional(),
  leaves: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  customAvailability: z.record(z.string(), z.object({
    available: z.boolean(),
    availableHours: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  })).optional(),
  slotsFrequency: z.number().optional(),
  maxEventAllowedPerDay: z.number().optional(),
});

export const listSchedulesSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  startDate: z.string().regex(/^\d{8}$/, 'startDate must be YYYYMMDD'),
  endDate: z.string().regex(/^\d{8}$/, 'endDate must be YYYYMMDD'),
  scheduleType: z.string().optional(),
});

export const getScheduleSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  scheduleId: z.string().min(1),
});

export const createScheduleSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  scheduleId: z.string().min(1),
  scheduleType: scheduleTypeEnum,
  scheduleTitle: z.string().optional(),
  scheduleNote: z.string().optional(),
  startDate: z.string().regex(/^\d{8}$/),
  endDate: z.string().regex(/^\d{8}$/),
  frequency: z.enum(['neverRepeat', 'everyDay', 'weekly', 'monthly', 'custom']).optional(),
  dayOfWeek: z.array(z.string()).optional(),
  timeSlots: z.array(timeSlotSchema).optional(),
  leaveType: z.enum(['SICK', 'VACATION']).optional(),
  isEnabled: z.boolean().optional(),
  queueCapacity: z.number().optional(),
  maxCapacity: z.number().optional(),
});

export const updateScheduleSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  scheduleId: z.string().min(1),
  scheduleTitle: z.string().optional(),
  scheduleNote: z.string().optional(),
  startDate: z.string().regex(/^\d{8}$/).optional(),
  endDate: z.string().regex(/^\d{8}$/).optional(),
  frequency: z.enum(['neverRepeat', 'everyDay', 'weekly', 'monthly', 'custom']).optional(),
  dayOfWeek: z.array(z.string()).optional(),
  timeSlots: z.array(timeSlotSchema).optional(),
  leaveType: z.enum(['SICK', 'VACATION']).optional(),
  isEnabled: z.boolean().optional(),
  queueCapacity: z.number().optional(),
  maxCapacity: z.number().optional(),
});

export const deleteScheduleSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  scheduleId: z.string().min(1),
});

export const listExclusionsSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  startDate: z.string().regex(/^\d{8}$/),
  endDate: z.string().regex(/^\d{8}$/),
});

export const addExclusionsSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  exclusions: z.array(z.object({
    scheduleId: z.string(),
    date: z.string().regex(/^\d{8}$/),
    type: z.enum(['exclude', 'edited']),
    timeSlots: z.array(timeSlotSchema).optional(),
    maxCapacity: z.number().optional(),
    queueCapacity: z.number().optional(),
  })),
});

export const deleteExclusionsSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  scheduleId: z.string().optional(),
});
