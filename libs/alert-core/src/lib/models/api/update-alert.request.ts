import { AlertState } from '../types/alert-state.type';
import type { PriorityBand } from '../types/priority-band.type';

export interface UpdateAlertRequest {
  alertState?: AlertState;
  assignedToUserId?: string | null;
  /** Denormalized assignee display name for list/detail; clear on unassign. */
  assignedToDisplayName?: string | null;
  priority?: PriorityBand;
  slaBreachIndicator?: boolean;
  closureComment?: string;
  /** Set when transitioning to RESOLVED (workflow / API). */
  resolutionCode?: string;
  /** Set when transitioning to DISMISSED (workflow / API). */
  dismissReason?: string;
}
