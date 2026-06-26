import {
  isInQuietHours,
  localMinutesOfDay,
  quietWindowStartMs,
  resolveReminderScheduleAt,
  type PatientQuietWindow,
} from './reminder-schedule';
import { nowEpochMs } from './task-time';

// Fixed epoch ms: 2026-06-22 14:00:00 UTC
const BASE_MS = 1750600800000;

// UTC+5:30 (IST) — no DST; 14:00 UTC = 19:30 IST
const IST_WINDOW: PatientQuietWindow = {
  timezone: 'Asia/Kolkata',
  startLocalMinutes: 22 * 60,      // 22:00 local
  endLocalMinutes: 7 * 60,         // 07:00 local
};

// UTC-5 (EST, fixed offset for test determinism)
const EST_WINDOW: PatientQuietWindow = {
  timezone: 'America/New_York',
  startLocalMinutes: 22 * 60,
  endLocalMinutes: 7 * 60,
};

// A same-day window (14:00–16:00 UTC)
const SAME_DAY_WINDOW: PatientQuietWindow = {
  timezone: 'UTC',
  startLocalMinutes: 14 * 60,
  endLocalMinutes: 16 * 60,
};

describe('localMinutesOfDay', () => {
  it('returns correct minutes for UTC', () => {
    // 2026-06-22 14:30:00 UTC
    const ms = new Date('2026-06-22T14:30:00.000Z').getTime();
    expect(localMinutesOfDay(ms, 'UTC')).toBe(14 * 60 + 30);
  });

  it('returns correct minutes for IST (UTC+5:30)', () => {
    // 2026-06-22 00:00:00 UTC = 05:30 IST
    const ms = new Date('2026-06-22T00:00:00.000Z').getTime();
    expect(localMinutesOfDay(ms, 'Asia/Kolkata')).toBe(5 * 60 + 30);
  });

  it('returns 0 for midnight local', () => {
    // 2026-06-21T18:30:00.000Z = 2026-06-22 00:00:00 IST
    const ms = new Date('2026-06-21T18:30:00.000Z').getTime();
    expect(localMinutesOfDay(ms, 'Asia/Kolkata')).toBe(0);
  });
});

describe('isInQuietHours', () => {
  it('returns false when window has equal start and end', () => {
    const w: PatientQuietWindow = { timezone: 'UTC', startLocalMinutes: 480, endLocalMinutes: 480 };
    expect(isInQuietHours(BASE_MS, w)).toBe(false);
  });

  it('detects same-day quiet window (inside)', () => {
    // BASE_MS = 14:00 UTC — inside 14:00–16:00
    expect(isInQuietHours(BASE_MS, SAME_DAY_WINDOW)).toBe(true);
  });

  it('detects same-day quiet window (outside)', () => {
    // 12:00 UTC — before 14:00
    const ms = new Date('2026-06-22T12:00:00.000Z').getTime();
    expect(isInQuietHours(ms, SAME_DAY_WINDOW)).toBe(false);
  });

  it('detects overnight quiet window (inside — after quiet start)', () => {
    // 22:30 UTC in IST = 04:00 IST next day → inside 22:00–07:00 IST
    const ms = new Date('2026-06-22T18:30:00.000Z').getTime(); // 00:00 IST June 23
    expect(isInQuietHours(ms, IST_WINDOW)).toBe(true); // 00:00 IST is inside quiet (00 < 07)
    const msQuiet = new Date('2026-06-22T01:00:00.000Z').getTime(); // 06:30 IST — inside quiet
    expect(isInQuietHours(msQuiet, IST_WINDOW)).toBe(true);
  });

  it('detects overnight quiet window (outside — afternoon)', () => {
    // 14:00 UTC = 19:30 IST — outside 22:00–07:00 IST
    expect(isInQuietHours(BASE_MS, IST_WINDOW)).toBe(false);
  });

  it('detects just before quiet-start as outside', () => {
    // 21:59 UTC = 03:29 IST+5:30 next day would not work; use UTC window
    const UTCWindow: PatientQuietWindow = { timezone: 'UTC', startLocalMinutes: 22 * 60, endLocalMinutes: 7 * 60 };
    const ms = new Date('2026-06-22T21:59:00.000Z').getTime();
    expect(isInQuietHours(ms, UTCWindow)).toBe(false);
  });

  it('detects quiet-start boundary as inside', () => {
    const UTCWindow: PatientQuietWindow = { timezone: 'UTC', startLocalMinutes: 22 * 60, endLocalMinutes: 7 * 60 };
    const ms = new Date('2026-06-22T22:00:00.000Z').getTime();
    expect(isInQuietHours(ms, UTCWindow)).toBe(true);
  });

  it('detects quiet-end boundary as outside (exclusive)', () => {
    const UTCWindow: PatientQuietWindow = { timezone: 'UTC', startLocalMinutes: 22 * 60, endLocalMinutes: 7 * 60 };
    const ms = new Date('2026-06-22T07:00:00.000Z').getTime();
    expect(isInQuietHours(ms, UTCWindow)).toBe(false);
  });
});

describe('quietWindowStartMs', () => {
  it('returns epoch ms of the most recent quiet start before the given time', () => {
    // 2026-06-22 23:00 UTC (inside quiet 22:00–07:00 UTC)
    const ms = new Date('2026-06-22T23:00:00.000Z').getTime();
    const UTCWindow: PatientQuietWindow = { timezone: 'UTC', startLocalMinutes: 22 * 60, endLocalMinutes: 7 * 60 };
    const result = quietWindowStartMs(ms, UTCWindow);
    const expected = new Date('2026-06-22T22:00:00.000Z').getTime();
    expect(result).toBe(expected);
  });

  it('returns yesterday quiet-start when inside overnight window in early morning', () => {
    // 2026-06-22 03:00 UTC — overnight window started at 22:00 UTC on June 21
    const ms = new Date('2026-06-22T03:00:00.000Z').getTime();
    const UTCWindow: PatientQuietWindow = { timezone: 'UTC', startLocalMinutes: 22 * 60, endLocalMinutes: 7 * 60 };
    const result = quietWindowStartMs(ms, UTCWindow);
    const expected = new Date('2026-06-21T22:00:00.000Z').getTime();
    expect(result).toBe(expected);
  });
});

describe('resolveReminderScheduleAt', () => {
  const dueWindowStart = new Date('2026-06-22T08:00:00.000Z').getTime();
  const dueWindowEnd = new Date('2026-06-22T17:00:00.000Z').getTime();
  // Use a nowMs well in the past so clamp does not fire in normal cases
  const nowMs = new Date('2026-06-22T00:00:00.000Z').getTime();

  describe('backward compatibility', () => {
    it('returns dueWindowEnd when no settings provided', () => {
      const result = resolveReminderScheduleAt(dueWindowStart, dueWindowEnd, undefined, null, nowMs);
      expect(result?.scheduledAt).toBe(dueWindowEnd);
      expect(result?.targetAt).toBe(dueWindowEnd);
      expect(result?.adjustedForQuietHours).toBe(false);
    });

    it('returns dueWindowEnd when offsetMs is 0', () => {
      const result = resolveReminderScheduleAt(dueWindowStart, dueWindowEnd, { offsetMs: 0 }, null, nowMs);
      expect(result?.scheduledAt).toBe(dueWindowEnd);
    });

    it('falls back to dueWindowStart when dueWindowEnd is absent', () => {
      const result = resolveReminderScheduleAt(dueWindowStart, undefined, undefined, null, nowMs);
      expect(result?.scheduledAt).toBe(dueWindowStart);
    });

    it('returns null when both due window values are absent', () => {
      const result = resolveReminderScheduleAt(undefined, undefined, undefined, null, nowMs);
      expect(result).toBeNull();
    });
  });

  describe('scheduleAnchor', () => {
    it('uses dueWindowEnd by default', () => {
      const result = resolveReminderScheduleAt(dueWindowStart, dueWindowEnd, {}, null, nowMs);
      expect(result?.scheduledAt).toBe(dueWindowEnd);
    });

    it('uses dueWindowStart when scheduleAnchor is dueWindowStart', () => {
      const result = resolveReminderScheduleAt(
        dueWindowStart, dueWindowEnd,
        { scheduleAnchor: 'dueWindowStart' },
        null,
        nowMs,
      );
      expect(result?.scheduledAt).toBe(dueWindowStart);
    });
  });

  describe('offsetMs', () => {
    it('applies negative offset (1 hour before dueWindowEnd)', () => {
      const result = resolveReminderScheduleAt(
        dueWindowStart, dueWindowEnd,
        { offsetMs: -3_600_000 },
        null,
        nowMs,
      );
      expect(result?.scheduledAt).toBe(dueWindowEnd - 3_600_000);
      expect(result?.targetAt).toBe(dueWindowEnd - 3_600_000);
    });

    it('applies positive offset (30 min after dueWindowStart anchor)', () => {
      const result = resolveReminderScheduleAt(
        dueWindowStart, dueWindowEnd,
        { scheduleAnchor: 'dueWindowStart', offsetMs: 30 * 60_000 },
        null,
        nowMs,
      );
      expect(result?.scheduledAt).toBe(dueWindowStart + 30 * 60_000);
    });

    it('clamps result to dueWindowEnd when offset overshoots', () => {
      const result = resolveReminderScheduleAt(
        dueWindowStart, dueWindowEnd,
        { scheduleAnchor: 'dueWindowStart', offsetMs: 24 * 3_600_000 }, // far future
        null,
        nowMs,
      );
      expect(result?.scheduledAt).toBe(dueWindowEnd);
    });

    it('clamps result to dueWindowStart when offset undershoots', () => {
      const result = resolveReminderScheduleAt(
        dueWindowStart, dueWindowEnd,
        { offsetMs: -24 * 3_600_000 }, // far past
        null,
        nowMs,
      );
      expect(result?.scheduledAt).toBe(dueWindowStart);
    });
  });

  describe('quiet hours — no adjustment when quietWindow is null', () => {
    it('does not adjust even when quietHoursRespected is true and window is null', () => {
      const result = resolveReminderScheduleAt(
        dueWindowStart, dueWindowEnd,
        { quietHoursRespected: true, offsetMs: 0 },
        null,
        nowMs,
      );
      expect(result?.scheduledAt).toBe(dueWindowEnd);
      expect(result?.adjustedForQuietHours).toBe(false);
    });
  });

  describe('quiet hours — UTC window', () => {
    const UTCWindow: PatientQuietWindow = {
      timezone: 'UTC',
      startLocalMinutes: 22 * 60, // 22:00 UTC
      endLocalMinutes: 7 * 60,    // 07:00 UTC
    };

    it('fires before quiet start when target is inside quiet hours', () => {
      // dueWindowEnd = 17:00 UTC but offset pushes into 23:00 UTC (inside quiet)
      const dueEnd = new Date('2026-06-22T22:30:00.000Z').getTime(); // 22:30 UTC — inside quiet
      const bufferMs = 5 * 60_000;
      const result = resolveReminderScheduleAt(
        nowMs, dueEnd,
        { quietHoursRespected: true, quietHoursBufferMs: bufferMs, offsetMs: 0 },
        UTCWindow,
        nowMs,
      );
      const quietStart = new Date('2026-06-22T22:00:00.000Z').getTime();
      expect(result?.adjustedForQuietHours).toBe(true);
      expect(result?.scheduledAt).toBe(quietStart - bufferMs);
    });

    it('uses default 5-minute buffer when quietHoursBufferMs is not set', () => {
      const dueEnd = new Date('2026-06-22T23:00:00.000Z').getTime();
      const result = resolveReminderScheduleAt(
        nowMs, dueEnd,
        { quietHoursRespected: true, offsetMs: 0 },
        UTCWindow,
        nowMs,
      );
      const quietStart = new Date('2026-06-22T22:00:00.000Z').getTime();
      expect(result?.adjustedForQuietHours).toBe(true);
      expect(result?.scheduledAt).toBe(quietStart - 300_000);
    });

    it('does not adjust when target is outside quiet hours', () => {
      // 15:00 UTC — outside 22:00–07:00 quiet
      const dueEnd = new Date('2026-06-22T15:00:00.000Z').getTime();
      const result = resolveReminderScheduleAt(
        nowMs, dueEnd,
        { quietHoursRespected: true },
        UTCWindow,
        nowMs,
      );
      expect(result?.adjustedForQuietHours).toBe(false);
      expect(result?.scheduledAt).toBe(dueEnd);
    });

    it('does not adjust when quietHoursRespected is false', () => {
      const dueEnd = new Date('2026-06-22T23:00:00.000Z').getTime();
      const result = resolveReminderScheduleAt(
        nowMs, dueEnd,
        { quietHoursRespected: false, offsetMs: 0 },
        UTCWindow,
        nowMs,
      );
      expect(result?.adjustedForQuietHours).toBe(false);
    });
  });

  describe('nowMs clamp', () => {
    it('does not schedule in the past', () => {
      const pastDue = new Date('2020-01-01T00:00:00.000Z').getTime();
      const result = resolveReminderScheduleAt(pastDue, pastDue, undefined, null);
      // scheduledAt should be at least nowMs + 60s (real clock)
      expect(result?.scheduledAt).toBeGreaterThan(nowEpochMs());
    });
  });
});
