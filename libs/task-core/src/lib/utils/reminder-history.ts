import type { ReminderHistoryEntry } from '../models/types/task-domain.types';
import { REMINDER_STATUS } from '../models/types/task-domain.types';

/** Creates a new append-only reminderHistory row (createdAt only — no updatedAt). */
export function buildReminderHistoryEntry(
  entry: Omit<ReminderHistoryEntry, 'createdAt'> & { createdAt?: number },
  nowMs: number,
): ReminderHistoryEntry {
  return {
    ...entry,
    createdAt: entry.createdAt ?? nowMs,
  };
}

/**
 * Appends cancelled audit rows for open scheduled reminders.
 * Existing LOOKUP reminderHistory entries are never mutated — audit is append-only.
 */
export function appendCancelledReminderHistoryEntries(
  reminderHistory: readonly unknown[] | undefined,
  nowMs: number,
): ReminderHistoryEntry[] {
  const history: ReminderHistoryEntry[] = [...((reminderHistory ?? []) as ReminderHistoryEntry[])];

  for (const entry of reminderHistory ?? []) {
    const record = entry as ReminderHistoryEntry;
    if (record.reminderStatus !== REMINDER_STATUS.SCHEDULED) {
      continue;
    }

    const { createdAt: _scheduledCreatedAt, ...base } = record;
    history.push(
      buildReminderHistoryEntry(
        {
          ...base,
          reminderStatus: REMINDER_STATUS.CANCELLED,
        },
        nowMs,
      ),
    );
  }

  return history;
}
