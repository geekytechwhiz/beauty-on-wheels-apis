import { RUNTIME_TASK_STATE } from '../models/types/runtime-task-state.type';
import { READINESS_STATUS } from '../models/types/task-domain.types';
import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import { aggregateTaskStatusSummary } from './task-status-summary';

function meta(
  overrides: Partial<TaskMetaDdbRecord> & Pick<TaskMetaDdbRecord, 'runtimeTaskInstanceId' | 'currentState'>,
): TaskMetaDdbRecord {
  return {
    pk: 'ORG#org-1#PAT#pat-1',
    sk: `DUE#1780567200000#TASK#${overrides.runtimeTaskInstanceId}`,
    entityType: 'RuntimeTaskInstance',
    orgId: 'org-1',
    patientId: 'pat-1',
    runtimeTaskInstanceId: overrides.runtimeTaskInstanceId,
    runtimeTaskSource: 'carePlanTaskLinkage',
    taskBehaviorCode: 'INSTRUCTION',
    taskDisplayGroup: 'action',
    displayTitle: overrides.displayTitle ?? 'Task',
    assignedToType: 'patient',
    displayToPatient: true,
    currentState: overrides.currentState,
    createdAt: 1,
    createdBy: 'system',
    lastUpdatedAt: 1,
    lastUpdatedBy: 'system',
    version: 1,
    carePlanInstanceId: 'cp-1',
    ...overrides,
  };
}

const ctx = {
  orgId: 'org-1',
  patientId: 'pat-1',
  carePlanInstanceId: 'cp-1',
  workflowStage: 'onboarding' as const,
};

describe('aggregateTaskStatusSummary', () => {
  it('returns notApplicable when no required tasks exist', () => {
    const result = aggregateTaskStatusSummary(
      [
        meta({ runtimeTaskInstanceId: 't-1', currentState: RUNTIME_TASK_STATE.OPEN }),
        meta({
          runtimeTaskInstanceId: 't-2',
          currentState: RUNTIME_TASK_STATE.COMPLETED,
          requiredForStageCompletion: false,
        }),
      ],
      ctx,
    );

    expect(result.readinessStatus).toBe(READINESS_STATUS.NOT_APPLICABLE);
    expect(result.counts).toEqual({
      total: 2,
      requiredTotal: 0,
      completed: 1,
      missed: 0,
      active: 1,
      scheduled: 0,
    });
    expect(result.incompleteRequiredTasks).toBeUndefined();
  });

  it('returns ready when all required tasks are completed', () => {
    const result = aggregateTaskStatusSummary(
      [
        meta({
          runtimeTaskInstanceId: 't-1',
          currentState: RUNTIME_TASK_STATE.COMPLETED,
          requiredForStageCompletion: true,
        }),
        meta({
          runtimeTaskInstanceId: 't-2',
          currentState: RUNTIME_TASK_STATE.COMPLETED,
          requiredForStageCompletion: true,
        }),
      ],
      ctx,
    );

    expect(result.readinessStatus).toBe(READINESS_STATUS.READY);
    expect(result.counts.requiredTotal).toBe(2);
    expect(result.incompleteRequiredTasks).toBeUndefined();
  });

  it('returns notReady and lists incomplete required tasks including dismissed/cancelled', () => {
    const result = aggregateTaskStatusSummary(
      [
        meta({
          runtimeTaskInstanceId: 't-done',
          currentState: RUNTIME_TASK_STATE.COMPLETED,
          requiredForStageCompletion: true,
          displayTitle: 'Done task',
        }),
        meta({
          runtimeTaskInstanceId: 't-open',
          currentState: RUNTIME_TASK_STATE.OPEN,
          requiredForStageCompletion: true,
          displayTitle: 'Open task',
        }),
        meta({
          runtimeTaskInstanceId: 't-dismissed',
          currentState: RUNTIME_TASK_STATE.DISMISSED,
          requiredForStageCompletion: true,
          displayTitle: 'Dismissed task',
        }),
        meta({
          runtimeTaskInstanceId: 't-cancelled',
          currentState: RUNTIME_TASK_STATE.CANCELLED,
          requiredForStageCompletion: true,
          displayTitle: 'Cancelled task',
        }),
      ],
      ctx,
    );

    expect(result.readinessStatus).toBe(READINESS_STATUS.NOT_READY);
    expect(result.incompleteRequiredTasks).toHaveLength(3);
    expect(result.incompleteRequiredTasks?.map((t) => t.runtimeTaskInstanceId)).toEqual([
      't-open',
      't-dismissed',
      't-cancelled',
    ]);
    expect(result.incompleteRequiredTasks?.[0].currentState).toBe('open');
  });

  it('buckets legacy active/scheduled states into active and scheduled counts', () => {
    const result = aggregateTaskStatusSummary(
      [
        meta({ runtimeTaskInstanceId: 't-1', currentState: RUNTIME_TASK_STATE.ACTIVE }),
        meta({ runtimeTaskInstanceId: 't-2', currentState: RUNTIME_TASK_STATE.SCHEDULED }),
        meta({ runtimeTaskInstanceId: 't-3', currentState: RUNTIME_TASK_STATE.MISSED }),
      ],
      ctx,
    );

    expect(result.counts).toMatchObject({
      total: 3,
      active: 1,
      scheduled: 1,
      missed: 1,
      completed: 0,
    });
  });
});
