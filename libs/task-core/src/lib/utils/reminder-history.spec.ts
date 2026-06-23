import { REMINDER_STATUS } from '../models/types/task-domain.types';
import {
  appendCancelledReminderHistoryEntries,
  appendReminderOutcomeHistoryEntry,
  appendScheduledReminderHistoryEntry,
  buildReminderHistoryEntry,
  buildReminderRecordId,
  hasMatchingOpenScheduledEntry,
} from './reminder-history';

describe('buildReminderHistoryEntry', () => {
  it('sets createdAt and does not include updatedAt', () => {
    const nowMs = 1780581600000;
    const entry = buildReminderHistoryEntry(
      {
        reminderRecordId: 'rem-1',
        reminderStatus: REMINDER_STATUS.SCHEDULED,
        scheduledReminderAt: 1780578000000,
        reminderChannel: 'push',
      },
      nowMs,
    );

    expect(entry).toEqual({
      reminderRecordId: 'rem-1',
      reminderStatus: REMINDER_STATUS.SCHEDULED,
      scheduledReminderAt: 1780578000000,
      reminderChannel: 'push',
      createdAt: nowMs,
    });
    expect(entry).not.toHaveProperty('updatedAt');
  });
});

describe('appendCancelledReminderHistoryEntries', () => {
  it('appends cancelled audit rows without mutating scheduled entries', () => {
    const nowMs = 1780581600000;
    const scheduled = {
      reminderRecordId: 'rem-1',
      reminderStatus: REMINDER_STATUS.SCHEDULED,
      scheduledReminderAt: 1780578000000,
      reminderChannel: 'push',
      createdAt: 1780554600000,
    };
    const sent = {
      reminderRecordId: 'rem-2',
      reminderStatus: REMINDER_STATUS.SENT,
      createdAt: 1780578005000,
    };

    const result = appendCancelledReminderHistoryEntries([scheduled, sent], nowMs);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(scheduled);
    expect(result[1]).toEqual(sent);
    expect(result[2]).toEqual({
      ...scheduled,
      reminderStatus: REMINDER_STATUS.CANCELLED,
      createdAt: nowMs,
    });
    expect(result[2]).not.toHaveProperty('updatedAt');
  });

  it('returns a copy when there are no scheduled reminders to cancel', () => {
    const history = [
      {
        reminderRecordId: 'rem-2',
        reminderStatus: REMINDER_STATUS.SENT,
        createdAt: 1780578005000,
      },
    ];
    const result = appendCancelledReminderHistoryEntries(history, 1780581600000);

    expect(result).toEqual(history);
    expect(result).not.toBe(history);
  });
});

describe('buildReminderRecordId', () => {
  it('builds stable id from task, time, and channel', () => {
    expect(buildReminderRecordId('task-1', 1_700_000_360_000, 'push')).toBe(
      'rem-task-1-1700000360000-push',
    );
  });
});

describe('hasMatchingOpenScheduledEntry', () => {
  it('returns true when open scheduled matches', () => {
    expect(
      hasMatchingOpenScheduledEntry(
        [
          {
            reminderRecordId: 'rem-1',
            reminderStatus: REMINDER_STATUS.SCHEDULED,
            scheduledReminderAt: 1_700_000_360_000,
            reminderChannel: 'push',
            schedulerJobId: 'task-reminder-task-1',
            createdAt: 1,
          },
        ],
        1_700_000_360_000,
        'push',
        'task-reminder-task-1',
      ),
    ).toBe(true);
  });
});

describe('appendScheduledReminderHistoryEntry', () => {
  it('cancels open scheduled rows and appends a new scheduled entry', () => {
    const nowMs = 1780581600000;
    const existing = {
      reminderRecordId: 'rem-old',
      reminderStatus: REMINDER_STATUS.SCHEDULED,
      scheduledReminderAt: 1780578000000,
      reminderChannel: 'push',
      schedulerJobId: 'task-reminder-task-1',
      createdAt: 1780554600000,
    };

    const result = appendScheduledReminderHistoryEntry(
      [existing],
      {
        reminderRecordId: 'rem-new',
        runtimeTaskInstanceId: 'task-1',
        scheduledAt: 1_700_000_360_000,
        channel: 'push',
        schedulerJobId: 'task-reminder-task-1',
      },
      nowMs,
    );

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(existing);
    expect(result[1].reminderStatus).toBe(REMINDER_STATUS.CANCELLED);
    expect(result[2]).toMatchObject({
      reminderRecordId: 'rem-new',
      reminderStatus: REMINDER_STATUS.SCHEDULED,
      scheduledReminderAt: 1_700_000_360_000,
      schedulerJobId: 'task-reminder-task-1',
    });
  });
});

describe('appendReminderOutcomeHistoryEntry', () => {
  it('appends sent row with sentAt', () => {
    const nowMs = 1780581600000;
    const result = appendReminderOutcomeHistoryEntry(
      [],
      {
        reminderRecordId: 'rem-1',
        scheduledReminderAt: 1_700_000_360_000,
        reminderChannel: 'push',
        schedulerJobId: 'task-reminder-task-1',
      },
      REMINDER_STATUS.SENT,
      nowMs,
      { sentAt: nowMs },
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      reminderStatus: REMINDER_STATUS.SENT,
      sentAt: nowMs,
    });
  });

  it('appends suppressed row with reason', () => {
    const result = appendReminderOutcomeHistoryEntry(
      [],
      { reminderRecordId: 'rem-1' },
      REMINDER_STATUS.SUPPRESSED,
      1780581600000,
      { reason: 'remindersDisabled' },
    );

    expect(result[0]).toMatchObject({
      reminderStatus: REMINDER_STATUS.SUPPRESSED,
      suppressedReason: 'remindersDisabled',
    });
  });
});
