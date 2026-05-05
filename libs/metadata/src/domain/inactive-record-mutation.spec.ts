/// <reference types="jest" />

import { STATUS } from '../constants';
import {
  assertPatchStatusAllowedForInactiveRecord,
  assertPostUpsertAllowedForLatestStatus,
  INACTIVE_RECORD_MUTATION_MESSAGE,
  ValidationError,
} from './errors';

describe('inactive record mutation guards', () => {
  describe('assertPostUpsertAllowedForLatestStatus', () => {
    it('does not throw when latest is ACTIVE', () => {
      expect(() =>
        assertPostUpsertAllowedForLatestStatus(STATUS.ACTIVE, undefined),
      ).not.toThrow();
      expect(() =>
        assertPostUpsertAllowedForLatestStatus(STATUS.ACTIVE, STATUS.INACTIVE),
      ).not.toThrow();
    });

    it('allows INACTIVE latest when body status is ACTIVE (reactivate via POST)', () => {
      expect(() =>
        assertPostUpsertAllowedForLatestStatus(STATUS.INACTIVE, STATUS.ACTIVE),
      ).not.toThrow();
    });

    it('rejects INACTIVE latest when body omits status', () => {
      expect(() =>
        assertPostUpsertAllowedForLatestStatus(STATUS.INACTIVE, undefined),
      ).toThrow(ValidationError);
    });

    it('rejects INACTIVE latest when body status is INACTIVE', () => {
      expect(() =>
        assertPostUpsertAllowedForLatestStatus(STATUS.INACTIVE, STATUS.INACTIVE),
      ).toThrow(ValidationError);
    });

    it('uses contract message and 400 for blocked POST upsert', () => {
      try {
        assertPostUpsertAllowedForLatestStatus(STATUS.INACTIVE, undefined);
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as ValidationError).message).toBe(INACTIVE_RECORD_MUTATION_MESSAGE);
        expect((e as ValidationError).statusCode).toBe(400);
      }
    });
  });

  describe('assertPatchStatusAllowedForInactiveRecord', () => {
    it('allows INACTIVE → ACTIVE', () => {
      expect(() =>
        assertPatchStatusAllowedForInactiveRecord(STATUS.INACTIVE, STATUS.ACTIVE),
      ).not.toThrow();
    });

    it('allows ACTIVE → INACTIVE', () => {
      expect(() =>
        assertPatchStatusAllowedForInactiveRecord(STATUS.ACTIVE, STATUS.INACTIVE),
      ).not.toThrow();
    });

    it('allows ACTIVE → ACTIVE', () => {
      expect(() =>
        assertPatchStatusAllowedForInactiveRecord(STATUS.ACTIVE, STATUS.ACTIVE),
      ).not.toThrow();
    });

    it('rejects INACTIVE → INACTIVE', () => {
      expect(() =>
        assertPatchStatusAllowedForInactiveRecord(STATUS.INACTIVE, STATUS.INACTIVE),
      ).toThrow(ValidationError);
    });
  });
});
