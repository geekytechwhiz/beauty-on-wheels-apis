import type { ReminderSettings } from '../types/task-domain.types';
import type { TaskHistDdbRecord, TaskMetaDdbRecord } from '../persistence/task-ddb.model';
import type { toTaskHistoryEntry } from '../../mappers/task-http.dto';

export interface UpdateReminderSettingsRequest {
  organizationId: string;
  runtimeTaskInstanceId: string;
  actorId: string;
  reminderEnabled: boolean;
  reminderSettings?: ReminderSettings;
  reason?: string;
}

export interface UpdateReminderSettingsResult {
  runtimeTaskInstanceId: string;
  reminderEnabled: boolean;
  reminderSettings?: ReminderSettings;
  historyEntry: ReturnType<typeof toTaskHistoryEntry>;
}

export type ReminderCoordination = {
  shouldCancel: boolean;
  shouldRegister: boolean;
};

export type UpdateReminderSettingsRepoInput = {
  meta: TaskMetaDdbRecord;
  actorId: string;
  reminderEnabled: boolean;
  reminderSettings?: ReminderSettings;
  reason?: string;
  coordination: ReminderCoordination;
};

export type UpdateReminderSettingsRepoResult = {
  record: TaskMetaDdbRecord;
  settingsChangeHist: TaskHistDdbRecord;
  cancelRequestHist?: TaskHistDdbRecord;
  registerRequestHist?: TaskHistDdbRecord;
  coordination: ReminderCoordination;
};
