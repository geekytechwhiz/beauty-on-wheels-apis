import { SLOT_STATUS, StoredSlotStatus } from './constants';

export interface CapacityCounters {
  capacity: number;
  heldCount: number;
  bookedCount: number;
  status: StoredSlotStatus;
}

export function remainingCapacity(slot: CapacityCounters): number {
  return slot.capacity - slot.heldCount - slot.bookedCount;
}

export function displayStatus(
  slot: CapacityCounters,
): (typeof SLOT_STATUS)[keyof typeof SLOT_STATUS] {
  if (slot.status === SLOT_STATUS.BLOCKED) {
    return SLOT_STATUS.BLOCKED;
  }
  return remainingCapacity(slot) > 0 ? SLOT_STATUS.AVAILABLE : SLOT_STATUS.FULL;
}

export function hasBookableCapacity(slot: CapacityCounters, units = 1): boolean {
  return slot.status !== SLOT_STATUS.BLOCKED && remainingCapacity(slot) >= units;
}
