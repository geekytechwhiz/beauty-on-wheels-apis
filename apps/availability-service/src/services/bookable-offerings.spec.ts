import { SlotsService } from './slots.service';
import { SlotsRepository } from '../repositories/slots.repository';
import { AvailabilityRepository } from '../repositories/availability.repository';
import { HolidaysRepository } from '../repositories/holidays.repository';
import { SlotItem, WorkingHoursItem } from '../types/records';

const DATE = '2026-12-01';

function schedule(): WorkingHoursItem {
  return {
    PK: 'VENDOR#vendor-1#BRANCH#branch-1#SCHEDULE',
    SK: 'HOURS',
    entityType: 'WorkingHours',
    vendorId: 'vendor-1',
    branchId: 'branch-1',
    timezone: 'UTC',
    ownerUserId: 'owner-1',
    hours: [
      { dayOfWeek: 'TUE', closed: false, openTime: '09:00', closeTime: '18:00' },
    ],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

function slot(overrides: Partial<SlotItem> = {}): SlotItem {
  return {
    PK: 'VENDOR#vendor-1#BRANCH#branch-1#DATE#2026-12-01',
    SK: 'SLOT#10:00#slot-1',
    entityType: 'Slot',
    slotId: 'slot-1',
    vendorId: 'vendor-1',
    branchId: 'branch-1',
    date: DATE,
    startTime: '10:00',
    endTime: '10:30',
    timezone: 'UTC',
    durationMinutes: 30,
    capacity: 2,
    heldCount: 0,
    bookedCount: 0,
    availableCount: 2,
    status: 'available',
    serviceIds: ['svc-polish'],
    vehicleTypeIds: ['SUV'],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function service(options: {
  slots: SlotItem[];
  hours?: WorkingHoursItem | null;
  holidays?: string[];
}): SlotsService {
  const slots = {
    querySlots: jest.fn().mockResolvedValue(options.slots),
  } as unknown as SlotsRepository;
  const schedules = {
    getWorkingHours: jest.fn().mockResolvedValue(options.hours === undefined ? schedule() : options.hours),
  } as unknown as AvailabilityRepository;
  const holidays = {
    listBranchHolidays: jest.fn().mockResolvedValue(
      (options.holidays ?? []).map((date) => ({ date })),
    ),
    listVendorHolidays: jest.fn().mockResolvedValue([]),
  } as unknown as HolidaysRepository;
  return new SlotsService(
    slots,
    schedules,
    holidays,
    () => new Date('2026-10-21T00:00:00.000Z'),
  );
}

const probe = {
  vendorId: 'vendor-1',
  branchId: 'branch-1',
  offeringId: 'svc-polish',
  vehicles: [{ vehicleType: 'SUV', durationMinutes: 30 }],
};

describe('findBookableOfferings', () => {
  it('returns an offering that has a bookable slot and skips one that does not', async () => {
    const result = await service({ slots: [slot()] }).findBookableOfferings({
      date: DATE,
      offerings: [
        probe,
        { ...probe, offeringId: 'svc-other' },
      ],
    });

    expect(result.keys).toEqual(['vendor-1#branch-1#svc-polish']);
  });

  it('honors start time and a closed day', async () => {
    const timed = await service({ slots: [slot()] }).findBookableOfferings({
      date: DATE,
      startTime: '11:00',
      offerings: [probe],
    });
    expect(timed.keys).toEqual([]);

    const closed = await service({
      slots: [slot()],
      holidays: [DATE],
    }).findBookableOfferings({
      date: DATE,
      offerings: [probe],
    });
    expect(closed.keys).toEqual([]);
  });
});
