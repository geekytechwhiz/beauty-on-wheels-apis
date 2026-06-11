import type { TaskHistDdbRecord, TaskMetaDdbRecord } from '../persistence/task-ddb.model';
import type { toRuntimeTaskCard, toTaskHistoryEntry } from '../../mappers/task-http.dto';

export interface UpdateAssignedStaffRequest {
  organizationId: string;
  runtimeTaskInstanceId: string;
  actorId: string;
  assignedToStaffId: string;
  assignedToStaffDisplayName: string;
  reason?: string;
}

export interface UpdateAssignedStaffResult {
  runtimeTaskInstanceId: string;
  task: ReturnType<typeof toRuntimeTaskCard>;
  historyEntry: ReturnType<typeof toTaskHistoryEntry>;
}

export type ReassignStaffTaskRepoInput = {
  meta: TaskMetaDdbRecord;
  lookup: import('../persistence/task-ddb.model').TaskLookupDdbRecord;
  actorId: string;
  assignedToStaffId: string;
  assignedToStaffDisplayName: string;
  reason?: string;
};

export type ReassignStaffTaskRepoResult = {
  record: TaskMetaDdbRecord;
  historyEntry: TaskHistDdbRecord;
};
