import type { ReminderSettings } from '../models/types/task-domain.types';
import { REMINDER_SCHEDULE_ANCHOR } from '../models/types/task-domain.types';

/** Patient-specific quiet hours window. Resolved by the calling service (not stored here). */
export interface PatientQuietWindow {
  /** IANA timezone identifier, e.g. `"America/New_York"`. */
  timezone: string;
  /** Local minutes-of-day when quiet starts, e.g. `22 * 60 = 1320` for 22:00. */
  startLocalMinutes: number;
  /** Local minutes-of-day when quiet ends, e.g. `7 * 60 = 420` for 07:00. */
  endLocalMinutes: number;
}

export interface ResolveReminderScheduleResult {
  /** Final epoch ms for EventBridge Scheduler — after offset and quiet-hours clamp. */
  scheduledAt: number;
  /** Raw epoch ms = anchor + offsetMs, before quiet-hours adjustment. */
  targetAt: number;
  /** `true` when the target was inside quiet hours and was moved. */
  adjustedForQuietHours: boolean;
}

/** Default ms to fire before quiet-hours start when clamping (5 minutes). */
const DEFAULT_QUIET_HOURS_BUFFER_MS = 300_000;

/**
 * Returns the local minutes-of-day (0–1439) for a given epoch ms in the given IANA timezone.
 * Uses native `Intl.DateTimeFormat` — no third-party library required.
 */
export function localMinutesOfDay(epochMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date(epochMs));

  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  const normalizedHour = hour === 24 ? 0 : hour;
  return normalizedHour * 60 + minute;
}

/**
 * Returns `true` when the given epoch ms falls inside the patient's quiet window.
 * Handles overnight spans where `startLocalMinutes > endLocalMinutes` (e.g. 22:00–07:00).
 */
export function isInQuietHours(epochMs: number, window: PatientQuietWindow): boolean {
  const localMin = localMinutesOfDay(epochMs, window.timezone);
  const { startLocalMinutes: start, endLocalMinutes: end } = window;

  if (start === end) return false;

  if (start < end) {
    // Same-day window, e.g. 14:00–16:00
    return localMin >= start && localMin < end;
  }

  // Overnight window, e.g. 22:00–07:00 (start > end)
  return localMin >= start || localMin < end;
}

/**
 * Returns the epoch ms of the most recent quiet-hours start boundary at or before `epochMs`.
 * Used to position the send just before that boundary (minus buffer).
 *
 * "Most recent quiet-hours start" means the latest occurrence of `startLocalMinutes` that is
 * at or before `epochMs` in the patient's local timezone.
 */
export function quietWindowStartMs(epochMs: number, window: PatientQuietWindow): number {
  const localMin = localMinutesOfDay(epochMs, window.timezone);
  const startMin = window.startLocalMinutes;

  // How many minutes ago did quiet start?
  let minutesSinceStart: number;
  if (localMin >= startMin) {
    minutesSinceStart = localMin - startMin;
  } else {
    // Quiet started yesterday (overnight window)
    minutesSinceStart = 1440 - startMin + localMin;
  }

  return epochMs - minutesSinceStart * 60_000;
}

/**
 * Resolves the final EventBridge Scheduler fire time for a task reminder.
 *
 * Algorithm:
 * 1. Pick anchor from `scheduleAnchor` setting (default `dueWindowEnd`).
 * 2. Apply `targetAt = anchor + (offsetMs ?? 0)`.
 * 3. If `quietHoursRespected && quietWindow` and target is inside quiet hours,
 *    shift back to `quietWindowStart - quietHoursBufferMs`.
 * 4. Clamp: no earlier than `nowMs + 60s`, no later than `dueWindowEnd`, no earlier than `dueWindowStart`.
 *
 * Returns `null` when no anchor can be resolved (both due-window values absent).
 */
export function resolveReminderScheduleAt(
  dueWindowStart: number | undefined,
  dueWindowEnd: number | undefined,
  reminderSettings: ReminderSettings | undefined,
  quietWindow: PatientQuietWindow | null,
  nowMs?: number,
): ResolveReminderScheduleResult | null {
  const settings = reminderSettings ?? {};
  const anchor =
    settings.scheduleAnchor === REMINDER_SCHEDULE_ANCHOR.DUE_WINDOW_START
      ? dueWindowStart
      : dueWindowEnd ?? dueWindowStart;

  if (anchor == null || !Number.isFinite(anchor)) {
    return null;
  }

  const offsetMs = typeof settings.offsetMs === 'number' ? settings.offsetMs : 0;
  const targetAt = anchor + offsetMs;

  let scheduledAt = targetAt;
  let adjustedForQuietHours = false;

  if (settings.quietHoursRespected && quietWindow) {
    if (isInQuietHours(targetAt, quietWindow)) {
      const bufferMs =
        typeof settings.quietHoursBufferMs === 'number'
          ? settings.quietHoursBufferMs
          : DEFAULT_QUIET_HOURS_BUFFER_MS;
      scheduledAt = quietWindowStartMs(targetAt, quietWindow) - bufferMs;
      adjustedForQuietHours = true;
    }
  }

  // Clamp: must not be in the past (allow at least 60s from now)
  const effectiveNow = (nowMs != null && Number.isFinite(nowMs) ? nowMs : Date.now()) + 60_000;
  scheduledAt = Math.max(scheduledAt, effectiveNow);

  // Clamp to due window boundaries
  if (dueWindowEnd != null && Number.isFinite(dueWindowEnd)) {
    scheduledAt = Math.min(scheduledAt, dueWindowEnd);
  }
  if (dueWindowStart != null && Number.isFinite(dueWindowStart)) {
    scheduledAt = Math.max(scheduledAt, dueWindowStart);
  }

  // Due-window clamp may pull the time into the past when the window has already ended.
  scheduledAt = Math.max(scheduledAt, effectiveNow);

  return { scheduledAt, targetAt, adjustedForQuietHours };
}
