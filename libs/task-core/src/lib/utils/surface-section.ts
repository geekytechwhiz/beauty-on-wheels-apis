import { SURFACE_SECTION, type SurfaceSection } from '../models/types/task-domain.types';
import type { RuntimeTaskState } from '../models/types/runtime-task-state.type';
import { RUNTIME_TASK_STATE } from '../models/types/runtime-task-state.type';

const TERMINAL_STATES: RuntimeTaskState[] = [
  RUNTIME_TASK_STATE.COMPLETED,
  RUNTIME_TASK_STATE.MISSED,
  RUNTIME_TASK_STATE.DISMISSED,
  RUNTIME_TASK_STATE.CANCELLED,
];

export function deriveSurfaceSection(
  record: {
    currentState: RuntimeTaskState;
    dueWindowStart?: number;
    displayToPatient: boolean;
  },
  nowMs = Date.now(),
): SurfaceSection {
  if (TERMINAL_STATES.includes(record.currentState)) {
    return SURFACE_SECTION.HISTORY;
  }
  if (record.dueWindowStart != null && record.dueWindowStart > nowMs) {
    return SURFACE_SECTION.UPCOMING;
  }
  if (record.currentState === RUNTIME_TASK_STATE.ACTIVE) {
    return SURFACE_SECTION.TODAY;
  }
  if (record.currentState === RUNTIME_TASK_STATE.SCHEDULED) {
    return SURFACE_SECTION.UPCOMING;
  }
  return record.displayToPatient ? SURFACE_SECTION.NEEDS_ATTENTION : SURFACE_SECTION.TODAY;
}
