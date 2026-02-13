import {
  CANONICAL_LAB_EVENT_TYPES,
  isCanonicalLabEventType,
  type CanonicalLabEventType,
} from './canonicalLabEventTypes';

describe('integration-events canonicalLabEventTypes', () => {
  describe('CANONICAL_LAB_EVENT_TYPES', () => {
    it('includes expected lab event types', () => {
      expect(CANONICAL_LAB_EVENT_TYPES).toContain('SAMPLE_COLLECTED');
      expect(CANONICAL_LAB_EVENT_TYPES).toContain('SAMPLE_RECEIVED');
      expect(CANONICAL_LAB_EVENT_TYPES).toContain('REPORT_READY');
      expect(CANONICAL_LAB_EVENT_TYPES).toContain('BOOKING_CANCELLED');
      expect(CANONICAL_LAB_EVENT_TYPES).toHaveLength(4);
    });
  });

  describe('isCanonicalLabEventType', () => {
    it('returns true for each canonical type', () => {
      for (const t of CANONICAL_LAB_EVENT_TYPES) {
        expect(isCanonicalLabEventType(t)).toBe(true);
      }
    });

    it('returns false for non-canonical strings', () => {
      expect(isCanonicalLabEventType('LAB_REPORT_READY')).toBe(false);
      expect(isCanonicalLabEventType('ORDER_STATUS_UPDATED')).toBe(false);
      expect(isCanonicalLabEventType('')).toBe(false);
      expect(isCanonicalLabEventType('unknown')).toBe(false);
    });

    it('narrows type when true', () => {
      const value: string = 'REPORT_READY';
      if (isCanonicalLabEventType(value)) {
        const _typed: CanonicalLabEventType = value;
        expect(_typed).toBe('REPORT_READY');
      }
    });
  });
});
