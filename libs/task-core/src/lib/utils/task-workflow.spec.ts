import { ASSIGNED_TO_TYPE, TASK_RUNTIME_ACTION } from '../models/types/task-domain.types';
import { RUNTIME_TASK_STATE } from '../models/types/runtime-task-state.type';
import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import {
  actionToTargetState,
  resolveTaskStateTransition,
  wireStateMatchesExpected,
} from './task-workflow';

const TZ = 'UTC';
const NOW = Date.parse('2026-06-05T12:00:00.000Z');

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
    currentState: RUNTIME_TASK_STATE.SCHEDULED,
    dueWindowStart: Date.parse('2026-06-05T08:00:00.000Z'),
    dueWindowEnd: Date.parse('2026-06-07T08:00:00.000Z'),
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

  it('matches derived active wire state against persisted scheduled', () => {
    expect(
      wireStateMatchesExpected(sampleMeta(), RUNTIME_TASK_STATE.ACTIVE, TZ, NOW),
    ).toBe(true);
  });

  it('resolves complete transition from scheduled when wire is active', () => {
    const result = resolveTaskStateTransition(
      sampleMeta(),
      TASK_RUNTIME_ACTION.COMPLETE,
      RUNTIME_TASK_STATE.ACTIVE,
      'patient',
      TZ,
      NOW,
    );
    expect(result.toState).toBe(RUNTIME_TASK_STATE.COMPLETED);
    expect(result.expectedPersistedState).toBe(RUNTIME_TASK_STATE.SCHEDULED);
  });

  it('rejects terminal task transitions', () => {
    expect(() =>
      resolveTaskStateTransition(
        sampleMeta({ currentState: RUNTIME_TASK_STATE.COMPLETED }),
        TASK_RUNTIME_ACTION.DISMISS,
        RUNTIME_TASK_STATE.COMPLETED,
        'patient',
        TZ,
        NOW,
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_STATE_TRANSITION', statusCode: 422 }));
  });

  it('rejects patient actor on staff task', () => {
    expect(() =>
      resolveTaskStateTransition(
        sampleMeta({ assignedToType: ASSIGNED_TO_TYPE.ORG_STAFF }),
        TASK_RUNTIME_ACTION.COMPLETE,
        RUNTIME_TASK_STATE.ACTIVE,
        'patient',
        TZ,
        NOW,
      ),
    ).toThrow(expect.objectContaining({ code: 'ACTOR_NOT_ALLOWED', statusCode: 422 }));
  });

  it('throws EXPECTED_STATE_MISMATCH when expected wire state does not match', () => {
    expect(() =>
      resolveTaskStateTransition(
        sampleMeta(),
        TASK_RUNTIME_ACTION.COMPLETE,
        RUNTIME_TASK_STATE.MISSED,
        'patient',
        TZ,
        NOW,
      ),
    ).toThrow(expect.objectContaining({ code: 'EXPECTED_STATE_MISMATCH', statusCode: 409 }));
  });
});
