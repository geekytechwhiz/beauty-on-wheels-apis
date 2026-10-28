import { atomicSlotId, availableAfterReservations, bookingCapacity, planVisitSlots } from './service-visit-slots';
import { VisitProjection } from './visit-projection';

const projection: VisitProjection = {
  vendorId: 'vendor_123',
  visitId: 'visit_001',
  configurationVersion: 2,
  status: 'active',
  name: 'Ivy League',
  deliveryModel: 'community',
  location: { type: 'community', communityId: 'community_101', branchId: 'branch_001' },
  timezone: 'Asia/Kolkata',
  windows: [
    {
      windowId: 'weekday_morning',
      label: 'earlyMorning',
      daysOfWeek: ['MON', 'WED', 'FRI'],
      startTime: '06:00',
      endTime: '09:00',
      endDayOffset: 0,
      maxConcurrentBookings: 2,
    },
    {
      windowId: 'weekend_day',
      label: 'weekend',
      daysOfWeek: ['SAT', 'SUN'],
      startTime: '08:00',
      endTime: '18:00',
      endDayOffset: 0,
      maxConcurrentBookings: 3,
    },
    {
      windowId: 'night',
      label: 'night',
      daysOfWeek: ['MON'],
      startTime: '22:00',
      endTime: '02:00',
      endDayOffset: 1,
      maxConcurrentBookings: 1,
      bufferMinutes: 0,
    },
  ],
  serviceIds: ['service_exterior', 'service_complete'],
  services: [
    { serviceId: 'service_exterior', durationMinutes: 60 },
    { serviceId: 'service_complete', durationMinutes: 90 },
  ],
  staffIds: ['staff_101'],
  effectiveFrom: '2026-11-01',
  effectiveUntil: null,
  occurredAt: '2026-10-25T08:00:00.000Z',
};

describe('service visit slots', () => {
  it('tiles Monday morning by the shared duration step and keeps capacity on shared blocks', () => {
    const slots = planVisitSlots({
      projections: [projection],
      date: '2026-11-02',
      communityId: 'community_101',
      serviceId: 'service_exterior',
    });
    const morning = slots.filter((slot) => slot.windowId === 'weekday_morning');
    expect(morning.map((slot) => slot.clockStart)).toEqual(['06:00', '06:30', '07:00', '07:30', '08:00']);
    expect(morning[0].capacity).toBe(2);
    expect(morning[0].durationMinutes).toBe(60);
    expect(morning[0].occupancyMinutes).toBe(60);
    const firstHour = morning.filter((slot) => slot.clockStart === '06:00' || slot.clockStart === '06:30');
    const shared = atomicSlotId(firstHour[0].blocks[1]);
    expect(firstHour[1].blocks.map((block) => atomicSlotId(block))).toContain(shared);
  });

  it('uses the weekend window and its higher capacity', () => {
    const slots = planVisitSlots({
      projections: [projection],
      date: '2026-11-07',
      communityId: 'community_101',
      serviceId: 'service_complete',
    });
    expect(slots.every((slot) => slot.windowId === 'weekend_day')).toBe(true);
    expect(slots[0].capacity).toBe(3);
    expect(slots[0].durationMinutes).toBe(90);
    expect(slots.at(-1)?.clockStart).toBe('16:30');
  });

  it('keeps an overnight service inside the window and omits a service that does not fit', () => {
    const night = planVisitSlots({
      projections: [projection],
      date: '2026-11-02',
      communityId: 'community_101',
      serviceId: 'service_exterior',
    }).filter((slot) => slot.windowId === 'night');
    expect(night.map((slot) => `${slot.date} ${slot.clockStart}`)).toEqual([
      '2026-11-02 22:00',
      '2026-11-02 22:30',
      '2026-11-02 23:00',
      '2026-11-02 23:30',
    ]);
    const tail = planVisitSlots({
      projections: [projection],
      date: '2026-11-03',
      communityId: 'community_101',
      serviceId: 'service_exterior',
    }).filter((slot) => slot.windowId === 'night');
    expect(tail.map((slot) => slot.clockStart)).toEqual(['00:00', '00:30', '01:00']);
    expect(tail[0].occurrenceDate).toBe('2026-11-02');

    const tooLong = planVisitSlots({
      projections: [{
        ...projection,
        windows: [{ ...projection.windows[0], endTime: '06:45' }],
        services: [{ serviceId: 'service_complete', durationMinutes: 90 }],
        serviceIds: ['service_complete'],
      }],
      date: '2026-11-02',
      communityId: 'community_101',
      serviceId: 'service_complete',
    });
    expect(tooLong).toEqual([]);
  });

  it('uses water, equipment, and duration without treating staff count as booking capacity', () => {
    const resourceWindow = {
      windowId: 'weekday_morning',
      label: 'earlyMorning' as const,
      daysOfWeek: ['MON' as const, 'WED' as const, 'FRI' as const],
      startTime: '06:00',
      endTime: '09:00',
      endDayOffset: 0 as const,
      capacity: { staffCount: 2 },
      resources: {
        water: { source: 'vendorSupplied' as const, capacityLiters: 300 },
        equipment: { providedByVendor: true },
      },
    };
    const wash = {
      ...projection,
      windows: [resourceWindow],
      services: [{ serviceId: 'service_exterior', durationMinutes: 60, waterLiters: 100 }],
      serviceIds: ['service_exterior'],
    };
    const slots = planVisitSlots({
      projections: [wash],
      date: '2026-11-02',
      communityId: 'community_101',
      serviceId: 'service_exterior',
    });
    expect(bookingCapacity(resourceWindow, wash.services[0])).toBe(3);
    expect(slots[0].capacity).toBe(3);
    expect(slots[0].capacity).not.toBe(resourceWindow.capacity.staffCount);

    const unequipped = planVisitSlots({
      projections: [{
        ...wash,
        windows: [{
          ...resourceWindow,
          resources: {
            water: { source: 'waterless' as const },
            equipment: { providedByVendor: false },
          },
        }],
        services: [{ serviceId: 'service_exterior', durationMinutes: 60, requiresWater: true, requiresVendorEquipment: true }],
      }],
      date: '2026-11-02',
      communityId: 'community_101',
      serviceId: 'service_exterior',
    });
    expect(unequipped).toEqual([]);

    expect(availableAfterReservations({
      capacity: 2,
      reserved: 1,
      waterCapacityLiters: 300,
      waterLitersPerBooking: 200,
    })).toBe(0);
  });

  it('does not offer a paused visit', () => {
    const slots = planVisitSlots({
      projections: [{ ...projection, status: 'paused' }],
      date: '2026-11-02',
      communityId: 'community_101',
      serviceId: 'service_exterior',
    });
    expect(slots).toEqual([]);
  });
});
