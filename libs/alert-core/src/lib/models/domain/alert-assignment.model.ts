export interface AlertAssignment {
  assignedToUserId?: string;
  /** UI-provided display name for the current assignee (denormalized from user-service). */
  assignedToDisplayName?: string;
  /** Unix epoch milliseconds (UTC). */
  assignedAt?: number;
  assignedBy?: string;
}
