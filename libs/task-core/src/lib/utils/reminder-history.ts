import type { ReminderChannel, ReminderHistoryEntry } from '../models/types/task-domain.types';
import { REMINDER_STATUS } from '../models/types/task-domain.types';

import { omitUndefined } from './omit-undefined';

export const REMINDER_HISTORY_MAX_LENGTH = 50;

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

export function capReminderHistory(
  reminderHistory: ReminderHistoryEntry[],
  maxLength = REMINDER_HISTORY_MAX_LENGTH,
): ReminderHistoryEntry[] {
  if (reminderHistory.length <= maxLength) {
    return reminderHistory;
  }
  return reminderHistory.slice(reminderHistory.length - maxLength);
}

export function hasMatchingOpenScheduledEntry(
  reminderHistory: readonly unknown[] | undefined,
  scheduledAt: number,
  channel: string,
  schedulerJobId?: string,
): boolean {
  for (const entry of reminderHistory ?? []) {
    const record = entry as ReminderHistoryEntry;
    if (record.reminderStatus !== REMINDER_STATUS.SCHEDULED) {
      continue;
    }
    if (record.scheduledReminderAt !== scheduledAt) {
      continue;
    }
    if (record.reminderChannel !== channel) {
      continue;
    }
    if (schedulerJobId != null && record.schedulerJobId !== schedulerJobId) {
      continue;
    }
    return true;
  }
  return false;
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

export function appendScheduledReminderHistoryEntry(
  reminderHistory: readonly unknown[] | undefined,
  entry: {
    reminderRecordId: string;
    runtimeTaskInstanceId: string;
    scheduledAt: number;
    channel: string;
    schedulerJobId: string;
  },
  nowMs: number,
): ReminderHistoryEntry[] {
  const withCancelled = appendCancelledReminderHistoryEntries(reminderHistory, nowMs);
  return capReminderHistory([
    ...withCancelled,
    buildReminderHistoryEntry(
      {
        reminderRecordId: entry.reminderRecordId,
        runtimeTaskInstanceId: entry.runtimeTaskInstanceId,
        scheduledReminderAt: entry.scheduledAt,
        reminderChannel: entry.channel as ReminderChannel,
        reminderStatus: REMINDER_STATUS.SCHEDULED,
        schedulerJobId: entry.schedulerJobId,
      },
      nowMs,
    ),
  ]);
}

export function findOpenScheduledReminderEntries(
  reminderHistory: readonly unknown[] | undefined,
): ReminderHistoryEntry[] {
  return (reminderHistory ?? [])
    .filter((entry) => (entry as ReminderHistoryEntry).reminderStatus === REMINDER_STATUS.SCHEDULED)
    .map((entry) => entry as ReminderHistoryEntry);
}

export function appendReminderOutcomeHistoryEntry(
  reminderHistory: readonly unknown[] | undefined,
  base: {
    reminderRecordId: string;
    runtimeTaskInstanceId?: string;
    scheduledReminderAt?: number;
    reminderChannel?: ReminderChannel;
    schedulerJobId?: string;
  },
  outcome: typeof REMINDER_STATUS.SENT | typeof REMINDER_STATUS.SUPPRESSED | typeof REMINDER_STATUS.FAILED,
  nowMs: number,
  options?: { sentAt?: number; reason?: string },
): ReminderHistoryEntry[] {
  const entry = omitUndefined({
    reminderRecordId: base.reminderRecordId,
    reminderStatus: outcome,
    runtimeTaskInstanceId: base.runtimeTaskInstanceId,
    scheduledReminderAt: base.scheduledReminderAt ?? undefined,
    reminderChannel: base.reminderChannel ?? undefined,
    schedulerJobId: base.schedulerJobId,
    sentAt:
      outcome === REMINDER_STATUS.SENT && options?.sentAt != null ? options.sentAt : undefined,
    suppressedReason:
      outcome === REMINDER_STATUS.SUPPRESSED && options?.reason ? options.reason : undefined,
    failureReason:
      outcome === REMINDER_STATUS.FAILED && options?.reason ? options.reason : undefined,
  }) as Omit<ReminderHistoryEntry, 'createdAt'>;

  return capReminderHistory([
    ...((reminderHistory ?? []) as ReminderHistoryEntry[]),
    buildReminderHistoryEntry(entry, nowMs),
  ]);
}
