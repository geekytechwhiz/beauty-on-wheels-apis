import { ASSIGNED_TO_TYPE } from '../models/types/task-domain.types';
import { RUNTIME_TASK_STATE } from '../models/types/runtime-task-state.type';
import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import {
  buildEvidenceSummaryRollup,
  cancelReminderHistoryEntries,
} from './task-state-transition';

function sampleMeta(): TaskMetaDdbRecord {
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
  };
}

describe('task-state-transition', () => {
  it('cancels scheduled reminder history entries', () => {
    const nowMs = 1780573500000;
    const { entries, hadCancellable } = cancelReminderHistoryEntries(
      [
        {
          reminderRecordId: 'rem-1',
          reminderStatus: 'scheduled',
          scheduledReminderAt: 1780578000000,
        },
      ],
      nowMs,
    );

    expect(hadCancellable).toBe(true);
    expect(entries[0]).toMatchObject({
      reminderRecordId: 'rem-1',
      reminderStatus: 'cancelled',
      updatedAt: nowMs,
    });
  });

  it('builds evidence summary rollup for completed state', () => {
    const summary = buildEvidenceSummaryRollup(
      sampleMeta(),
      RUNTIME_TASK_STATE.COMPLETED,
      1780573500000,
      'Done',
    );

    expect(summary).toMatchObject({
      currentState: 'completed',
      completedAt: 1780573500000,
      latestCompletionSummary: 'Done',
      runtimeTaskInstanceId: 'rtask-abc',
    });
  });
});
