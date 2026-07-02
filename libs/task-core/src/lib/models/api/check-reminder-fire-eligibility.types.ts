import type { TaskMetaDdbRecord } from '../persistence/task-ddb.model';

export interface CheckReminderFireEligibilityInput {
  runtimeTaskInstanceId: string;
}

export type CheckReminderFireEligibilityResult =
  | { status: 'eligible'; meta: TaskMetaDdbRecord }
  | { status: 'skipped'; reason: string };
