import { isLabSubscriptionevent: any, deliverSubscription } from './index';

describe('outbound-delivery subscriptions', () => {
  describe('isLabSubscriptionEvent', () => {
    it('returns true for canonical lab event types', () => {
      expect(isLabSubscriptionEvent('SAMPLE_COLLECTED')).toBe(true);
      expect(isLabSubscriptionEvent('SAMPLE_RECEIVED')).toBe(true);
      expect(isLabSubscriptionEvent('REPORT_READY')).toBe(true);
      expect(isLabSubscriptionEvent('BOOKING_CANCELLED')).toBe(true);
    });

    it('returns false for non-canonical event types', () => {
      expect(isLabSubscriptionEvent('LAB_REPORT_READY')).toBe(false);
      expect(isLabSubscriptionEvent('ORDER_STATUS_UPDATED')).toBe(false);
      expect(isLabSubscriptionEvent('')).toBe(false);
      expect(isLabSubscriptionEvent('create')).toBe(false);
    });
  });

  describe('deliverSubscription', () => {
    it('returns success true (stub)', async () => {
      const result = await deliverSubscription({
        subscriptionId: 'sub-1',
        resourceType: 'Observation',
        resourceId: 'obs-1',
        eventType: 'REPORT_READY',
        payload: {},
      });
      expect(result).toEqual({ success: true });
    });
  });
});
