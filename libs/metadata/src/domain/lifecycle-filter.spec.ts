import { describe, expect, it } from '@jest/globals';
import { STATUS } from '../constants';
import { ValidationError } from './errors';
import {
  lifecycleStatusesFromQuery,
  parseLifecycleStatusQuery,
  recordMatchesLifecycleStatus,
  resolveLifecycleStatuses,
} from './lifecycle-filter';

describe('lifecycle-filter', () => {
  describe('resolveLifecycleStatuses', () => {
    it('defaults to ACTIVE only', () => {
      expect(resolveLifecycleStatuses(undefined)).toEqual([STATUS.ACTIVE]);
      expect(resolveLifecycleStatuses('ACTIVE')).toEqual([STATUS.ACTIVE]);
    });

    it('maps INACTIVE, DELETED, and ALL', () => {
      expect(resolveLifecycleStatuses('INACTIVE')).toEqual([STATUS.INACTIVE]);
      expect(resolveLifecycleStatuses('DELETED')).toEqual([STATUS.DELETED]);
      expect(resolveLifecycleStatuses('ALL')).toEqual([STATUS.ACTIVE, STATUS.INACTIVE]);
    });

    it('ALL excludes DELETED', () => {
      const all = resolveLifecycleStatuses('ALL');
      expect(all).not.toContain(STATUS.DELETED);
    });
  });

  describe('parseLifecycleStatusQuery', () => {
    it('accepts case-insensitive values', () => {
      expect(parseLifecycleStatusQuery('inactive')).toBe('INACTIVE');
      expect(parseLifecycleStatusQuery(' all ')).toBe('ALL');
    });

    it('rejects invalid status values', () => {
      expect(() => parseLifecycleStatusQuery('DRAFT')).toThrow(ValidationError);
      expect(() => parseLifecycleStatusQuery('UNKNOWN')).toThrow(ValidationError);
      expect(() => parseLifecycleStatusQuery('deletedd')).toThrow(ValidationError);
    });
  });

  describe('lifecycleStatusesFromQuery', () => {
    it('omitted status resolves to ACTIVE', () => {
      expect(lifecycleStatusesFromQuery(undefined)).toEqual([STATUS.ACTIVE]);
    });
  });

  describe('recordMatchesLifecycleStatus', () => {
    it('matches when status is in allowed set', () => {
      expect(recordMatchesLifecycleStatus(STATUS.DELETED, [STATUS.DELETED])).toBe(true);
      expect(recordMatchesLifecycleStatus(STATUS.DELETED, [STATUS.ACTIVE, STATUS.INACTIVE])).toBe(false);
    });
  });
});
