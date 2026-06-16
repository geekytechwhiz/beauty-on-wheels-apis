import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import {
  ACTOR_TYPE,
  isPatientAssignedToType,
  TASK_RUNTIME_ACTION,
  type ActorType,
  type TaskRuntimeAction,
} from '../models/types/task-domain.types';
import {
  RUNTIME_TASK_STATE,
  TERMINAL_RUNTIME_TASK_STATES,
  type RuntimeTaskState,
} from '../models/types/runtime-task-state.type';
import { isInProgressState } from './surface-section';

function workflowError(message: string, statusCode: number, code: string): never {
  const e = new Error(message) as Error & { statusCode: number; code: string };
  e.statusCode = statusCode;
  e.code = code;
  throw e;
}

/** Normalize client expected state to persisted comparison value. */
export function normalizeExpectedStateForPersistedCompare(
  expected: RuntimeTaskState,
): RuntimeTaskState {
  if (expected === RUNTIME_TASK_STATE.ACTIVE || expected === RUNTIME_TASK_STATE.SCHEDULED) {
    return RUNTIME_TASK_STATE.OPEN;
  }
  return expected;
}

/** Whether persisted `currentState` matches client `expectedCurrentState` (legacy-aware). */
export function persistedStateMatchesExpected(
  persisted: RuntimeTaskState,
  expected: RuntimeTaskState,
): boolean {
  if (persisted === expected) {
    return true;
  }
  const inProgress = new Set<RuntimeTaskState>([
    RUNTIME_TASK_STATE.OPEN,
    RUNTIME_TASK_STATE.ACTIVE,
    RUNTIME_TASK_STATE.SCHEDULED,
  ]);
  const normalizedExpected = normalizeExpectedStateForPersistedCompare(expected);
  if (normalizedExpected === RUNTIME_TASK_STATE.OPEN && inProgress.has(persisted)) {
    return true;
  }
  return false;
}

/** Map persisted state to the value used in META conditional updates. */
export function persistedStateForCondition(persisted: RuntimeTaskState): RuntimeTaskState {
  if (persisted === RUNTIME_TASK_STATE.ACTIVE || persisted === RUNTIME_TASK_STATE.SCHEDULED) {
    return persisted;
  }
  return persisted;
}

export function actionToTargetState(action: TaskRuntimeAction): RuntimeTaskState {
  switch (action) {
    case TASK_RUNTIME_ACTION.COMPLETE:
      return RUNTIME_TASK_STATE.COMPLETED;
    case TASK_RUNTIME_ACTION.DISMISS:
      return RUNTIME_TASK_STATE.DISMISSED;
    case TASK_RUNTIME_ACTION.CANCEL:
      return RUNTIME_TASK_STATE.CANCELLED;
    case TASK_RUNTIME_ACTION.MARK_MISSED:
      return RUNTIME_TASK_STATE.MISSED;
    default: {
      const _exhaustive: never = action;
      workflowError(`Unsupported action: ${String(_exhaustive)}`, 422, 'INVALID_STATE_TRANSITION');
    }
  }
}

export function assertActorAllowedForTask(meta: TaskMetaDdbRecord, actorType: ActorType): void {
  const assignedToType = meta.assignedToType;
  if (isPatientAssignedToType(assignedToType) && actorType !== ACTOR_TYPE.PATIENT) {
    workflowError('Only patient actors may update patient-assigned tasks', 422, 'ACTOR_NOT_ALLOWED');
  }
  if (!isPatientAssignedToType(assignedToType) && actorType !== ACTOR_TYPE.STAFF) {
    workflowError('Only staff actors may update non-patient-assigned tasks', 422, 'ACTOR_NOT_ALLOWED');
  }
}

export type ResolvedTaskStateTransition = {
  fromState: RuntimeTaskState;
  toState: RuntimeTaskState;
  expectedPersistedState: RuntimeTaskState;
};

export function resolveTaskStateTransition(
  meta: TaskMetaDdbRecord,
  action: TaskRuntimeAction,
  expectedCurrentState: RuntimeTaskState,
  actorType: ActorType,
): ResolvedTaskStateTransition {
  const fromState = meta.currentState;

  if (TERMINAL_RUNTIME_TASK_STATES.includes(fromState)) {
    workflowError(
      `Task is already in terminal state (${fromState})`,
      422,
      'INVALID_STATE_TRANSITION',
    );
  }

  if (!persistedStateMatchesExpected(fromState, expectedCurrentState)) {
    workflowError(
      `Expected current state ${expectedCurrentState} but task is ${fromState}`,
      409,
      'EXPECTED_STATE_MISMATCH',
    );
  }

  assertActorAllowedForTask(meta, actorType);

  const toState = actionToTargetState(action);

  if (!isInProgressState(fromState)) {
    workflowError(
      `Action ${action} is not valid from state ${fromState}`,
      422,
      'INVALID_STATE_TRANSITION',
    );
  }

  return {
    fromState,
    toState,
    expectedPersistedState: persistedStateForCondition(fromState),
  };
}
