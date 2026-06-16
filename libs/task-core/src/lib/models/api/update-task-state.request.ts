import type { TaskHistDdbRecord, TaskMetaDdbRecord } from '../persistence/task-ddb.model';
import type { ActorType, TaskRuntimeAction } from '../types/task-domain.types';
import type { RuntimeTaskState } from '../types/runtime-task-state.type';
import type { SurfaceSection } from '../types/task-domain.types';
import type { toRuntimeTaskCard, toTaskHistoryEntry } from '../../mappers/task-http.dto';

export interface UpdateTaskStateRequest {
  organizationId: string;
  runtimeTaskInstanceId: string;
  action: TaskRuntimeAction;
  actorId: string;
  actorType: ActorType;
  expectedCurrentState: RuntimeTaskState;
  reason?: string;
  evidencePayload?: Record<string, unknown>;
}

export interface UpdateTaskStateResult {
  runtimeTaskInstanceId: string;
  currentState: RuntimeTaskState;
  surfaceSection: SurfaceSection;
  historyEntry: ReturnType<typeof toTaskHistoryEntry>;
}

export type TransitionTaskStateRepoInput = {
  meta: TaskMetaDdbRecord;
  lookup: import('../persistence/task-ddb.model').TaskLookupDdbRecord;
  fromState: RuntimeTaskState;
  toState: RuntimeTaskState;
  expectedPersistedState: RuntimeTaskState;
  actorId: string;
  reason?: string;
  evidencePayload?: Record<string, unknown>;
  nowMs?: number;
};

export type TransitionTaskStateRepoResult = {
  record: TaskMetaDdbRecord;
  historyEntry: TaskHistDdbRecord;
  reminderCancelHistEntry?: TaskHistDdbRecord;
  hadCancellableReminders: boolean;
};
