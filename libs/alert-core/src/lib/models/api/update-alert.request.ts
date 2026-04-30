import { AlertState } from '../types/alert-state.type';

export interface UpdateAlertRequest {
  alertState?: AlertState;
  assignedToUserId?: string | null;
  slaBreachIndicator?: boolean;
  closureComment?: string;
  /** Set when transitioning to RESOLVED (workflow / API). */
  resolutionCode?: string;
  /** Set when transitioning to DISMISSED (workflow / API). */
  dismissReason?: string;
}
