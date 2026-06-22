import {
  buildProcessReminderTargetInput,
  buildReminderScheduleName,
  isSchedulerEligibleFireTime,
  toSchedulerAtExpression,
} from './reminder-scheduler.schedule';

describe('reminder-scheduler.schedule', () => {
  describe('buildReminderScheduleName', () => {
    it('prefixes and sanitizes runtime task id', () => {
      expect(buildReminderScheduleName('rtask/abc:001')).toBe('task-reminder-rtask-abc-001');
    });

    it('truncates to 64 characters', () => {
      const longId = 'x'.repeat(80);
      expect(buildReminderScheduleName(longId)).toHaveLength(64);
      expect(buildReminderScheduleName(longId).startsWith('task-reminder-')).toBe(true);
    });
  });

  describe('toSchedulerAtExpression', () => {
    it('formats UTC at() expression without fractional seconds', () => {
      const epochMs = Date.parse('2026-06-22T15:30:00.000Z');
      expect(toSchedulerAtExpression(epochMs)).toBe('at(2026-06-22T15:30:00)');
    });
  });

  describe('isSchedulerEligibleFireTime', () => {
    it('returns false when fire time is within one minute', () => {
      const now = 1_700_000_000_000;
      expect(isSchedulerEligibleFireTime(now + 30_000, now)).toBe(false);
    });

    it('returns true when fire time is at least one minute ahead', () => {
      const now = 1_700_000_000_000;
      expect(isSchedulerEligibleFireTime(now + 60_000, now)).toBe(true);
    });
  });

  describe('buildProcessReminderTargetInput', () => {
    it('maps register request to scheduler callback payload', () => {
      expect(
        buildProcessReminderTargetInput(
          {
            runtimeTaskInstanceId: 'task-1',
            patientId: 'pat-1',
            orgId: 'org-1',
            scheduledAt: 1_700_000_360_000,
            channel: 'push',
            correlationId: 'corr-1',
          },
          'task-reminder-task-1',
        ),
      ).toEqual({
        runtimeTaskInstanceId: 'task-1',
        patientId: 'pat-1',
        orgId: 'org-1',
        scheduledAt: 1_700_000_360_000,
        channel: 'push',
        schedulerJobId: 'task-reminder-task-1',
      });
    });
  });
});
