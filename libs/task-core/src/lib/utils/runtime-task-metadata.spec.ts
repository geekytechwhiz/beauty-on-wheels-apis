import { RUNTIME_TASK_STATE } from '../models/types/runtime-task-state.type';
import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import {
  assertRequiredForStageCompletionAllowed,
  computeRuntimeTaskMetadataDiff,
} from './runtime-task-metadata';

const baseMeta = {
  displayTitle: 'BP check',
  description: 'Old desc',
  displayToPatient: true,
  requiredForStageCompletion: false,
  currentState: RUNTIME_TASK_STATE.OPEN,
} as TaskMetaDdbRecord;

describe('runtime-task-metadata utils', () => {
  it('computes diff for changed fields only', () => {
    const diff = computeRuntimeTaskMetadataDiff(baseMeta, {
      displayTitle: 'Complete daily blood pressure check',
      description: 'Use home cuff',
    });

    expect(diff).toMatchObject({
      changedFields: ['displayTitle', 'description'],
      previousValues: { displayTitle: 'BP check', description: 'Old desc' },
      newValues: {
        displayTitle: 'Complete daily blood pressure check',
        description: 'Use home cuff',
      },
    });
  });

  it('returns null when patch makes no effective change', () => {
    expect(
      computeRuntimeTaskMetadataDiff(baseMeta, {
        displayTitle: 'BP check',
      }),
    ).toBeNull();
  });

  it('includes lookup update when patientDisplayName changes', () => {
    const diff = computeRuntimeTaskMetadataDiff(
      { ...baseMeta, patientDisplayName: 'Jane Doe' },
      { patientDisplayName: 'Jane D.' },
    );

    expect(diff?.lookupUpdates).toEqual({ patientDisplayName: 'Jane D.' });
  });

  it('rejects requiredForStageCompletion true on completed task', () => {
    expect(() =>
      assertRequiredForStageCompletionAllowed(RUNTIME_TASK_STATE.COMPLETED, {
        requiredForStageCompletion: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_METADATA_FOR_STATE', statusCode: 422 }));
  });
});
