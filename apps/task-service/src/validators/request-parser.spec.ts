import { parseOptionalEnum, parsePageSize } from './request-parser';

describe('request-parser', () => {
  describe('parsePageSize', () => {
    it('returns default when raw is undefined', () => {
      expect(parsePageSize(undefined)).toBe(50);
    });

    it('returns default when raw is blank', () => {
      expect(parsePageSize('   ')).toBe(50);
    });

    it('parses valid integer', () => {
      expect(parsePageSize('25')).toBe(25);
    });

    it('rejects non-integer', () => {
      expect(() => parsePageSize('10.5')).toThrow('pageSize must be a positive integer');
    });

    it('rejects zero', () => {
      expect(() => parsePageSize('0')).toThrow('pageSize must be a positive integer');
    });

    it('rejects negative integers', () => {
      expect(() => parsePageSize('-1')).toThrow('pageSize must be a positive integer');
    });

    it('rejects non-numeric pageSize', () => {
      expect(() => parsePageSize('abc')).toThrow('pageSize must be a positive integer');
    });

    it('rejects values above max', () => {
      expect(() => parsePageSize('999')).toThrow('pageSize must not exceed 200');
    });
  });

  describe('parseOptionalEnum', () => {
    const allowed = ['active', 'completed'] as const;

    it('returns undefined for blank input', () => {
      expect(parseOptionalEnum(undefined, allowed, 'currentState')).toBeUndefined();
      expect(parseOptionalEnum('  ', allowed, 'currentState')).toBeUndefined();
    });

    it('returns value when allowed', () => {
      expect(parseOptionalEnum('active', allowed, 'currentState')).toBe('active');
    });

    it('throws when value is not allowed', () => {
      expect(() => parseOptionalEnum('bogus', allowed, 'currentState')).toThrow(
        'currentState must be one of: active, completed',
      );
    });
  });
});
