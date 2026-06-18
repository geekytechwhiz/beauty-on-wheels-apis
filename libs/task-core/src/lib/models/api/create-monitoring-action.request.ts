import type {
  AssignedToType,
  ReminderSettings,
  TaskBehaviorCode,
} from '../types/task-domain.types';

/** Service payload — `organizationId` from JWT; all other fields from HTTP body. */
export interface CreateMonitoringActionRequest {
  /** Resolved from JWT at the HTTP layer — never from the client body. */
  organizationId: string;
  /** From request body input. */
  patientId: string;
  /** From request body input. */
  patientDisplayName: string;
  carePlanInstanceId: string;
  monitoringInstanceId: string;
  taskBehaviorCode: TaskBehaviorCode;
  /** Who completes the task: `patient` or `staff` only. */
  assignedToType: AssignedToType;
  /** Required when `assignedToType` is `staff`; drives GSI1 staff inbox. */
  assignedToStaffId?: string;
  /** Required when `assignedToType` is `staff`. */
  assignedToStaffDisplayName?: string;
  dueWindowStart: number;
  dueWindowEnd: number;
  reminderContext?: ReminderSettings | Record<string, unknown> | null;
}
