/**
 * Schedule / availability models for doctor and staff.
 * One entry per rule: available window, break, unavailability, leave, etc.
 */

export type ScheduleType =
  | 'MEETING'
  | 'LEAVE'
  | 'BREAK'
  | 'WALKIN_ONLINE'
  | 'WALKIN_VISIT'
  | 'SQUEEZE_IN'
  | 'EDIT_DATES';

export type LeaveType = 'SICK' | 'VACATION';

export type FrequencyType = 'neverRepeat' | 'everyDay' | 'weekly' | 'monthly' | 'custom';

export interface TimeSlot {
  from: string;
  to: string;
  maxCapacity?: number;
  queueCapacity?: number;
}

export interface ScheduleEntry {
  scheduleId: string;
  organizationId: string;
  scheduleType: ScheduleType;
  scheduleTitle?: string;
  scheduleNote?: string;
  startDate: string; // yyyyLLdd
  endDate: string;
  frequency?: FrequencyType;
  dayOfWeek?: string[];
  timeSlots?: TimeSlot[];
  leaveType?: LeaveType;
  isEnabled?: boolean;
  queueCapacity?: number;
  maxCapacity?: number;
  createdAt?: number;
  modifiedAt?: number;
  isDeleted?: boolean;
}

export interface SchedulePreferences {
  workingHours?: Record<string, { available: boolean; availableHours?: Array<{ from: string; to: string }> }>;
  slotDurationInMinutes?: number;
  availability?: Array<{ day: string; available: boolean; availableHours?: Array<{ from: string; to: string }> }>;
  leaves?: Array<{ from: string; to: string }>;
  customAvailability?: Record<string, { available: boolean; availableHours?: Array<{ from: string; to: string }> }>;
  slotsFrequency?: number;
  maxEventAllowedPerDay?: number;
}

export interface ScheduleExclusion {
  scheduleId: string;
  date: string; // yyyyLLdd
  type: 'exclude' | 'edited';
  timeSlots?: TimeSlot[];
  maxCapacity?: number;
  queueCapacity?: number;
  organizationId?: string;
}
