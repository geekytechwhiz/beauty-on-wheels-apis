import { SURFACE_SECTION, type SurfaceSection } from '../models/types/task-domain.types';
import type { RuntimeTaskState } from '../models/types/runtime-task-state.type';
import {
  LEGACY_RUNTIME_TASK_STATE_OPEN,
  resolveCurrentStateForWire,
  RUNTIME_TASK_STATE,
} from '../models/types/runtime-task-state.type';
import { DEFAULT_ACTION_CENTER_TIMEZONE, nowEpochMs } from './task-time';

export type ActionCenterSurfaceFilter = SurfaceSection | 'all';

const HISTORY_WIRE_STATES: RuntimeTaskState[] = [
  RUNTIME_TASK_STATE.COMPLETED,
  RUNTIME_TASK_STATE.DISMISSED,
  RUNTIME_TASK_STATE.CANCELLED,
];

export function isInProgressState(state: RuntimeTaskState | string): boolean {
  return (
    state === RUNTIME_TASK_STATE.SCHEDULED ||
    state === RUNTIME_TASK_STATE.ACTIVE ||
    state === LEGACY_RUNTIME_TASK_STATE_OPEN
  );
}

export type ActionCenterClassificationInput = {
  /** Persisted META currentState. */
  currentState: RuntimeTaskState | string;
  dueWindowStart?: number;
  dueWindowEnd?: number;
  displayAsChecklistItem?: boolean;
};

function wireStateForClassification(
  record: ActionCenterClassificationInput,
  timeZone: string,
  nowMs: number,
): RuntimeTaskState {
  return resolveCurrentStateForWire({
    persistedState: record.currentState,
    dueWindowStart: record.dueWindowStart,
    dueWindowEnd: record.dueWindowEnd,
    timeZone,
    nowMs,
  });
}

/** Primary Action Center section from wire state + schedule context. */
export function deriveActionCenterSurfaceSection(
  record: ActionCenterClassificationInput,
  timeZone: string,
  nowMs = nowEpochMs(),
): SurfaceSection {
  const wireState = wireStateForClassification(record, timeZone, nowMs);

  if (HISTORY_WIRE_STATES.includes(wireState)) {
    return SURFACE_SECTION.HISTORY;
  }
  if (wireState === RUNTIME_TASK_STATE.MISSED) {
    return SURFACE_SECTION.NEEDS_ATTENTION;
  }
  if (wireState === RUNTIME_TASK_STATE.SCHEDULED) {
    return SURFACE_SECTION.UPCOMING;
  }
  if (wireState === RUNTIME_TASK_STATE.ACTIVE) {
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
    currentState: RuntimeTaskState | string;
    dueWindowStart?: number;
    dueWindowEnd?: number;
    displayToPatient: boolean;
    displayAsChecklistItem?: boolean;
  },
  timeZone = DEFAULT_ACTION_CENTER_TIMEZONE,
  nowMs = nowEpochMs(),
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
