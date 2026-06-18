import { ASSIGNED_TO_TYPE, TASK_RUNTIME_ACTION } from '../models/types/task-domain.types';
import { RUNTIME_TASK_STATE } from '../models/types/runtime-task-state.type';
import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import {
  actionToTargetState,
  persistedStateMatchesExpected,
  resolveTaskStateTransition,
} from './task-workflow';

function sampleMeta(overrides: Partial<TaskMetaDdbRecord> = {}): TaskMetaDdbRecord {
  return {
    pk: 'ORG#org-1#PAT#pat-1',
    sk: 'DUE#0001780567200000#TASK#rtask-abc',
    entityType: 'RuntimeTaskInstance',
    orgId: 'org-1',
    patientId: 'pat-1',
    runtimeTaskInstanceId: 'rtask-abc',
    runtimeTaskSource: 'carePlanTaskLinkage',
    taskBehaviorCode: 'METRIC_CHECKIN',
    taskDisplayGroup: 'checkIn',
    displayTitle: 'Check in',
    assignedToType: ASSIGNED_TO_TYPE.PATIENT,
    displayToPatient: true,
    currentState: RUNTIME_TASK_STATE.OPEN,
    createdAt: 1,
    createdBy: 'system',
    lastUpdatedAt: 1,
    lastUpdatedBy: 'system',
    ...overrides,
  };
}

describe('task-workflow', () => {
  it('maps complete action to completed state', () => {
    expect(actionToTargetState(TASK_RUNTIME_ACTION.COMPLETE)).toBe(RUNTIME_TASK_STATE.COMPLETED);
  });

  it('treats active and open as equivalent for expected state', () => {
    expect(
      persistedStateMatchesExpected(RUNTIME_TASK_STATE.OPEN, RUNTIME_TASK_STATE.ACTIVE),
    ).toBe(true);
    expect(
      persistedStateMatchesExpected(RUNTIME_TASK_STATE.ACTIVE, RUNTIME_TASK_STATE.OPEN),
    ).toBe(true);
  });

  it('resolves complete transition from open', () => {
    const result = resolveTaskStateTransition(
      sampleMeta(),
      TASK_RUNTIME_ACTION.COMPLETE,
      RUNTIME_TASK_STATE.OPEN,
      'patient',
    );
    expect(result.toState).toBe(RUNTIME_TASK_STATE.COMPLETED);
    expect(result.fromState).toBe(RUNTIME_TASK_STATE.OPEN);
  });

  it('rejects terminal task transitions', () => {
    expect(() =>
      resolveTaskStateTransition(
        sampleMeta({ currentState: RUNTIME_TASK_STATE.COMPLETED }),
        TASK_RUNTIME_ACTION.DISMISS,
        RUNTIME_TASK_STATE.COMPLETED,
        'patient',
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_STATE_TRANSITION', statusCode: 422 }));
  });

  it('rejects patient actor on staff task', () => {
    expect(() =>
      resolveTaskStateTransition(
        sampleMeta({ assignedToType: ASSIGNED_TO_TYPE.ORG_STAFF }),
        TASK_RUNTIME_ACTION.COMPLETE,
        RUNTIME_TASK_STATE.OPEN,
        'patient',
      ),
    ).toThrow(expect.objectContaining({ code: 'ACTOR_NOT_ALLOWED', statusCode: 422 }));
  });

  it('throws EXPECTED_STATE_MISMATCH when expected does not match', () => {
    expect(() =>
      resolveTaskStateTransition(
        sampleMeta({ currentState: RUNTIME_TASK_STATE.OPEN }),
        TASK_RUNTIME_ACTION.COMPLETE,
        RUNTIME_TASK_STATE.COMPLETED,
        'patient',
      ),
    ).toThrow(expect.objectContaining({ code: 'EXPECTED_STATE_MISMATCH', statusCode: 409 }));
  });
});
