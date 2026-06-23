import type { ReminderChannel, ReminderHistoryEntry } from '../models/types/task-domain.types';
import { REMINDER_STATUS } from '../models/types/task-domain.types';

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

/** Stable business id for one scheduled reminder attempt. */
export function buildReminderRecordId(
  runtimeTaskInstanceId: string,
  scheduledAt: number,
  channel: string,
): string {
  const sanitizedChannel = channel.replace(/[^0-9a-zA-Z-_.]/g, '-');
  return `rem-${runtimeTaskInstanceId}-${scheduledAt}-${sanitizedChannel}`;
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
  const entry: Omit<ReminderHistoryEntry, 'createdAt'> = {
    reminderRecordId: base.reminderRecordId,
    reminderStatus: outcome,
    ...(base.runtimeTaskInstanceId ? { runtimeTaskInstanceId: base.runtimeTaskInstanceId } : {}),
    ...(base.scheduledReminderAt != null ? { scheduledReminderAt: base.scheduledReminderAt } : {}),
    ...(base.reminderChannel ? { reminderChannel: base.reminderChannel } : {}),
    ...(base.schedulerJobId ? { schedulerJobId: base.schedulerJobId } : {}),
    ...(outcome === REMINDER_STATUS.SENT && options?.sentAt != null
      ? { sentAt: options.sentAt }
      : {}),
    ...(outcome === REMINDER_STATUS.SUPPRESSED && options?.reason
      ? { suppressedReason: options.reason }
      : {}),
    ...(outcome === REMINDER_STATUS.FAILED && options?.reason
      ? { failureReason: options.reason }
      : {}),
  };

  return capReminderHistory([
    ...((reminderHistory ?? []) as ReminderHistoryEntry[]),
    buildReminderHistoryEntry(entry, nowMs),
  ]);
}
