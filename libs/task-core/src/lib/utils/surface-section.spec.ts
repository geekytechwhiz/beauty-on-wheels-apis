import { SURFACE_SECTION } from '../models/types/task-domain.types';
import { RUNTIME_TASK_STATE } from '../models/types/runtime-task-state.type';
import {
  deriveActionCenterSurfaceSection,
  isCarePlanChecklistEligible,
  matchesActionCenterFilter,
} from './surface-section';

const TZ = 'UTC';

/** 2026-06-05 12:00:00 UTC */
const NOW = Date.parse('2026-06-05T12:00:00.000Z');

function day(ms: string): number {
  return Date.parse(ms);
}

describe('deriveActionCenterSurfaceSection', () => {
  it('classifies completed, dismissed, cancelled as history', () => {
    for (const state of [
      RUNTIME_TASK_STATE.COMPLETED,
      RUNTIME_TASK_STATE.DISMISSED,
      RUNTIME_TASK_STATE.CANCELLED,
    ]) {
      expect(
        deriveActionCenterSurfaceSection(
          { currentState: state, dueWindowStart: day('2026-06-05T08:00:00.000Z') },
          TZ,
          NOW,
        ),
      ).toBe(SURFACE_SECTION.HISTORY);
    }
  });

  it('classifies persisted scheduled past due as needsAttention (wire missed)', () => {
    expect(
      deriveActionCenterSurfaceSection(
        {
          currentState: RUNTIME_TASK_STATE.SCHEDULED,
          dueWindowStart: day('2026-06-01T08:00:00.000Z'),
          dueWindowEnd: day('2026-06-03T08:00:00.000Z'),
        },
        TZ,
        NOW,
      ),
    ).toBe(SURFACE_SECTION.NEEDS_ATTENTION);
  });

  it('classifies not-yet-started persisted scheduled as upcoming', () => {
    expect(
      deriveActionCenterSurfaceSection(
        {
          currentState: RUNTIME_TASK_STATE.SCHEDULED,
          dueWindowStart: day('2026-06-10T08:00:00.000Z'),
          dueWindowEnd: day('2026-06-12T08:00:00.000Z'),
        },
        TZ,
        NOW,
      ),
    ).toBe(SURFACE_SECTION.UPCOMING);
  });

  it('classifies in-window persisted scheduled as today (wire active)', () => {
    expect(
      deriveActionCenterSurfaceSection(
        {
          currentState: RUNTIME_TASK_STATE.SCHEDULED,
          dueWindowStart: day('2026-06-05T08:00:00.000Z'),
          dueWindowEnd: day('2026-06-07T08:00:00.000Z'),
        },
        TZ,
        NOW,
      ),
    ).toBe(SURFACE_SECTION.TODAY);
  });

  it('classifies last-day-only task as today on due day', () => {
    expect(
      deriveActionCenterSurfaceSection(
        {
          currentState: RUNTIME_TASK_STATE.SCHEDULED,
          dueWindowStart: day('2026-06-05T08:00:00.000Z'),
          dueWindowEnd: day('2026-06-05T20:00:00.000Z'),
        },
        TZ,
        NOW,
      ),
    ).toBe(SURFACE_SECTION.TODAY);
  });
});

describe('carePlanChecklist eligibility', () => {
  it('includes checklist items only when displayAsChecklistItem and not history', () => {
    expect(
      isCarePlanChecklistEligible(
        {
          currentState: RUNTIME_TASK_STATE.SCHEDULED,
          dueWindowStart: day('2026-06-05T08:00:00.000Z'),
          dueWindowEnd: day('2026-06-07T08:00:00.000Z'),
          displayAsChecklistItem: true,
        },
        SURFACE_SECTION.TODAY,
      ),
    ).toBe(true);
    expect(
      isCarePlanChecklistEligible(
        {
          currentState: RUNTIME_TASK_STATE.COMPLETED,
          displayAsChecklistItem: true,
        },
        SURFACE_SECTION.HISTORY,
      ),
    ).toBe(false);
  });

  it('matches carePlanChecklist filter', () => {
    expect(
      matchesActionCenterFilter(
        SURFACE_SECTION.TODAY,
        {
          currentState: RUNTIME_TASK_STATE.SCHEDULED,
          dueWindowStart: day('2026-06-05T08:00:00.000Z'),
          dueWindowEnd: day('2026-06-07T08:00:00.000Z'),
          displayAsChecklistItem: true,
        },
        SURFACE_SECTION.CARE_PLAN_CHECKLIST,
      ),
    ).toBe(true);
    expect(
      matchesActionCenterFilter(
        SURFACE_SECTION.TODAY,
        {
          currentState: RUNTIME_TASK_STATE.SCHEDULED,
          dueWindowStart: day('2026-06-05T08:00:00.000Z'),
          dueWindowEnd: day('2026-06-07T08:00:00.000Z'),
          displayAsChecklistItem: false,
        },
        SURFACE_SECTION.CARE_PLAN_CHECKLIST,
      ),
    ).toBe(false);
  });
});
