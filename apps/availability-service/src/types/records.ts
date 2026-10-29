import {
  AllocationStatus,
  DayOfWeek,
  HoldStatus,
  StoredSlotStatus,
} from '../domain/constants';

type EntityTypeValue =
  | 'Slot'
  | 'SlotLookup'
  | 'SlotHold'
  | 'HoldLookup'
  | 'HoldIdempotency'
  | 'SlotAllocation'
  | 'AllocationLookup'
  | 'WorkingHours'
  | 'ScheduleIndex'
  | 'Holiday'
  | 'HolidayLookup'
  | 'HolidayIndex';

export interface KeyedItem {
  PK: string;
  SK: string;
  entityType: EntityTypeValue;
}

export interface SlotItem extends KeyedItem {
  entityType: 'Slot';
  slotId: string;
  vendorId: string;
  branchId: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  durationMinutes: number;
  capacity: number;
  heldCount: number;
  bookedCount: number;
  /** Remaining units. Absent on slots written before this attribute existed. */
  availableCount?: number;
  status: StoredSlotStatus;
  serviceIds: string[];
  vehicleTypeIds: string[];
  visitId?: string;
  windowId?: string;
  startDayOffset?: number;
  endDayOffset?: 0 | 1;
  createdAt: string;
  updatedAt: string;
}

export interface SlotLookupItem extends KeyedItem {
  entityType: 'SlotLookup';
  slotId: string;
  vendorId: string;
  branchId: string;
  date: string;
  canonicalPk: string;
  canonicalSk: string;
  createdAt: string;
}

export interface HoldItem extends KeyedItem {
  entityType: 'SlotHold';
  holdId: string;
  slotId: string;
  vendorId: string;
  branchId: string;
  customerId: string;
  status: HoldStatus;
  units: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ttl: number;
  bookingId?: string;
  GSI1PK?: string;
  GSI1SK?: string;
}

export interface HoldLookupItem extends KeyedItem {
  entityType: 'HoldLookup';
  holdId: string;
  slotId: string;
  vendorId: string;
  branchId: string;
  customerId: string;
  status: HoldStatus;
  units: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  bookingId?: string;
  canonicalPk: string;
  canonicalSk: string;
  GSI1PK: string;
  GSI1SK: string;
}

export interface HoldIdempotencyItem extends KeyedItem {
  entityType: 'HoldIdempotency';
  customerId: string;
  idempotencyKey: string;
  holdId: string;
  slotId: string;
  createdAt: string;
}

export interface CoveredSlotRef {
  slotId: string;
  canonicalPk: string;
  canonicalSk: string;
}

export interface AllocationItem extends KeyedItem {
  entityType: 'SlotAllocation';
  bookingId: string;
  holdId?: string;
  slotId: string;
  slotIds?: string[];
  coveredSlots?: CoveredSlotRef[];
  vendorId: string;
  branchId: string;
  customerId: string;
  offeringId?: string;
  vehicleType?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  timezone?: string;
  durationMinutes?: number;
  packageVisitId?: string;
  planId?: string;
  units: number;
  status: AllocationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AllocationLookupItem extends KeyedItem {
  entityType: 'AllocationLookup';
  bookingId: string;
  holdId?: string;
  slotId: string;
  slotIds?: string[];
  coveredSlots?: CoveredSlotRef[];
  vendorId: string;
  branchId: string;
  customerId: string;
  offeringId?: string;
  vehicleType?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  timezone?: string;
  durationMinutes?: number;
  packageVisitId?: string;
  planId?: string;
  units: number;
  status: AllocationStatus;
  canonicalPk: string;
  canonicalSk: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkingHoursInterval {
  dayOfWeek: DayOfWeek;
  closed: boolean;
  openTime?: string;
  closeTime?: string;
}

export interface WorkingHoursItem extends KeyedItem {
  entityType: 'WorkingHours';
  vendorId: string;
  branchId: string;
  timezone: string;
  ownerUserId: string;
  hours: WorkingHoursInterval[];
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleIndexItem extends KeyedItem {
  entityType: 'ScheduleIndex';
  vendorId: string;
  branchId: string;
  createdAt: string;
}

export interface HolidayItem extends KeyedItem {
  entityType: 'Holiday' | 'HolidayIndex';
  holidayId: string;
  vendorId: string;
  branchId?: string;
  date: string;
  holidayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HolidayLookupItem extends KeyedItem {
  entityType: 'HolidayLookup';
  holidayId: string;
  vendorId: string;
  branchId?: string;
  date: string;
  holidayName?: string;
  canonicalPk: string;
  canonicalSk: string;
  indexPk: string;
  indexSk: string;
  createdAt: string;
  updatedAt: string;
}

export interface SlotView {
  id: string;
  vendorId: string;
  branchId: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  durationMinutes: number;
  capacity: number;
  heldCount: number;
  bookedCount: number;
  available: number;
  status: 'available' | 'full' | 'blocked';
  serviceIds: string[];
  vehicleTypeIds: string[];
}

export interface HoldView {
  id: string;
  holdId: string;
  slotId: string;
  vendorId: string;
  branchId: string;
  status: HoldStatus;
  expiresAt: string;
  units: number;
  customerId?: string;
  bookingId?: string;
  createdAt: string;
}

export interface HoldReservationView {
  holdId: string;
  slotId: string;
  vendorId: string;
  branchId: string;
  customerId: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  durationMinutes: number;
}

export interface HolidayView {
  id: string;
  vendorId: string;
  branchId?: string;
  date: string;
  name?: string;
}

export interface WorkingHoursView {
  vendorId: string;
  branchId: string;
  timezone: string;
  hours: WorkingHoursInterval[];
}
