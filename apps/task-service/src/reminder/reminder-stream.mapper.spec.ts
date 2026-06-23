import type { PatientQuietWindow } from '@api-hub/task-core';

import {
  deriveCancelReason,
  mapMetaToCancelRequest,
  mapMetaToRegisterRequest,
  type TaskMetaStreamImage,
} from './reminder-stream.mapper';

describe('reminder-stream.mapper', () => {
  const dueWindowStart = new Date('2028-06-22T08:00:00.000Z').getTime();
  const dueWindowEnd = new Date('2028-06-22T23:00:00.000Z').getTime();

  const baseMeta: TaskMetaStreamImage = {
    entityType: 'RuntimeTaskInstance',
    runtimeTaskInstanceId: 'task-1',
    orgId: 'org-1',
    patientId: 'pat-1',
    reminderEnabled: true,
    reminderSettings: { channels: ['push'] },
    currentState: 'open',
    dueWindowStart,
    dueWindowEnd,
  };

  describe('mapMetaToRegisterRequest', () => {
    it('returns scheduledAt = dueWindowEnd (backward compat, no offset, no quiet window)', () => {
      const result = mapMetaToRegisterRequest(baseMeta, 'corr-1', null);
      expect(result).not.toBeNull();
      expect(result?.runtimeTaskInstanceId).toBe('task-1');
      expect(result?.patientId).toBe('pat-1');
      expect(result?.orgId).toBe('org-1');
      expect(result?.scheduledAt).toBe(dueWindowEnd);
      expect(result?.channel).toBe('push');
      expect(result?.correlationId).toBe('corr-1');
    });

    it('applies negative offsetMs (1 hour before dueWindowEnd)', () => {
      const meta: TaskMetaStreamImage = {
        ...baseMeta,
        reminderSettings: { channels: ['push'], offsetMs: -3_600_000 },
      };
      const result = mapMetaToRegisterRequest(meta, undefined, null);
      expect(result?.scheduledAt).toBe(dueWindowEnd! - 3_600_000);
    });

    it('uses dueWindowStart anchor when scheduleAnchor is dueWindowStart', () => {
      const meta: TaskMetaStreamImage = {
        ...baseMeta,
        reminderSettings: { channels: ['push'], scheduleAnchor: 'dueWindowStart' },
      };
      const result = mapMetaToRegisterRequest(meta, undefined, null);
      expect(result?.scheduledAt).toBe(dueWindowStart);
    });

    it('clamps to dueWindowEnd when offset overshoots', () => {
      const meta: TaskMetaStreamImage = {
        ...baseMeta,
        reminderSettings: {
          channels: ['push'],
          scheduleAnchor: 'dueWindowStart',
          offsetMs: 24 * 3_600_000,
        },
      };
      const result = mapMetaToRegisterRequest(meta, undefined, null);
      expect(result?.scheduledAt).toBe(dueWindowEnd);
    });

    it('falls back to dueWindowStart when dueWindowEnd is absent', () => {
      const meta: TaskMetaStreamImage = {
        ...baseMeta,
        dueWindowEnd: undefined,
        reminderSettings: { channels: ['push'] },
      };
      const result = mapMetaToRegisterRequest(meta, undefined, null);
      expect(result?.scheduledAt).toBe(dueWindowStart);
    });

    it('returns null when no channel is configured', () => {
      const meta: TaskMetaStreamImage = { ...baseMeta, reminderSettings: { channels: [] } };
      const result = mapMetaToRegisterRequest(meta, undefined, null);
      expect(result).toBeNull();
    });

    it('returns null when reminderSettings has no channels', () => {
      const meta: TaskMetaStreamImage = { ...baseMeta, reminderSettings: {} };
      const result = mapMetaToRegisterRequest(meta, undefined, null);
      expect(result).toBeNull();
    });

    it('returns null when both due window values are absent', () => {
      const meta: TaskMetaStreamImage = {
        ...baseMeta,
        dueWindowStart: undefined,
        dueWindowEnd: undefined,
      };
      const result = mapMetaToRegisterRequest(meta, undefined, null);
      expect(result).toBeNull();
    });

    it('adjusts scheduledAt when target falls inside quiet hours', () => {
      // Use future dates so Date.now() clamp does not override quiet-hours adjustment
      const dueEnd = new Date('2028-06-22T23:00:00.000Z').getTime();
      const dueStart = new Date('2028-06-22T08:00:00.000Z').getTime();
      const meta: TaskMetaStreamImage = {
        ...baseMeta,
        dueWindowStart: dueStart,
        dueWindowEnd: dueEnd,
        reminderSettings: {
          channels: ['push'],
          quietHoursRespected: true,
          quietHoursBufferMs: 300_000,
        },
      };
      const quietWindow: PatientQuietWindow = {
        timezone: 'UTC',
        startLocalMinutes: 22 * 60,
        endLocalMinutes: 7 * 60,
      };
      const result = mapMetaToRegisterRequest(meta, undefined, quietWindow);
      const quietStart = new Date('2028-06-22T22:00:00.000Z').getTime();
      expect(result?.scheduledAt).toBe(quietStart - 300_000);
    });

    it('does not adjust when quiet window is null even if quietHoursRespected is true', () => {
      const dueEnd = new Date('2026-06-22T23:00:00.000Z').getTime();
      const dueStart = new Date('2026-06-22T08:00:00.000Z').getTime();
      const meta: TaskMetaStreamImage = {
        ...baseMeta,
        dueWindowStart: dueStart,
        dueWindowEnd: dueEnd,
        reminderSettings: { channels: ['push'], quietHoursRespected: true },
      };
      const result = mapMetaToRegisterRequest(meta, undefined, null);
      expect(result?.scheduledAt).toBe(dueEnd);
    });

    it('works without explicit quietWindow argument (defaults to no adjustment)', () => {
      const result = mapMetaToRegisterRequest(baseMeta, 'corr-1');
      expect(result?.scheduledAt).toBe(dueWindowEnd);
    });
  });

  describe('deriveCancelReason', () => {
    it('returns remindersDisabled when reminderEnabled is false', () => {
      expect(deriveCancelReason({ ...baseMeta, reminderEnabled: false })).toBe('remindersDisabled');
    });

    it('returns taskTerminalState for terminal currentState', () => {
      expect(
        deriveCancelReason({ ...baseMeta, reminderEnabled: true, currentState: 'completed' }),
      ).toBe('taskTerminalState:completed');
    });

    it('returns unknown when neither condition matches', () => {
      const meta: TaskMetaStreamImage = {
        ...baseMeta,
        reminderEnabled: true,
        currentState: undefined,
      };
      expect(deriveCancelReason(meta)).toBe('unknown');
    });
  });

  describe('mapMetaToCancelRequest', () => {
    it('maps META to cancel request with remindersDisabled reason', () => {
      expect(mapMetaToCancelRequest({ ...baseMeta, reminderEnabled: false })).toEqual({
        runtimeTaskInstanceId: 'task-1',
        patientId: 'pat-1',
        orgId: 'org-1',
        reason: 'remindersDisabled',
      });
    });
  });
});
