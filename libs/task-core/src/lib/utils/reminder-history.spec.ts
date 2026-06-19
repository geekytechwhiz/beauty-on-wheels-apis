import { REMINDER_STATUS } from '../models/types/task-domain.types';
import {
  appendCancelledReminderHistoryEntries,
  buildReminderHistoryEntry,
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
