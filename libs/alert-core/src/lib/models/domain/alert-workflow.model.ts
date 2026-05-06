import { AlertState } from '../types/alert-state.type';

export interface AlertWorkflow {
  alertState: AlertState;
  /** Unix epoch milliseconds (UTC). */
  statusUpdatedAt: number;
  statusUpdatedBy?: string;

  closureComment?: string;
  resolutionCode?: string;
  dismissReason?: string;
}
