import { addMinutes } from './time';
import {
  CoverageSlot,
  MAX_COVERED_BLOCKS,
  RESERVATION_REJECTION,
  selectCapacityBlocks,
  supportsService,
  supportsVehicle,
} from './slot-coverage';

function block(startTime: string, durationMinutes: number, overrides: Partial<CoverageSlot> = {}): CoverageSlot {
  return {
    slotId: `slot_${startTime.replace(':', '')}`,
    startTime,
    endTime: addMinutes(startTime, durationMinutes),
    durationMinutes,
    capacity: 2,
    heldCount: 0,
    bookedCount: 0,
    status: 'available',
    serviceIds: [],
    vehicleTypeIds: [],
    timezone: 'Asia/Kolkata',
    vendorId: 'vendor-1',
    branchId: 'branch-1',
    date: '2026-10-21',
    ...overrides,
  };
}

function grid(): CoverageSlot[] {
  return ['09:00', '09:30', '10:00', '10:30', '11:00'].map((start) => block(start, 30));
}

const request = {
  vendorId: 'vendor-1',
  branchId: 'branch-1',
  date: '2026-10-21',
  startTime: '09:00',
  timezone: 'Asia/Kolkata',
  offeringId: 'svc_polish',
  vehicleType: 'HATCHBACK',
};

describe('capacity block selection', () => {
  it('treats an empty service list as unrestricted and still rejects a restricted miss', () => {
    const sample = block('09:00', 30, { serviceIds: [], vehicleTypeIds: [], capacity: 2 });
    expect(sample.serviceIds.includes('svc_polish')).toBe(false);
    expect(supportsService(sample.serviceIds, 'svc_polish')).toBe(true);
    expect(supportsVehicle(sample.vehicleTypeIds, 'HATCHBACK')).toBe(true);
    const selected = selectCapacityBlocks([sample], { ...request, durationMinutes: 30 });
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.slots.map((slot) => slot.slotId)).toEqual([sample.slotId]);
    }

    const restricted = block('09:00', 30, { serviceIds: ['haircut'] });
    expect(selectCapacityBlocks([restricted], { ...request, durationMinutes: 30 })).toEqual({
      ok: false,
      reason: RESERVATION_REJECTION.SERVICE_NOT_SUPPORTED,
    });
    const matched = selectCapacityBlocks(
      [restricted],
      { ...request, offeringId: 'haircut', durationMinutes: 30 },
    );
    expect(matched.ok).toBe(true);
  });

  it('matches vehicle types case-insensitively and rejects an unsupported type', () => {
    const slots = [block('09:00', 30, { vehicleTypeIds: ['SEDAN'] })];
    expect(selectCapacityBlocks(slots, { ...request, vehicleType: 'sedan', durationMinutes: 30 }).ok).toBe(true);
    expect(selectCapacityBlocks(slots, { ...request, vehicleType: 'SUV', durationMinutes: 30 })).toEqual({
      ok: false,
      reason: RESERVATION_REJECTION.VEHICLE_TYPE_NOT_SUPPORTED,
    });
    expect(supportsVehicle([], 'SUV')).toBe(true);
  });

  it.each([
    [30, ['09:00']],
    [45, ['09:00', '09:30']],
    [60, ['09:00', '09:30']],
    [70, ['09:00', '09:30', '10:00']],
    [90, ['09:00', '09:30', '10:00']],
  ])('covers a %i minute service with blocks %j', (durationMinutes, starts) => {
    const selected = selectCapacityBlocks(grid(), { ...request, durationMinutes });
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.slots.map((slot) => slot.startTime)).toEqual(starts);
      expect(selected.anchor.startTime).toBe('09:00');
    }
  });

  it('rejects a gap, a blocked intermediate block, and a full block', () => {
    const missing = grid().filter((slot) => slot.startTime !== '09:30');
    expect(selectCapacityBlocks(missing, { ...request, durationMinutes: 60 })).toEqual({
      ok: false,
      reason: RESERVATION_REJECTION.INSUFFICIENT_DURATION,
    });

    const blocked = grid().map((slot) =>
      slot.startTime === '09:30' ? { ...slot, status: 'blocked' } : slot,
    );
    expect(selectCapacityBlocks(blocked, { ...request, durationMinutes: 60 })).toEqual({
      ok: false,
      reason: RESERVATION_REJECTION.SLOT_BLOCKED,
    });

    const full = grid().map((slot) =>
      slot.startTime === '09:30' ? { ...slot, bookedCount: slot.capacity } : slot,
    );
    expect(selectCapacityBlocks(full, { ...request, durationMinutes: 60 })).toEqual({
      ok: false,
      reason: RESERVATION_REJECTION.INSUFFICIENT_CAPACITY,
    });
  });

  it('rejects a free sibling when an overlapping slot is already full', () => {
    const slots = [
      block('09:00', 60, { slotId: 'slot_long', capacity: 1, bookedCount: 1 }),
      block('09:00', 30, { slotId: 'slot_short', capacity: 1 }),
    ];
    expect(selectCapacityBlocks(slots, { ...request, durationMinutes: 30 })).toEqual({
      ok: false,
      reason: RESERVATION_REJECTION.OVERLAPPING_RESERVATION,
    });
  });

  it('reserves every overlapping slot id so a second booking cannot share the interval', () => {
    const slots = [
      block('09:00', 60, { slotId: 'slot_long', capacity: 1 }),
      block('09:00', 30, { slotId: 'slot_short', capacity: 1 }),
    ];
    const selected = selectCapacityBlocks(slots, { ...request, durationMinutes: 30 });
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.slots.map((slot) => slot.slotId).sort()).toEqual(['slot_long', 'slot_short']);
    }
  });

  it('rejects a span that cannot fit in one DynamoDB transaction', () => {
    const slots = Array.from({ length: MAX_COVERED_BLOCKS + 1 }, (_, index) => {
      const minutes = index * 15;
      const start = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      return block(start, 15, { slotId: `slot_${index}` });
    });
    expect(selectCapacityBlocks(slots, {
      ...request,
      startTime: '00:00',
      durationMinutes: (MAX_COVERED_BLOCKS + 1) * 15,
    })).toEqual({
      ok: false,
      reason: RESERVATION_REJECTION.INSUFFICIENT_DURATION,
    });
  });

  it('reports a missing slot and a timezone mismatch separately', () => {
    expect(selectCapacityBlocks([], { ...request, durationMinutes: 30 })).toEqual({
      ok: false,
      reason: RESERVATION_REJECTION.NO_SLOT_FOUND,
    });
    expect(selectCapacityBlocks(grid(), {
      ...request,
      timezone: 'America/New_York',
      durationMinutes: 30,
    })).toEqual({
      ok: false,
      reason: RESERVATION_REJECTION.TIMEZONE_MISMATCH,
    });
  });
});
