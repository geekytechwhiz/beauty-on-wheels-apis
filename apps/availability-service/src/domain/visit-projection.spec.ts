import type { ServiceVisitSnapshot } from '@api-hub/event-platform';

import { applyVisitProjection } from './visit-projection';

function snapshot(version: number, status: ServiceVisitSnapshot['status'] = 'active'): ServiceVisitSnapshot {
  return {
    vendorId: 'vendor_123',
    visitId: 'visit_001',
    configurationVersion: version,
    occurredAt: `2026-10-25T08:00:0${version}.000Z`,
    change: status === 'active' ? 'activated' : status === 'paused' ? 'paused' : 'updated',
    name: 'Ivy League',
    deliveryModel: 'community',
    location: { type: 'community', communityId: 'community_101', branchId: 'branch_001' },
    timezone: 'Asia/Kolkata',
    windows: [{
      windowId: 'weekday_morning',
      label: 'earlyMorning',
      daysOfWeek: ['MON'],
      startTime: '06:00',
      endTime: '09:00',
      endDayOffset: 0,
      maxConcurrentBookings: 2,
    }],
    serviceIds: ['service_exterior'],
    services: [{ serviceId: 'service_exterior', durationMinutes: 60 }],
    effectiveFrom: '2026-11-01',
    effectiveUntil: null,
    status,
  };
}

describe('visit projection', () => {
  it('ignores duplicate and out-of-order versions and applies a newer pause', () => {
    const first = applyVisitProjection(null, snapshot(2));
    expect(first.applied).toBe(true);
    if (!first.applied) {
      return;
    }
    expect(applyVisitProjection(first.projection, snapshot(2)).applied).toBe(false);
    expect(applyVisitProjection(first.projection, snapshot(1)).applied).toBe(false);
    const paused = applyVisitProjection(first.projection, snapshot(3, 'paused'));
    expect(paused.applied).toBe(true);
    if (paused.applied) {
      expect(paused.projection.status).toBe('paused');
      expect(paused.projection.configurationVersion).toBe(3);
    }
  });
});
