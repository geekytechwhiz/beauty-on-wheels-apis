import {
  TASK_BUSINESS_ID_PREFIX,
  TASK_DDB_KEY_PREFIX,
} from '../constants/task-key.constants';
import { TaskIdBuilder } from './task-id.builder';

describe('TaskIdBuilder', () => {
  it('buildReminderRecordId uses reminder business prefix', () => {
    expect(TaskIdBuilder.buildReminderRecordId('task-1', 1_700_000_360_000, 'push')).toBe(
      `${TASK_BUSINESS_ID_PREFIX.REMINDER_RECORD}task-1-1700000360000-push`,
    );
  });

  it('newRuntimeTaskInstanceId uses runtime task prefix', () => {
    expect(TaskIdBuilder.newRuntimeTaskInstanceId()).toMatch(
      new RegExp(`^${TASK_BUSINESS_ID_PREFIX.RUNTIME_TASK}`),
    );
  });

  it('buildCompletionEvidenceSk uses EVID dynamo prefix', () => {
    expect(TaskIdBuilder.buildCompletionEvidenceSk('evid-1')).toBe(
      `${TASK_DDB_KEY_PREFIX.EVID}evid-1`,
    );
  });
});
