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
  /** Who completes the task — `patient`, `careTeamRole`, `user`, `orgStaff`, or `system`. */
  assignedToType: AssignedToType;
  /** Required when `assignedToType` is not `patient`; assignee id for GSI1 inbox indexing. */
  assignedToStaffId?: string;
  /** Required when `assignedToType` is not `patient`. */
  assignedToStaffDisplayName?: string;
  dueWindowStart: number;
  dueWindowEnd: number;
  reminderContext?: ReminderSettings | Record<string, unknown> | null;
}
