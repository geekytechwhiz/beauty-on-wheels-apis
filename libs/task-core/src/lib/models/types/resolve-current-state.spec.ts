import { RUNTIME_TASK_STATE } from './runtime-task-state.type';
import {
  normalizePersistedState,
  resolveCurrentStateForWire,
} from './runtime-task-state.type';

const TZ = 'UTC';
const NOW = Date.parse('2026-06-05T12:00:00.000Z');

function day(iso: string): number {
  return Date.parse(iso);
}

describe('normalizePersistedState', () => {
  it('maps legacy open and active to scheduled', () => {
    expect(normalizePersistedState('open')).toBe(RUNTIME_TASK_STATE.SCHEDULED);
    expect(normalizePersistedState(RUNTIME_TASK_STATE.ACTIVE)).toBe(RUNTIME_TASK_STATE.SCHEDULED);
    expect(normalizePersistedState(RUNTIME_TASK_STATE.SCHEDULED)).toBe(RUNTIME_TASK_STATE.SCHEDULED);
  });
});

describe('resolveCurrentStateForWire', () => {
  it('passes through terminal persisted states', () => {
    expect(
      resolveCurrentStateForWire({
        persistedState: RUNTIME_TASK_STATE.COMPLETED,
        timeZone: TZ,
        nowMs: NOW,
      }),
    ).toBe(RUNTIME_TASK_STATE.COMPLETED);
  });

  it('derives scheduled when today is before StartDate', () => {
    expect(
      resolveCurrentStateForWire({
        persistedState: RUNTIME_TASK_STATE.SCHEDULED,
        dueWindowStart: day('2026-06-10T08:00:00.000Z'),
        dueWindowEnd: day('2026-06-12T08:00:00.000Z'),
        timeZone: TZ,
        nowMs: NOW,
      }),
    ).toBe(RUNTIME_TASK_STATE.SCHEDULED);
  });

  it('derives active when today is within the due window', () => {
    expect(
      resolveCurrentStateForWire({
        persistedState: RUNTIME_TASK_STATE.SCHEDULED,
        dueWindowStart: day('2026-06-05T08:00:00.000Z'),
        dueWindowEnd: day('2026-06-07T08:00:00.000Z'),
        timeZone: TZ,
        nowMs: NOW,
      }),
    ).toBe(RUNTIME_TASK_STATE.ACTIVE);
  });

  it('derives missed when today is after DueDate', () => {
    expect(
      resolveCurrentStateForWire({
        persistedState: RUNTIME_TASK_STATE.SCHEDULED,
        dueWindowStart: day('2026-06-01T08:00:00.000Z'),
        dueWindowEnd: day('2026-06-03T08:00:00.000Z'),
        timeZone: TZ,
        nowMs: NOW,
      }),
    ).toBe(RUNTIME_TASK_STATE.MISSED);
  });
});
