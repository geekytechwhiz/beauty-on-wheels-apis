import { displayStatus, remainingCapacity } from '../domain/capacity';
import {
  AllocationItem,
  AllocationLookupItem,
  HoldItem,
  HoldView,
  HolidayItem,
  HolidayView,
  SlotItem,
  SlotView,
  WorkingHoursItem,
  WorkingHoursView,
} from '../types/records';

export function toSlotView(item: SlotItem): SlotView {
  return {
    id: item.slotId,
    vendorId: item.vendorId,
    branchId: item.branchId,
    date: item.date,
    startTime: item.startTime,
    endTime: item.endTime,
    timezone: item.timezone,
    durationMinutes: item.durationMinutes,
    capacity: item.capacity,
    heldCount: item.heldCount,
    bookedCount: item.bookedCount,
    available: remainingCapacity(item),
    status: displayStatus(item),
    serviceIds: item.serviceIds,
    vehicleTypeIds: item.vehicleTypeIds,
  };
}

export function toHoldView(item: HoldItem, includeCustomer: boolean): HoldView {
  return {
    id: item.holdId,
    holdId: item.holdId,
    slotId: item.slotId,
    vendorId: item.vendorId,
    branchId: item.branchId,
    status: item.status,
    expiresAt: item.expiresAt,
    units: item.units,
    createdAt: item.createdAt,
    ...(includeCustomer ? { customerId: item.customerId } : {}),
    ...(item.bookingId ? { bookingId: item.bookingId } : {}),
  };
}

export function toHolidayView(item: HolidayItem): HolidayView {
  return {
    id: item.holidayId,
    vendorId: item.vendorId,
    ...(item.branchId ? { branchId: item.branchId } : {}),
    date: item.date,
    ...(item.holidayName ? { name: item.holidayName } : {}),
  };
}

export function toWorkingHoursView(item: WorkingHoursItem): WorkingHoursView {
  return {
    vendorId: item.vendorId,
    branchId: item.branchId,
    timezone: item.timezone,
    hours: item.hours,
  };
}

export function toAllocationSummary(item: AllocationItem | AllocationLookupItem) {
  return {
    bookingId: item.bookingId,
    holdId: item.holdId,
    slotId: item.slotId,
    vendorId: item.vendorId,
    branchId: item.branchId,
    status: item.status,
    units: item.units,
  };
}
