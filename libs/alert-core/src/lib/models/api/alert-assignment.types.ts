import type { AlertDdbRecord } from '../persistence/alert-ddb.model';

export type AssignmentAction = 'ASSIGN' | 'REASSIGN' | 'UNASSIGN' | 'ASSIGN_TO_SELF';

/** Orchestration input for POST `/alerts/assignment`. */
export interface AssignmentInput {
  alertIds: string[];
  action: AssignmentAction;
  /** Required for ASSIGN / REASSIGN. For ASSIGN_TO_SELF, validators should resolve this before calling core. */
  assignToUserId?: string;
  /** UI-provided display name for `assignToUserId` (assignment actions that set an assignee). */
  assigneeDisplayName?: string;
  performedByUserId?: string;
  performedByDisplayName?: string;
}

export interface AssignmentResult {
  /** Convenience: return full alert detail for single-select calls. */
  primaryAlert?: AlertDdbRecord;
}

