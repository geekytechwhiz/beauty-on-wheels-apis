import { SURFACE_SECTION, type SurfaceSection } from '../models/types/task-domain.types';
import type { RuntimeTaskState } from '../models/types/runtime-task-state.type';
import { RUNTIME_TASK_STATE } from '../models/types/runtime-task-state.type';
import { calendarDateKey, resolveDueWindowEndMs } from './task-time';

export type ActionCenterSurfaceFilter = SurfaceSection | 'all';

const HISTORY_STATES: RuntimeTaskState[] = [
  RUNTIME_TASK_STATE.COMPLETED,
  RUNTIME_TASK_STATE.DISMISSED,
  RUNTIME_TASK_STATE.CANCELLED,
];

export function isInProgressState(state: RuntimeTaskState): boolean {
  return (
    state === RUNTIME_TASK_STATE.OPEN ||
    state === RUNTIME_TASK_STATE.ACTIVE ||
    state === RUNTIME_TASK_STATE.SCHEDULED
  );
}

export type ActionCenterClassificationInput = {
  currentState: RuntimeTaskState;
  dueWindowStart?: number;
  dueWindowEnd?: number;
  displayAsChecklistItem?: boolean;
};

/** Primary Action Center section from state + StartDate/DueDate calendar rules. */
export function deriveActionCenterSurfaceSection(
  record: ActionCenterClassificationInput,
  timeZone: string,
  nowMs = Date.now(),
): SurfaceSection {
  if (HISTORY_STATES.includes(record.currentState)) {
    return SURFACE_SECTION.HISTORY;
  }
  if (record.currentState === RUNTIME_TASK_STATE.MISSED) {
    return SURFACE_SECTION.NEEDS_ATTENTION;
  }
  if (!isInProgressState(record.currentState)) {
    return SURFACE_SECTION.NEEDS_ATTENTION;
  }

  const todayKey = calendarDateKey(nowMs, timeZone);
  const endMs = resolveDueWindowEndMs(record.dueWindowStart, record.dueWindowEnd);

  if (record.dueWindowStart == null && endMs == null) {
    return SURFACE_SECTION.TODAY;
  }

  const startDateKey =
    record.dueWindowStart != null
      ? calendarDateKey(record.dueWindowStart, timeZone)
      : todayKey;
  const dueDateKey = calendarDateKey(endMs ?? record.dueWindowStart!, timeZone);

  if (todayKey < startDateKey) {
    return SURFACE_SECTION.UPCOMING;
  }
  if (todayKey >= startDateKey && todayKey <= dueDateKey) {
    return SURFACE_SECTION.TODAY;
  }
  return SURFACE_SECTION.NEEDS_ATTENTION;
}

export function isCarePlanChecklistEligible(
  record: ActionCenterClassificationInput,
  primary: SurfaceSection,
): boolean {
  return record.displayAsChecklistItem === true && primary !== SURFACE_SECTION.HISTORY;
}

export function matchesActionCenterFilter(
  primary: SurfaceSection,
  record: ActionCenterClassificationInput,
  filter: ActionCenterSurfaceFilter,
): boolean {
  if (filter === 'all') {
    return true;
  }
  if (filter === SURFACE_SECTION.CARE_PLAN_CHECKLIST) {
    return isCarePlanChecklistEligible(record, primary);
  }
  return primary === filter;
}

export function emptyActionCenterSections(): Record<SurfaceSection, never[]> {
  return {
    [SURFACE_SECTION.TODAY]: [],
    [SURFACE_SECTION.UPCOMING]: [],
    [SURFACE_SECTION.NEEDS_ATTENTION]: [],
    [SURFACE_SECTION.HISTORY]: [],
    [SURFACE_SECTION.CARE_PLAN_CHECKLIST]: [],
  };
}

/** @deprecated Use deriveActionCenterSurfaceSection for Action Center; kept for internal legacy callers. */
export function deriveSurfaceSection(
  record: {
    currentState: RuntimeTaskState;
    dueWindowStart?: number;
    dueWindowEnd?: number;
    displayToPatient: boolean;
    displayAsChecklistItem?: boolean;
  },
  timeZone = 'UTC',
  nowMs = Date.now(),
): SurfaceSection {
  return deriveActionCenterSurfaceSection(
    {
      currentState: record.currentState,
      dueWindowStart: record.dueWindowStart,
      dueWindowEnd: record.dueWindowEnd,
      displayAsChecklistItem: record.displayAsChecklistItem,
    },
    timeZone,
    nowMs,
  );
}
