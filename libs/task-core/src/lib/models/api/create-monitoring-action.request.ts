import type { ReminderSettings, TaskBehaviorCode } from '../types/task-domain.types';

export interface CreateMonitoringActionRequest {
  organizationId: string;
  patientId: string;
  carePlanInstanceId: string;
  monitoringInstanceId: string;
  taskBehaviorCode: TaskBehaviorCode;
  dueWindowStart: number;
  dueWindowEnd: number;
  reminderContext?: ReminderSettings | Record<string, unknown> | null;
}
