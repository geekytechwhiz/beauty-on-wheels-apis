import { ValidationError } from '@api-hub/utils';

import {
  DELIVERY_MODEL,
  LOCATION_TYPE,
  VISIT_STATUS,
  WATER_SOURCE,
  WINDOW_LABEL,
  assertServiceVisitShape,
  assertServicesFit,
  canTransition,
  configurationsOverlap,
  type ServiceVisitRecord,
  type ServiceVisitWindow,
} from './service-visits';

const morning: ServiceVisitWindow = {
  windowId: 'weekday_morning',
  label: WINDOW_LABEL.EARLY_MORNING,
  daysOfWeek: ['MON', 'WED', 'FRI'],
  startTime: '06:00',
  endTime: '09:00',
  endDayOffset: 0,
  maxConcurrentBookings: 2,
};

const weekend: ServiceVisitWindow = {
  windowId: 'weekend_day',
  label: WINDOW_LABEL.WEEKEND,
  daysOfWeek: ['SAT', 'SUN'],
  startTime: '08:00',
  endTime: '18:00',
  endDayOffset: 0,
  maxConcurrentBookings: 3,
};

function visit(overrides: Partial<ServiceVisitRecord> = {}): ServiceVisitRecord {
  return {
    visitId: 'visit_1',
    vendorId: 'vendor_123',
    ownerUserId: 'owner',
    name: 'Ivy League',
    deliveryModel: DELIVERY_MODEL.COMMUNITY,
    location: { type: LOCATION_TYPE.COMMUNITY, communityId: 'community_101', branchId: 'branch_001' },
    timezone: 'Asia/Kolkata',
    windows: [morning, weekend],
    serviceIds: ['service_exterior'],
    services: [{ serviceId: 'service_exterior', durationMinutes: 60 }],
    staffIds: ['staff_101'],
    effectiveFrom: '2026-11-01',
    effectiveUntil: null,
    status: VISIT_STATUS.ACTIVE,
    version: 1,
    createdAt: '2026-10-25T08:00:00.000Z',
    updatedAt: '2026-10-25T08:00:00.000Z',
    ...overrides,
  };
}

describe('service visit configuration', () => {
  it('accepts early morning and weekend windows', () => {
    expect(() => assertServiceVisitShape({
      name: 'Ivy League Community Wash',
      deliveryModel: DELIVERY_MODEL.COMMUNITY,
      location: { type: LOCATION_TYPE.COMMUNITY, communityId: 'community_101', branchId: 'branch_001' },
      timezone: 'Asia/Kolkata',
      windows: [morning, weekend],
      serviceIds: ['service_exterior', 'service_complete'],
      staffIds: ['staff_101'],
      effectiveFrom: '2026-11-01',
      effectiveUntil: null,
    })).not.toThrow();
  });

  it('rejects a service that cannot fit in any window', () => {
    expect(() => assertServicesFit(
      [{ ...morning, endTime: '06:30' }],
      [{ serviceId: 'service_complete', durationMinutes: 90 }],
    )).toThrow(ValidationError);
  });

  it('accepts a 90 minute service inside a three hour window', () => {
    expect(() => assertServicesFit(
      [morning],
      [{ serviceId: 'service_complete', durationMinutes: 90 }],
    )).not.toThrow();
  });

  it('rejects overlapping windows and overlapping visits for the same crew', () => {
    expect(() => assertServiceVisitShape({
      name: 'Overlap',
      deliveryModel: DELIVERY_MODEL.COMMUNITY,
      location: { type: LOCATION_TYPE.COMMUNITY, communityId: 'community_101' },
      timezone: 'Asia/Kolkata',
      windows: [morning, { ...morning, windowId: 'again', startTime: '08:00', endTime: '10:00' }],
      serviceIds: ['service_exterior'],
      effectiveFrom: '2026-11-01',
    })).toThrow(/overlap/i);

    const overnight = visit({
      visitId: 'visit_night',
      windows: [{
        windowId: 'night',
        label: WINDOW_LABEL.NIGHT,
        daysOfWeek: ['SUN'],
        startTime: '22:00',
        endTime: '02:00',
        endDayOffset: 1,
        maxConcurrentBookings: 1,
      }],
    });
    const monday = visit({
      visitId: 'visit_monday',
      windows: [{
        windowId: 'early',
        label: WINDOW_LABEL.EARLY_MORNING,
        daysOfWeek: ['MON'],
        startTime: '01:00',
        endTime: '03:00',
        endDayOffset: 0,
        maxConcurrentBookings: 1,
      }],
    });
    expect(configurationsOverlap(overnight, monday)).toBe(true);
    expect(configurationsOverlap(overnight, visit({ visitId: 'other', staffIds: ['staff_999'] }))).toBe(false);
  });

  const resourced: ServiceVisitWindow = {
    windowId: 'weekday_morning',
    label: WINDOW_LABEL.EARLY_MORNING,
    daysOfWeek: ['MON', 'WED', 'FRI'],
    startTime: '06:00',
    endTime: '09:00',
    endDayOffset: 0,
    capacity: { staffCount: 2 },
    resources: {
      water: { source: WATER_SOURCE.VENDOR_SUPPLIED, capacityLiters: 300 },
      equipment: { providedByVendor: true },
    },
  };

  it('requires staff count and resources on a new window and does not copy staff count into booking capacity', () => {
    expect(() => assertServiceVisitShape({
      name: 'Ivy League Community Wash',
      deliveryModel: DELIVERY_MODEL.COMMUNITY,
      location: { type: LOCATION_TYPE.COMMUNITY, communityId: 'community_101' },
      timezone: 'Asia/Kolkata',
      windows: [resourced],
      serviceIds: ['service_exterior'],
      effectiveFrom: '2026-11-01',
    }, { allowLegacyWindows: false })).not.toThrow();
    expect(resourced.maxConcurrentBookings).toBeUndefined();
    expect(resourced.capacity?.staffCount).toBe(2);

    expect(() => assertServiceVisitShape({
      name: 'Ivy League Community Wash',
      deliveryModel: DELIVERY_MODEL.COMMUNITY,
      location: { type: LOCATION_TYPE.COMMUNITY, communityId: 'community_101' },
      timezone: 'Asia/Kolkata',
      windows: [morning],
      serviceIds: ['service_exterior'],
      effectiveFrom: '2026-11-01',
    }, { allowLegacyWindows: false })).toThrow(/staffCount/);

    expect(() => assertServiceVisitShape({
      name: 'Ivy League Community Wash',
      deliveryModel: DELIVERY_MODEL.COMMUNITY,
      location: { type: LOCATION_TYPE.COMMUNITY, communityId: 'community_101' },
      timezone: 'Asia/Kolkata',
      windows: [{ ...resourced, capacity: { staffCount: 0 } }],
      serviceIds: ['service_exterior'],
      effectiveFrom: '2026-11-01',
    }, { allowLegacyWindows: false })).toThrow(/staffCount must be a positive whole number/);
  });

  it('requires a positive water capacity only when the vendor supplies water', () => {
    expect(() => assertServiceVisitShape({
      name: 'Dry wash',
      deliveryModel: DELIVERY_MODEL.COMMUNITY,
      location: { type: LOCATION_TYPE.COMMUNITY, communityId: 'community_101' },
      timezone: 'Asia/Kolkata',
      windows: [{
        ...resourced,
        resources: {
          water: { source: WATER_SOURCE.VENDOR_SUPPLIED },
          equipment: { providedByVendor: true },
        },
      }],
      serviceIds: ['service_exterior'],
      effectiveFrom: '2026-11-01',
    }, { allowLegacyWindows: false })).toThrow(/capacityLiters/);

    expect(() => assertServiceVisitShape({
      name: 'Community water',
      deliveryModel: DELIVERY_MODEL.COMMUNITY,
      location: { type: LOCATION_TYPE.COMMUNITY, communityId: 'community_101' },
      timezone: 'Asia/Kolkata',
      windows: [{
        ...resourced,
        resources: {
          water: { source: WATER_SOURCE.COMMUNITY_SUPPLIED, capacityLiters: 300 },
          equipment: { providedByVendor: false },
        },
      }],
      serviceIds: ['service_exterior'],
      effectiveFrom: '2026-11-01',
    }, { allowLegacyWindows: false })).toThrow(/capacityLiters/);

    expect(() => assertServiceVisitShape({
      name: 'Waterless',
      deliveryModel: DELIVERY_MODEL.COMMUNITY,
      location: { type: LOCATION_TYPE.COMMUNITY, communityId: 'community_101' },
      timezone: 'Asia/Kolkata',
      windows: [{
        ...resourced,
        resources: {
          water: { source: WATER_SOURCE.WATERLESS },
          equipment: { providedByVendor: true },
        },
      }],
      serviceIds: ['service_exterior'],
      effectiveFrom: '2026-11-01',
    }, { allowLegacyWindows: false })).not.toThrow();
  });

  it('rejects a service the window cannot supply with water or equipment', () => {
    expect(() => assertServicesFit(
      [resourced],
      [{ serviceId: 'service_wash', durationMinutes: 60, waterLiters: 400, requiresVendorEquipment: true }],
    )).toThrow(/water or equipment/i);
    expect(() => assertServicesFit(
      [{
        ...resourced,
        resources: {
          water: { source: WATER_SOURCE.WATERLESS },
          equipment: { providedByVendor: false },
        },
      }],
      [{ serviceId: 'service_wash', durationMinutes: 60, requiresWater: true }],
    )).toThrow(/water or equipment/i);
    expect(() => assertServicesFit(
      [morning],
      [{ serviceId: 'service_exterior', durationMinutes: 60, waterLiters: 400, requiresVendorEquipment: true }],
    )).not.toThrow();
  });

  it('allows draft, active, and paused to reach archived, and pauses only from active', () => {
    expect(canTransition(VISIT_STATUS.DRAFT, VISIT_STATUS.ACTIVE)).toBe(true);
    expect(canTransition(VISIT_STATUS.ACTIVE, VISIT_STATUS.PAUSED)).toBe(true);
    expect(canTransition(VISIT_STATUS.PAUSED, VISIT_STATUS.ACTIVE)).toBe(true);
    expect(canTransition(VISIT_STATUS.DRAFT, VISIT_STATUS.PAUSED)).toBe(false);
    expect(canTransition(VISIT_STATUS.ACTIVE, VISIT_STATUS.ARCHIVED)).toBe(true);
    expect(canTransition(VISIT_STATUS.ARCHIVED, VISIT_STATUS.ACTIVE)).toBe(false);
  });
});
