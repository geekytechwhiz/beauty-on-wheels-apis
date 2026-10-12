/** Wire values are camelCase. Day codes stay short stable tokens. */

export const SLOT_STATUS = {
  AVAILABLE: 'available',
  BLOCKED: 'blocked',
  FULL: 'full',
} as const;

export type SlotStatus = (typeof SLOT_STATUS)[keyof typeof SLOT_STATUS];

export const STORED_SLOT_STATUS = {
  AVAILABLE: 'available',
  BLOCKED: 'blocked',
} as const;

export type StoredSlotStatus =
  (typeof STORED_SLOT_STATUS)[keyof typeof STORED_SLOT_STATUS];

export const HOLD_STATUS = {
  ACTIVE: 'active',
  RELEASED: 'released',
  CONSUMED: 'consumed',
  EXPIRED: 'expired',
} as const;

export type HoldStatus = (typeof HOLD_STATUS)[keyof typeof HOLD_STATUS];

export const ALLOCATION_STATUS = {
  CONFIRMED: 'confirmed',
  RELEASED: 'released',
} as const;

export type AllocationStatus =
  (typeof ALLOCATION_STATUS)[keyof typeof ALLOCATION_STATUS];

export const DAY_OF_WEEK = [
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
  'SUN',
] as const;

export type DayOfWeek = (typeof DAY_OF_WEEK)[number];

export const ENTITY_TYPE = {
  SLOT: 'Slot',
  SLOT_LOOKUP: 'SlotLookup',
  HOLD: 'SlotHold',
  HOLD_LOOKUP: 'HoldLookup',
  HOLD_IDEMPOTENCY: 'HoldIdempotency',
  ALLOCATION: 'SlotAllocation',
  ALLOCATION_LOOKUP: 'AllocationLookup',
  WORKING_HOURS: 'WorkingHours',
  SCHEDULE_INDEX: 'ScheduleIndex',
  HOLIDAY: 'Holiday',
  HOLIDAY_LOOKUP: 'HolidayLookup',
  HOLIDAY_INDEX: 'HolidayIndex',
} as const;

/** The only GSI defined on availability-table. PK GSI1PK, SK GSI1SK, projection ALL. */
export const GSI1_INDEX = 'GSI1';

export const META_SK = 'META';

export const MAX_RANGE_DAYS = 31;

export const DEFAULT_LIST_LIMIT = 50;

export const MAX_LIST_LIMIT = 100;

export const EXPIRY_LOOKBACK_HOURS = 48;
