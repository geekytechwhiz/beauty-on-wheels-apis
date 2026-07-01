import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import {
  ACTOR_TYPE,
  isPatientAssignedToType,
  TASK_RUNTIME_ACTION,
  type ActorType,
  type TaskRuntimeAction,
} from '../models/types/task-domain.types';
import {
  isPersistedInProgress,
  isTerminalPersistedState,
  normalizePersistedState,
  resolveCurrentStateForWire,
  RUNTIME_TASK_STATE,
  type RuntimeTaskState,
} from '../models/types/runtime-task-state.type';
import { DEFAULT_ACTION_CENTER_TIMEZONE, nowEpochMs } from './task-time';

function workflowError(message: string, statusCode: number, code: string): never {
  const e = new Error(message) as Error & { statusCode: number; code: string };
  e.statusCode = statusCode;
  e.code = code;
  throw e;
}

export function wireStateMatchesExpected(
  meta: TaskMetaDdbRecord,
  expectedWireState: RuntimeTaskState,
  timeZone = DEFAULT_ACTION_CENTER_TIMEZONE,
  nowMs = nowEpochMs(),
): boolean {
  const derived = resolveCurrentStateForWire({
    persistedState: meta.currentState,
    dueWindowStart: meta.dueWindowStart,
    dueWindowEnd: meta.dueWindowEnd,
    timeZone,
    nowMs,
  });
  return derived === expectedWireState;
}

/** Map persisted state to the value used in META conditional updates. */
export function persistedStateForCondition(persisted: RuntimeTaskState | string): RuntimeTaskState {
  return normalizePersistedState(persisted);
}

export function actionToTargetState(action: TaskRuntimeAction): RuntimeTaskState {
  switch (action) {
    case TASK_RUNTIME_ACTION.COMPLETE:
      return RUNTIME_TASK_STATE.COMPLETED;
    case TASK_RUNTIME_ACTION.DISMISS:
      return RUNTIME_TASK_STATE.DISMISSED;
    case TASK_RUNTIME_ACTION.CANCEL:
      return RUNTIME_TASK_STATE.CANCELLED;
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
  timeZone = DEFAULT_ACTION_CENTER_TIMEZONE,
  nowMs = nowEpochMs(),
): ResolvedTaskStateTransition {
  const fromState = meta.currentState;

  if (isTerminalPersistedState(fromState)) {
    workflowError(
      `Task is already in terminal state (${fromState})`,
      422,
      'INVALID_STATE_TRANSITION',
    );
  }

  if (!wireStateMatchesExpected(meta, expectedCurrentState, timeZone, nowMs)) {
    const derived = resolveCurrentStateForWire({
      persistedState: meta.currentState,
      dueWindowStart: meta.dueWindowStart,
      dueWindowEnd: meta.dueWindowEnd,
      timeZone,
      nowMs,
    });
    workflowError(
      `Expected current state ${expectedCurrentState} but task is ${derived}`,
      409,
      'EXPECTED_STATE_MISMATCH',
    );
  }

  assertActorAllowedForTask(meta, actorType);

  const toState = actionToTargetState(action);

  if (!isPersistedInProgress(fromState)) {
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
